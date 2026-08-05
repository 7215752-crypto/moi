import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AnalyticsRefreshButton } from "@/components/analytics-refresh-button";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoneyWhole } from "@/lib/format";
import {
  NO_CATEGORY,
  computeDishStats,
  defaultRange,
  formatDeltaPercent,
  formatQuantity,
  isValidIsoDate,
  periodPresets,
  previousRange,
  toNumber,
  type CategorySummaryRow,
  type DishStat,
  type DishSummaryRow,
} from "@/lib/dish-sales";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type BusinessUnit = {
  id: string;
  name: string;
};

const SORT_KEYS = ["revenue", "qty", "attach", "foodcost", "delta", "name"] as const;
type SortKey = (typeof SORT_KEYS)[number];

const TABS = ["dishes", "categories", "attention"] as const;
type TabKey = (typeof TABS)[number];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Сравнение с «пустотой» в конце списка при любом направлении сортировки.
function compareNullable(a: number | null, b: number | null, direction: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const query = await searchParams;
  const { supabase, profile } = await requireUser();

  const fallback = defaultRange();
  const fromParam = firstParam(query.from);
  const toParam = firstParam(query.to);
  let from = isValidIsoDate(fromParam) ? fromParam : fallback.from;
  let to = isValidIsoDate(toParam) ? toParam : fallback.to;
  if (from > to) [from, to] = [to, from];

  const prev = previousRange(from, to);

  const unitsResult = await supabase
    .from("business_units")
    .select("id, name")
    .not("iiko_department", "is", null)
    .order("name");

  if (unitsResult.error) {
    throw new Error(`Не удалось загрузить рестораны: ${unitsResult.error.message}`);
  }
  const units = (unitsResult.data ?? []) as BusinessUnit[];

  const unitParam = firstParam(query.unit);
  const selectedUnit = units.find((unit) => unit.id === unitParam) ?? null;
  const unitId = selectedUnit?.id ?? null;

  const [
    currentResult,
    prevResult,
    catsResult,
    catsPrevResult,
    lastImportResult,
  ] = await Promise.all([
    supabase.rpc("dish_sales_summary", { p_from: from, p_to: to, p_unit: unitId }),
    supabase.rpc("dish_sales_summary", {
      p_from: prev.from,
      p_to: prev.to,
      p_unit: unitId,
    }),
    supabase.rpc("dish_sales_category_summary", {
      p_from: from,
      p_to: to,
      p_unit: unitId,
    }),
    supabase.rpc("dish_sales_category_summary", {
      p_from: prev.from,
      p_to: prev.to,
      p_unit: unitId,
    }),
    supabase
      .from("dish_sales_daily")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (currentResult.error) {
    throw new Error(`Не удалось загрузить продажи: ${currentResult.error.message}`);
  }
  if (prevResult.error) {
    throw new Error(
      `Не удалось загрузить прошлый период: ${prevResult.error.message}`,
    );
  }
  if (catsResult.error) {
    throw new Error(`Не удалось загрузить категории: ${catsResult.error.message}`);
  }

  const currentRows = (currentResult.data ?? []) as DishSummaryRow[];
  const prevRows = (prevResult.data ?? []) as DishSummaryRow[];
  const cats = (catsResult.data ?? []) as CategorySummaryRow[];
  const catsPrev = (catsPrevResult.data ?? []) as CategorySummaryRow[];

  const { stats, prevAbc, prevDishes } = computeDishStats(currentRows, prevRows);

  // ---- Фильтры по категории и поиску (ABC и итоги считаются до них — по всему скоупу).
  const categories = Array.from(new Set(stats.map((stat) => stat.category))).sort(
    (a, b) => a.localeCompare(b, "ru"),
  );

  const catParam = firstParam(query.cat);
  const selectedCategory = categories.includes(catParam ?? "") ? (catParam as string) : null;

  const searchText = (firstParam(query.q) ?? "").trim();
  const searchLower = searchText.toLowerCase();

  const filteredStats = stats.filter(
    (stat) =>
      (!selectedCategory || stat.category === selectedCategory) &&
      (!searchLower || stat.name.toLowerCase().includes(searchLower)),
  );

  // ---- Вкладка и сортировка.
  const tabParam = firstParam(query.tab);
  const tab: TabKey = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as TabKey)
    : "dishes";

  const sortParam = firstParam(query.sort);
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(sortParam ?? "")
    ? (sortParam as SortKey)
    : "revenue";
  const dir = firstParam(query.dir) === "asc" ? "asc" : "desc";
  const direction = dir === "asc" ? 1 : -1;

  const sortedStats = [...filteredStats].sort((a, b) => {
    switch (sortKey) {
      case "name":
        return a.name.localeCompare(b.name, "ru") * direction;
      case "qty":
        return (a.quantity - b.quantity) * direction;
      case "attach":
        return compareNullable(a.attachPerPortion, b.attachPerPortion, direction);
      case "foodcost":
        return compareNullable(a.foodcostPercent, b.foodcostPercent, direction);
      case "delta":
        return compareNullable(a.deltaPercent, b.deltaPercent, direction);
      default:
        return (a.revenue - b.revenue) * direction;
    }
  });

  // Ранг блюда — всегда по выручке в текущем скоупе, независимо от сортировки.
  const rankByDish = new Map<string, number>();
  [...stats]
    .sort((a, b) => b.revenue - a.revenue)
    .forEach((stat, index) => rankByDish.set(stat.dishId, index + 1));

  // ---- Итоговые карточки.
  const sumBy = (
    rows: CategorySummaryRow[],
    predicate: (row: CategorySummaryRow) => boolean,
    field: "revenue" | "quantity" | "cost",
  ) =>
    rows
      .filter(predicate)
      .reduce((sum, row) => sum + toNumber(row[field]), 0);

  const totalRevenue = sumBy(cats, () => true, "revenue");
  const prevTotalRevenue = sumBy(catsPrev, () => true, "revenue");
  const dishQuantity = sumBy(cats, (row) => row.dish_type === "DISH", "quantity");
  const prevDishQuantity = sumBy(
    catsPrev,
    (row) => row.dish_type === "DISH",
    "quantity",
  );
  const modifierRevenue = sumBy(cats, (row) => row.dish_type === "MODIFIER", "revenue");
  const totalCost = sumBy(cats, () => true, "cost");
  const prevTotalCost = sumBy(catsPrev, () => true, "cost");

  const revenueDelta =
    prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 : null;
  const quantityDelta =
    prevDishQuantity > 0 ? ((dishQuantity - prevDishQuantity) / prevDishQuantity) * 100 : null;
  const foodcostPercent = totalRevenue > 0 && totalCost > 0 ? (totalCost / totalRevenue) * 100 : null;
  const prevFoodcostPercent =
    prevTotalRevenue > 0 && prevTotalCost > 0 ? (prevTotalCost / prevTotalRevenue) * 100 : null;

  const dishesRevenue = stats.reduce((sum, stat) => sum + stat.revenue, 0);
  const top10Revenue = [...stats]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .reduce((sum, stat) => sum + stat.revenue, 0);
  const top10Share = dishesRevenue > 0 ? (top10Revenue / dishesRevenue) * 100 : null;

  // ---- «Требует внимания» (с учётом фильтров категории и поиска).
  const currentIds = new Set(stats.map((stat) => stat.dishId));

  const drops = filteredStats
    .filter(
      (stat) =>
        stat.deltaPercent !== null &&
        stat.deltaPercent <= -25 &&
        (stat.prevRevenue ?? 0) >= 1000,
    )
    .sort((a, b) => (a.deltaPercent ?? 0) - (b.deltaPercent ?? 0));

  const gone = Array.from(prevDishes.entries())
    .filter(
      ([dishId, dish]) =>
        !currentIds.has(dishId) &&
        dish.revenue > 0 &&
        (!selectedCategory || dish.category === selectedCategory) &&
        (!searchLower || dish.name.toLowerCase().includes(searchLower)),
    )
    .sort((a, b) => b[1].revenue - a[1].revenue);

  const doubleC = filteredStats
    .filter((stat) => stat.abc === "C" && prevAbc.get(stat.dishId) === "C")
    .sort((a, b) => a.revenue - b.revenue);

  const attentionCount = drops.length + gone.length + doubleC.length;

  // ---- Категорийная сводка для вкладки.
  const categoryRows = cats
    .filter((row) => row.dish_type === "DISH")
    .map((row) => {
      const name = row.category ?? NO_CATEGORY;
      const revenue = toNumber(row.revenue);
      const cost = toNumber(row.cost);
      const prevRow = catsPrev.find(
        (candidate) =>
          candidate.dish_type === "DISH" && (candidate.category ?? NO_CATEGORY) === name,
      );
      const prevRevenue = prevRow ? toNumber(prevRow.revenue) : 0;
      return {
        name,
        quantity: toNumber(row.quantity),
        revenue,
        share: dishesRevenue > 0 ? (revenue / dishesRevenue) * 100 : 0,
        foodcost: revenue > 0 && cost > 0 ? (cost / revenue) * 100 : null,
        delta: prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const lastImportAt = lastImportResult.data?.imported_at
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      }).format(new Date(lastImportResult.data.imported_at))
    : null;

  const hasAnyData = stats.length > 0 || prevDishes.size > 0 || cats.length > 0;

  // ---- Ссылки с сохранением остальных фильтров.
  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const merged: Record<string, string | undefined> = {
      from,
      to,
      unit: unitId ?? undefined,
      cat: selectedCategory ?? undefined,
      q: searchText || undefined,
      tab: tab === "dishes" ? undefined : tab,
      sort: sortKey === "revenue" ? undefined : sortKey,
      dir: dir === "desc" ? undefined : dir,
      ...overrides,
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const queryString = params.toString();
    return queryString ? `/analytics?${queryString}` : "/analytics";
  };

  const sortHref = (key: SortKey): string =>
    buildHref({
      sort: key === "revenue" ? undefined : key,
      dir: sortKey === key && dir === "desc" ? "asc" : undefined,
    });

  const sortMark = (key: SortKey): string =>
    sortKey === key ? (dir === "desc" ? " ↓" : " ↑") : "";

  const dishHref = (dishId: string): string => {
    const params = new URLSearchParams({ from, to });
    if (unitId) params.set("unit", unitId);
    return `/analytics/dish/${dishId}?${params.toString()}`;
  };

  const presets = periodPresets();

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />

      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Дашборд</Link>
          <span>/</span>
          <strong>Товарная аналитика</strong>
        </nav>

        <section className="analytics-header">
          <div>
            <h1>Товарная аналитика</h1>
            <p className="muted">
              Продажи блюд из iiko: {formatDate(from)} — {formatDate(to)}
              {selectedUnit ? ` · ${selectedUnit.name}` : " · все рестораны"}
              {lastImportAt ? ` · данные обновлены ${lastImportAt}` : ""}
            </p>
          </div>
          <div className="analytics-actions">
            <a
              className="action-button"
              href={`/api/dish-sales/export?${new URLSearchParams({
                from,
                to,
                ...(unitId ? { unit: unitId } : {}),
                ...(selectedCategory ? { cat: selectedCategory } : {}),
                ...(searchText ? { q: searchText } : {}),
              }).toString()}`}
            >
              Экспорт CSV
            </a>
            <AnalyticsRefreshButton from={from} to={to} />
          </div>
        </section>

        <section className="content-card">
          <div className="preset-row">
            {presets.map((preset) => {
              const active = preset.from === from && preset.to === to;
              return (
                <Link
                  key={preset.key}
                  href={buildHref({ from: preset.from, to: preset.to })}
                  className={`preset-chip${active ? " active" : ""}`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </div>

          <form
            key={`${from}|${to}|${unitId ?? "all"}|${selectedCategory ?? "all"}|${searchText}`}
            className="filter-form analytics-filter"
            method="get"
            action="/analytics"
          >
            <label>
              <span>С</span>
              <input className="form-input" type="date" name="from" defaultValue={from} />
            </label>
            <label>
              <span>По</span>
              <input className="form-input" type="date" name="to" defaultValue={to} />
            </label>
            <label>
              <span>Ресторан</span>
              <select name="unit" defaultValue={unitId ?? ""}>
                <option value="">Все рестораны</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Категория</span>
              <select name="cat" defaultValue={selectedCategory ?? ""}>
                <option value="">Все категории</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Поиск</span>
              <input
                className="form-input"
                type="text"
                name="q"
                placeholder="Название блюда"
                defaultValue={searchText}
              />
            </label>
            <button type="submit" className="action-button primary">
              Показать
            </button>
          </form>
        </section>

        {!hasAnyData ? (
          <section className="content-card">
            <div className="empty-state">
              Продаж в базе пока нет. Нажми «Обновить из iiko» — портал заберёт
              продажи за выбранный период и построит отчёт.
            </div>
          </section>
        ) : (
          <>
            <section className="metric-grid">
              <article className="metric-card">
                <span>Выручка за период</span>
                <strong className="metric-money">{formatMoneyWhole(totalRevenue)}</strong>
                <small className={revenueDelta !== null && revenueDelta < 0 ? "delta-down" : "delta-up"}>
                  {revenueDelta === null
                    ? "прошлый период пуст"
                    : `${formatDeltaPercent(revenueDelta)} к прошлому периоду`}
                </small>
              </article>
              <article className="metric-card">
                <span>Продано порций</span>
                <strong>{formatQuantity(dishQuantity)}</strong>
                <small className={quantityDelta !== null && quantityDelta < 0 ? "delta-down" : "delta-up"}>
                  {quantityDelta === null
                    ? "прошлый период пуст"
                    : `${formatDeltaPercent(quantityDelta)} к прошлому периоду`}
                </small>
              </article>
              <article className="metric-card">
                <span>Допы модификаторами</span>
                <strong className="metric-money">{formatMoneyWhole(modifierRevenue)}</strong>
                <small>
                  {totalRevenue > 0
                    ? `${((modifierRevenue / totalRevenue) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% выручки`
                    : "—"}
                </small>
              </article>
              <article className="metric-card">
                <span>Фудкост</span>
                <strong>
                  {foodcostPercent === null
                    ? "—"
                    : `${foodcostPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}
                </strong>
                <small>
                  {foodcostPercent !== null && prevFoodcostPercent !== null
                    ? `был ${prevFoodcostPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`
                    : "по себестоимости iiko"}
                </small>
              </article>
              <article className="metric-card">
                <span>Топ-10 блюд</span>
                <strong>
                  {top10Share === null
                    ? "—"
                    : `${top10Share.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%`}
                </strong>
                <small>доля в выручке блюд</small>
              </article>
              <article className="metric-card">
                <span>Позиций продавалось</span>
                <strong>{stats.length}</strong>
                <small>
                  {gone.length > 0
                    ? `${gone.length} пропали из продажи`
                    : "все позиции прошлого периода на месте"}
                </small>
              </article>
            </section>

            <section className="content-card">
              <div className="tab-row">
                <Link
                  href={buildHref({ tab: undefined })}
                  className={`tab-link${tab === "dishes" ? " active" : ""}`}
                >
                  Все блюда
                </Link>
                <Link
                  href={buildHref({ tab: "categories" })}
                  className={`tab-link${tab === "categories" ? " active" : ""}`}
                >
                  По категориям
                </Link>
                <Link
                  href={buildHref({ tab: "attention" })}
                  className={`tab-link${tab === "attention" ? " active" : ""}`}
                >
                  Требует внимания
                  {attentionCount > 0 && <span className="tab-count">{attentionCount}</span>}
                </Link>
              </div>

              {tab === "dishes" && (
                <div className="payroll-table-wrap">
                  <table className="payroll-table">
                    <thead>
                      <tr>
                        <th className="numeric">№</th>
                        <th>
                          <Link className="th-sort" href={sortHref("name")}>
                            Блюдо{sortMark("name")}
                          </Link>
                        </th>
                        <th>Категория</th>
                        <th className="numeric">
                          <Link className="th-sort" href={sortHref("qty")}>
                            Шт{sortMark("qty")}
                          </Link>
                        </th>
                        <th className="numeric">
                          <Link className="th-sort" href={sortHref("revenue")}>
                            Выручка{sortMark("revenue")}
                          </Link>
                        </th>
                        <th className="numeric">Доля</th>
                        <th className="numeric">
                          <Link className="th-sort" href={sortHref("attach")}>
                            Допы ₽/порц.{sortMark("attach")}
                          </Link>
                        </th>
                        <th className="numeric">
                          <Link className="th-sort" href={sortHref("foodcost")}>
                            Фудкост{sortMark("foodcost")}
                          </Link>
                        </th>
                        <th className="numeric">
                          <Link className="th-sort" href={sortHref("delta")}>
                            К прошлому{sortMark("delta")}
                          </Link>
                        </th>
                        <th>Класс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedStats.length === 0 ? (
                        <tr>
                          <td colSpan={10}>
                            <div className="empty-state">
                              По выбранным фильтрам блюд не найдено.
                            </div>
                          </td>
                        </tr>
                      ) : (
                        sortedStats.map((stat) => (
                          <tr key={stat.dishId}>
                            <td className="numeric dim">{rankByDish.get(stat.dishId)}</td>
                            <td>
                              <Link className="dish-link" href={dishHref(stat.dishId)}>
                                {stat.name}
                              </Link>
                            </td>
                            <td className="dim">{stat.category}</td>
                            <td className="numeric">{formatQuantity(stat.quantity)}</td>
                            <td className="numeric money-cell">
                              {formatMoneyWhole(stat.revenue)}
                            </td>
                            <td className="numeric">
                              {stat.share.toLocaleString("ru-RU", {
                                maximumFractionDigits: 1,
                              })}
                              %
                            </td>
                            <td className="numeric">
                              {stat.attachPerPortion === null || stat.attachPerPortion === 0
                                ? "—"
                                : formatMoneyWhole(stat.attachPerPortion)}
                            </td>
                            <td className="numeric">
                              {stat.foodcostPercent === null
                                ? "—"
                                : `${stat.foodcostPercent.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%`}
                            </td>
                            <td
                              className={`numeric ${
                                stat.deltaPercent === null
                                  ? "delta-new"
                                  : stat.deltaPercent < 0
                                    ? "delta-down"
                                    : "delta-up"
                              }`}
                            >
                              {formatDeltaPercent(stat.deltaPercent)}
                            </td>
                            <td>
                              <span className={`abc-badge abc-${stat.abc.toLowerCase()}`}>
                                {stat.abc}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "categories" && (
                <div className="payroll-table-wrap">
                  <table className="payroll-table">
                    <thead>
                      <tr>
                        <th>Категория</th>
                        <th className="numeric">Шт</th>
                        <th className="numeric">Выручка</th>
                        <th className="numeric">Доля</th>
                        <th className="numeric">Фудкост</th>
                        <th className="numeric">К прошлому</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRows.map((row) => (
                        <tr key={row.name}>
                          <td>
                            <Link
                              className="dish-link"
                              href={buildHref({ cat: row.name, tab: undefined })}
                            >
                              {row.name}
                            </Link>
                          </td>
                          <td className="numeric">{formatQuantity(row.quantity)}</td>
                          <td className="numeric money-cell">
                            {formatMoneyWhole(row.revenue)}
                          </td>
                          <td className="numeric">
                            {row.share.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%
                          </td>
                          <td className="numeric">
                            {row.foodcost === null
                              ? "—"
                              : `${row.foodcost.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%`}
                          </td>
                          <td
                            className={`numeric ${
                              row.delta === null
                                ? "delta-new"
                                : row.delta < 0
                                  ? "delta-down"
                                  : "delta-up"
                            }`}
                          >
                            {formatDeltaPercent(row.delta)}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="dim">Платные допы (модификаторы)</td>
                        <td className="numeric dim">—</td>
                        <td className="numeric money-cell">
                          {formatMoneyWhole(modifierRevenue)}
                        </td>
                        <td className="numeric dim">
                          {totalRevenue > 0
                            ? `${((modifierRevenue / totalRevenue) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`
                            : "—"}
                        </td>
                        <td className="numeric dim">—</td>
                        <td className="numeric dim">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "attention" && (
                <div className="attention-blocks">
                  <div>
                    <h3>Падение продаж на 25% и больше</h3>
                    {drops.length === 0 ? (
                      <div className="empty-state">Резких падений нет.</div>
                    ) : (
                      <div className="payroll-table-wrap">
                        <table className="payroll-table">
                          <thead>
                            <tr>
                              <th>Блюдо</th>
                              <th>Категория</th>
                              <th className="numeric">Было</th>
                              <th className="numeric">Стало</th>
                              <th className="numeric">Δ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drops.map((stat) => (
                              <tr key={stat.dishId}>
                                <td>
                                  <Link className="dish-link" href={dishHref(stat.dishId)}>
                                    {stat.name}
                                  </Link>
                                </td>
                                <td className="dim">{stat.category}</td>
                                <td className="numeric">
                                  {formatMoneyWhole(stat.prevRevenue ?? 0)}
                                </td>
                                <td className="numeric">{formatMoneyWhole(stat.revenue)}</td>
                                <td className="numeric delta-down">
                                  {formatDeltaPercent(stat.deltaPercent)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3>Пропали из продажи</h3>
                    <p className="muted attention-note">
                      Продавались в прошлом периоде ({formatDate(prev.from)} —{" "}
                      {formatDate(prev.to)}), а в текущем — ни одной продажи.
                    </p>
                    {gone.length === 0 ? (
                      <div className="empty-state">Таких позиций нет.</div>
                    ) : (
                      <div className="payroll-table-wrap">
                        <table className="payroll-table">
                          <thead>
                            <tr>
                              <th>Блюдо</th>
                              <th>Категория</th>
                              <th className="numeric">Шт было</th>
                              <th className="numeric">Выручка была</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gone.map(([dishId, dish]) => (
                              <tr key={dishId}>
                                <td>
                                  <Link className="dish-link" href={dishHref(dishId)}>
                                    {dish.name}
                                  </Link>
                                </td>
                                <td className="dim">{dish.category}</td>
                                <td className="numeric">{formatQuantity(dish.quantity)}</td>
                                <td className="numeric">{formatMoneyWhole(dish.revenue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3>Класс C два периода подряд</h3>
                    <p className="muted attention-note">
                      Хвост меню и сейчас, и в прошлом периоде — кандидаты на вывод
                      или переработку.
                    </p>
                    {doubleC.length === 0 ? (
                      <div className="empty-state">Таких позиций нет.</div>
                    ) : (
                      <div className="payroll-table-wrap">
                        <table className="payroll-table">
                          <thead>
                            <tr>
                              <th>Блюдо</th>
                              <th>Категория</th>
                              <th className="numeric">Шт</th>
                              <th className="numeric">Выручка</th>
                              <th className="numeric">Доля</th>
                            </tr>
                          </thead>
                          <tbody>
                            {doubleC.map((stat) => (
                              <tr key={stat.dishId}>
                                <td>
                                  <Link className="dish-link" href={dishHref(stat.dishId)}>
                                    {stat.name}
                                  </Link>
                                </td>
                                <td className="dim">{stat.category}</td>
                                <td className="numeric">{formatQuantity(stat.quantity)}</td>
                                <td className="numeric">{formatMoneyWhole(stat.revenue)}</td>
                                <td className="numeric">
                                  {stat.share.toLocaleString("ru-RU", {
                                    maximumFractionDigits: 1,
                                  })}
                                  %
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
