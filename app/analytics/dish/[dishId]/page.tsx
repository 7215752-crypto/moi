import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoneyWhole, formatShortDate } from "@/lib/format";
import {
  computeDishStats,
  defaultRange,
  formatDeltaPercent,
  formatQuantity,
  formatWaitMinutes,
  isValidIsoDate,
  previousRange,
  toNumber,
  type DishSummaryRow,
} from "@/lib/dish-sales";

type Props = {
  params: Promise<{ dishId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type SalesRow = {
  sale_date: string;
  business_unit_id: string;
  dish_id: string;
  dish_name: string;
  dish_type: "DISH" | "MODIFIER";
  main_dish_id: string | null;
  category: string | null;
  cooking_place: string | null;
  quantity: number | string;
  revenue: number | string;
  cost: number | string | null;
  avg_guest_wait_seconds: number | string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DishCardPage({ params, searchParams }: Props) {
  const { dishId } = await params;
  if (!UUID_PATTERN.test(dishId)) notFound();

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
  const units = unitsResult.data ?? [];

  const unitParam = firstParam(query.unit);
  const selectedUnit = units.find((unit) => unit.id === unitParam) ?? null;
  const unitId = selectedUnit?.id ?? null;

  // Все строки блюда и его модификаторов за период — постранично
  // (PostgREST отдаёт максимум 1000 строк за запрос).
  const fetchSalesRows = async (): Promise<SalesRow[]> => {
    const pageSize = 1000;
    const rows: SalesRow[] = [];
    for (let offset = 0; ; offset += pageSize) {
      let request = supabase
        .from("dish_sales_daily")
        .select(
          "sale_date, business_unit_id, dish_id, dish_name, dish_type, main_dish_id, category, cooking_place, quantity, revenue, cost, avg_guest_wait_seconds",
        )
        .gte("sale_date", from)
        .lte("sale_date", to)
        .or(`dish_id.eq.${dishId},main_dish_id.eq.${dishId}`)
        .order("sale_date", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (unitId) request = request.eq("business_unit_id", unitId);

      const { data, error } = await request;
      if (error) throw new Error(`Продажи блюда: ${error.message}`);
      rows.push(...((data ?? []) as SalesRow[]));
      if ((data ?? []).length < pageSize) break;
    }
    return rows;
  };

  const [rows, currentSummary, prevSummary] = await Promise.all([
    fetchSalesRows(),
    supabase.rpc("dish_sales_summary", { p_from: from, p_to: to, p_unit: unitId }),
    supabase.rpc("dish_sales_summary", {
      p_from: prev.from,
      p_to: prev.to,
      p_unit: unitId,
    }),
  ]);

  if (currentSummary.error) {
    throw new Error(`Сводка продаж: ${currentSummary.error.message}`);
  }

  const { stats } = computeDishStats(
    (currentSummary.data ?? []) as DishSummaryRow[],
    ((prevSummary.error ? [] : prevSummary.data) ?? []) as DishSummaryRow[],
  );
  const stat = stats.find((candidate) => candidate.dishId === dishId) ?? null;
  const rank =
    stat === null
      ? null
      : [...stats].sort((a, b) => b.revenue - a.revenue).findIndex((s) => s.dishId === dishId) + 1;

  const dishRows = rows.filter(
    (row) => row.dish_type === "DISH" && row.dish_id === dishId,
  );
  const modRows = rows.filter(
    (row) => row.dish_type === "MODIFIER" && row.main_dish_id === dishId,
  );

  // Имя блюда: из продаж, из сводки прошлого периода или из справочника номенклатуры.
  let dishName: string | null = dishRows[0]?.dish_name ?? stat?.name ?? null;
  let category: string | null = dishRows[0]?.category ?? stat?.category ?? null;
  if (!dishName) {
    const prevRow = ((prevSummary.data ?? []) as DishSummaryRow[]).find(
      (row) => row.dish_id === dishId,
    );
    dishName = prevRow?.dish_name ?? null;
    category = category ?? prevRow?.category ?? null;
  }
  if (!dishName) {
    const { data: product } = await supabase
      .from("iiko_products")
      .select("name")
      .eq("id", dishId)
      .maybeSingle();
    dishName = product?.name ?? null;
  }
  if (!dishName) notFound();

  const quantity = dishRows.reduce((sum, row) => sum + toNumber(row.quantity), 0);
  const revenue = dishRows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  const attachRevenue = modRows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  const averagePrice = quantity > 0 ? revenue / quantity : null;

  let waitWeighted = 0;
  let waitQuantity = 0;
  for (const row of dishRows) {
    const wait = row.avg_guest_wait_seconds;
    const rowQuantity = toNumber(row.quantity);
    if (wait !== null && wait !== undefined && rowQuantity > 0) {
      waitWeighted += toNumber(wait) * rowQuantity;
      waitQuantity += rowQuantity;
    }
  }
  const avgWaitSeconds = waitQuantity > 0 ? waitWeighted / waitQuantity : null;

  // Разбивка по ресторанам.
  const unitNameById = new Map(units.map((unit) => [unit.id, unit.name]));
  const byUnit = new Map<string, { quantity: number; revenue: number }>();
  for (const row of dishRows) {
    const entry = byUnit.get(row.business_unit_id) ?? { quantity: 0, revenue: 0 };
    entry.quantity += toNumber(row.quantity);
    entry.revenue += toNumber(row.revenue);
    byUnit.set(row.business_unit_id, entry);
  }
  const unitRows = Array.from(byUnit.entries())
    .map(([id, entry]) => ({
      name: unitNameById.get(id) ?? "Неизвестный ресторан",
      ...entry,
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const maxUnitRevenue = unitRows[0]?.revenue ?? 0;

  // Время отдачи по месту приготовления (взвешенное по количеству).
  const byPlace = new Map<string, { weighted: number; quantity: number }>();
  for (const row of dishRows) {
    const wait = row.avg_guest_wait_seconds;
    const rowQuantity = toNumber(row.quantity);
    if (wait === null || wait === undefined || rowQuantity <= 0) continue;
    const place = row.cooking_place ?? "Без места приготовления";
    const entry = byPlace.get(place) ?? { weighted: 0, quantity: 0 };
    entry.weighted += toNumber(wait) * rowQuantity;
    entry.quantity += rowQuantity;
    byPlace.set(place, entry);
  }
  const placeRows = Array.from(byPlace.entries())
    .map(([place, entry]) => ({
      place,
      quantity: entry.quantity,
      waitSeconds: entry.weighted / entry.quantity,
    }))
    .sort((a, b) => b.quantity - a.quantity);

  // Модификаторы блюда.
  const byModifier = new Map<
    string,
    { name: string; quantity: number; revenue: number }
  >();
  for (const row of modRows) {
    const entry = byModifier.get(row.dish_id) ?? {
      name: row.dish_name,
      quantity: 0,
      revenue: 0,
    };
    entry.quantity += toNumber(row.quantity);
    entry.revenue += toNumber(row.revenue);
    byModifier.set(row.dish_id, entry);
  }
  const paidModifiers = Array.from(byModifier.values())
    .filter((modifier) => modifier.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const freeModifiers = Array.from(byModifier.values())
    .filter((modifier) => modifier.revenue === 0)
    .sort((a, b) => b.quantity - a.quantity);

  // Себестоимость и фудкост за период.
  const totalCost = dishRows.reduce((sum, row) => sum + toNumber(row.cost), 0);
  const foodcostPercent = revenue > 0 && totalCost > 0 ? (totalCost / revenue) * 100 : null;

  // Динамика фудкоста по дням — для графика.
  const byDay = new Map<string, { revenue: number; cost: number }>();
  for (const row of dishRows) {
    const entry = byDay.get(row.sale_date) ?? { revenue: 0, cost: 0 };
    entry.revenue += toNumber(row.revenue);
    entry.cost += toNumber(row.cost);
    byDay.set(row.sale_date, entry);
  }
  const foodcostPoints = Array.from(byDay.entries())
    .filter(([, entry]) => entry.revenue > 0 && entry.cost > 0)
    .map(([date, entry]) => ({ date, value: (entry.cost / entry.revenue) * 100 }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Геометрия SVG-графика: линия растягивается на всю ширину карточки.
  const chartWidth = 600;
  const chartHeight = 160;
  const chartValues = foodcostPoints.map((point) => point.value);
  const chartLow = Math.max(Math.floor(Math.min(...chartValues)) - 3, 0);
  const chartHigh = Math.ceil(Math.max(...chartValues)) + 3;
  const chartY = (value: number) =>
    chartHeight - 8 - ((value - chartLow) / (chartHigh - chartLow)) * (chartHeight - 16);
  const chartX = (index: number) =>
    foodcostPoints.length > 1
      ? (index / (foodcostPoints.length - 1)) * chartWidth
      : chartWidth / 2;
  const chartLinePoints = foodcostPoints
    .map((point, index) => `${chartX(index).toFixed(1)},${chartY(point.value).toFixed(1)}`)
    .join(" ");
  const chartAverage =
    chartValues.length > 0
      ? chartValues.reduce((sum, value) => sum + value, 0) / chartValues.length
      : null;

  const backHref = (() => {
    const params = new URLSearchParams({ from, to });
    if (unitId) params.set("unit", unitId);
    return `/analytics?${params.toString()}`;
  })();

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />

      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Дашборд</Link>
          <span>/</span>
          <Link href={backHref}>Товарная аналитика</Link>
          <span>/</span>
          <strong>{dishName}</strong>
        </nav>

        <section className="analytics-header">
          <div>
            <h1>{dishName}</h1>
            <p className="muted dish-meta-line">
              {stat && (
                <span className={`abc-badge abc-${stat.abc.toLowerCase()}`}>
                  Класс {stat.abc}
                </span>
              )}
              <span>
                {category ?? "Без группы"}
                {averagePrice !== null
                  ? ` · средняя цена ${formatMoneyWhole(averagePrice)}`
                  : ""}
                {rank ? ` · №${rank} по выручке` : ""}
              </span>
            </p>
            <p className="muted">
              {formatDate(from)} — {formatDate(to)}
              {selectedUnit ? ` · ${selectedUnit.name}` : " · все рестораны"}
            </p>
          </div>
          <div className="analytics-actions">
            <a
              className="action-button"
              href={`/analytics/dish/${dishId}/chart`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Техкарта ↗
            </a>
          </div>
        </section>

        <section className="metric-grid">
          <article className="metric-card">
            <span>Продано</span>
            <strong>{formatQuantity(quantity)}</strong>
            <small
              className={
                stat?.deltaPercent !== null && stat !== null && (stat.deltaPercent ?? 0) < 0
                  ? "delta-down"
                  : "delta-up"
              }
            >
              {stat === null || quantity === 0
                ? "в выбранном периоде не продавалось"
                : stat.deltaPercent === null
                  ? "в прошлом периоде не продавалось"
                  : `${formatDeltaPercent(stat.deltaPercent)} к прошлому периоду`}
            </small>
          </article>
          <article className="metric-card">
            <span>Выручка</span>
            <strong className="metric-money">{formatMoneyWhole(revenue)}</strong>
            <small>
              {stat
                ? `${stat.share.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% выручки блюд`
                : "—"}
            </small>
          </article>
          <article className="metric-card">
            <span>Допы к блюду</span>
            <strong className="metric-money">{formatMoneyWhole(attachRevenue)}</strong>
            <small>
              {quantity > 0 && attachRevenue > 0
                ? `${formatMoneyWhole(attachRevenue / quantity)} на порцию`
                : "платных допов нет"}
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
              {foodcostPercent === null
                ? "нет себестоимости в iiko"
                : `себестоимость ${formatMoneyWhole(totalCost)}`}
            </small>
          </article>
          <article className="metric-card">
            <span>Время отдачи</span>
            <strong>{formatWaitMinutes(avgWaitSeconds)}</strong>
            <small>от заказа до выдачи, среднее</small>
          </article>
        </section>

        <div className="dish-card-grid">
          <section className="content-card">
            <div className="compact-section-heading">
              <h2>Продажи по ресторанам</h2>
            </div>
            {unitRows.length === 0 ? (
              <div className="empty-state">Продаж за период нет.</div>
            ) : (
              <div>
                {unitRows.map((row) => (
                  <div className="unit-bar-row" key={row.name}>
                    <div className="unit-bar-head">
                      <span>{row.name}</span>
                      <span>
                        {formatQuantity(row.quantity)} шт · {formatMoneyWhole(row.revenue)}
                      </span>
                    </div>
                    <div className="unit-bar-track">
                      <div
                        className="unit-bar-fill"
                        style={{
                          width: `${maxUnitRevenue > 0 ? Math.max((row.revenue / maxUnitRevenue) * 100, 2) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="content-card">
            <div className="compact-section-heading">
              <h2>Время отдачи по месту приготовления</h2>
              <p>По событиям кухонного экрана iiko, взвешено по количеству.</p>
            </div>
            {placeRows.length === 0 ? (
              <div className="empty-state">
                Нет данных кухонного экрана за период.
              </div>
            ) : (
              <div className="payroll-table-wrap">
                <table className="payroll-table">
                  <thead>
                    <tr>
                      <th>Место приготовления</th>
                      <th className="numeric">Шт</th>
                      <th className="numeric">Время отдачи</th>
                    </tr>
                  </thead>
                  <tbody>
                    {placeRows.map((row) => (
                      <tr key={row.place}>
                        <td>{row.place}</td>
                        <td className="numeric">{formatQuantity(row.quantity)}</td>
                        <td className="numeric">{formatWaitMinutes(row.waitSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="content-card">
            <div className="compact-section-heading">
              <h2>Что блюдо тянет за собой</h2>
              <p>Модификаторы, проданные вместе с блюдом за период.</p>
            </div>
            {paidModifiers.length === 0 && freeModifiers.length === 0 ? (
              <div className="empty-state">Модификаторов у блюда не было.</div>
            ) : (
              <>
                {paidModifiers.length > 0 && (
                  <div className="payroll-table-wrap">
                    <table className="payroll-table">
                      <thead>
                        <tr>
                          <th>Платный доп</th>
                          <th className="numeric">Шт</th>
                          <th className="numeric">На 100 порций</th>
                          <th className="numeric">Деньги</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paidModifiers.map((modifier) => (
                          <tr key={modifier.name}>
                            <td>{modifier.name}</td>
                            <td className="numeric">{formatQuantity(modifier.quantity)}</td>
                            <td className="numeric">
                              {quantity > 0
                                ? Math.round((modifier.quantity / quantity) * 100)
                                : "—"}
                            </td>
                            <td className="numeric money-cell">
                              {formatMoneyWhole(modifier.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {freeModifiers.length > 0 && (
                  <p className="muted attention-note" style={{ marginTop: 10 }}>
                    Бесплатные:{" "}
                    {freeModifiers
                      .slice(0, 6)
                      .map(
                        (modifier) =>
                          `${modifier.name} (${formatQuantity(modifier.quantity)})`,
                      )
                      .join(", ")}
                    {freeModifiers.length > 6
                      ? ` и ещё ${freeModifiers.length - 6}`
                      : ""}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="content-card span-full">
            <div className="compact-section-heading">
              <h2>Динамика фудкоста</h2>
              <p>Себестоимость к выручке по дням периода.</p>
            </div>
            {foodcostPoints.length < 2 ? (
              <div className="empty-state">
                Недостаточно данных для графика — нужно хотя бы два дня продаж
                с себестоимостью.
              </div>
            ) : (
              <div>
                <div className="foodcost-chart-meta">
                  <span>
                    средний{" "}
                    {chartAverage?.toLocaleString("ru-RU", {
                      maximumFractionDigits: 1,
                    })}
                    %
                  </span>
                  <span>
                    мин{" "}
                    {Math.min(...chartValues).toLocaleString("ru-RU", {
                      maximumFractionDigits: 1,
                    })}
                    % · макс{" "}
                    {Math.max(...chartValues).toLocaleString("ru-RU", {
                      maximumFractionDigits: 1,
                    })}
                    % · последний день{" "}
                    {foodcostPoints[foodcostPoints.length - 1].value.toLocaleString(
                      "ru-RU",
                      { maximumFractionDigits: 1 },
                    )}
                    %
                  </span>
                </div>
                <svg
                  width="100%"
                  height={chartHeight}
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="График фудкоста по дням"
                >
                  {chartAverage !== null && (
                    <line
                      x1={0}
                      y1={chartY(chartAverage)}
                      x2={chartWidth}
                      y2={chartY(chartAverage)}
                      stroke="var(--line-strong)"
                      strokeDasharray="6 6"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <polyline
                    fill="none"
                    stroke="var(--green)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    points={chartLinePoints}
                  />
                </svg>
                <div className="foodcost-chart-dates">
                  <span>{formatShortDate(foodcostPoints[0].date)}</span>
                  <span>
                    {formatShortDate(foodcostPoints[foodcostPoints.length - 1].date)}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
