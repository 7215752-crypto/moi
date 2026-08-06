import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AnalyticsNav } from "@/components/analytics-nav";
import { AnalyticsRefreshButton } from "@/components/analytics-refresh-button";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoneyWhole, humanizeComponent } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Компоненты, которые не считаем затратами на персонал:
// покупки — удержание из зарплаты, сервисный сбор — надбавка из денег гостей.
const NOT_LABOR: ReadonlySet<string> = new Set(["purchase", "service_charge"]);

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1).replace(".", ",")} %`;
}

export default async function LaborCostPage({ searchParams }: Props) {
  const query = await searchParams;
  const { supabase, profile } = await requireUser();

  const periodsResult = await supabase
    .from("payroll_periods")
    .select("id, date_from, date_to")
    .order("date_from", { ascending: false })
    .limit(12);
  if (periodsResult.error) {
    throw new Error(`Периоды: ${periodsResult.error.message}`);
  }
  const periods = periodsResult.data ?? [];

  const periodParam = firstParam(query.period);
  const period = periods.find((row) => row.id === periodParam) ?? periods[0];

  if (!period) {
    return (
      <div className="app-shell">
        <SiteHeader profile={profile} />
        <main className="page-container">
          <AnalyticsNav current="/analytics/labor-cost" />
          <div className="empty-state">
            Нет расчётных периодов — сначала рассчитайте зарплату.
          </div>
        </main>
      </div>
    );
  }

  const [unitsResult, runsResult, revenueResult, hoursResult] =
    await Promise.all([
      supabase.from("business_units").select("id, name").order("name"),
      supabase
        .from("payroll_runs")
        .select("id, business_unit_id, version")
        .eq("payroll_period_id", period.id),
      supabase
        .from("dish_sales_daily")
        .select("business_unit_id, revenue")
        .gte("sale_date", period.date_from)
        .lte("sale_date", period.date_to),
      supabase
        .from("attendance_records")
        .select("business_unit_id, hours")
        .eq("payroll_period_id", period.id),
    ]);

  if (unitsResult.error) throw new Error(`Рестораны: ${unitsResult.error.message}`);
  if (runsResult.error) throw new Error(`Расчёты: ${runsResult.error.message}`);
  if (revenueResult.error)
    throw new Error(`Выручка: ${revenueResult.error.message}`);
  if (hoursResult.error) throw new Error(`Явки: ${hoursResult.error.message}`);

  const unitNameById = new Map<string, string>();
  for (const unit of unitsResult.data ?? []) unitNameById.set(unit.id, unit.name);

  // Последняя версия расчёта по каждому ресторану.
  const latestRunByUnit = new Map<string, { id: string; version: number }>();
  for (const run of runsResult.data ?? []) {
    const existing = latestRunByUnit.get(run.business_unit_id);
    if (!existing || run.version > existing.version) {
      latestRunByUnit.set(run.business_unit_id, {
        id: run.id,
        version: run.version,
      });
    }
  }

  const runIds = Array.from(latestRunByUnit.values()).map((run) => run.id);
  const runUnitById = new Map<string, string>();
  for (const [unitId, run] of latestRunByUnit.entries()) {
    runUnitById.set(run.id, unitId);
  }

  type LineRow = {
    payroll_run_id: string;
    component_type: string;
    amount: number | string;
  };
  let lines: LineRow[] = [];
  if (runIds.length > 0) {
    const linesResult = await supabase
      .from("payroll_lines")
      .select("payroll_run_id, component_type, amount")
      .in("payroll_run_id", runIds);
    if (linesResult.error)
      throw new Error(`Начисления: ${linesResult.error.message}`);
    lines = (linesResult.data ?? []) as LineRow[];
  }

  const laborByUnit = new Map<string, number>();
  const serviceByUnit = new Map<string, number>();
  const laborByComponent = new Map<string, number>();
  for (const line of lines) {
    const unitId = runUnitById.get(line.payroll_run_id);
    if (!unitId) continue;
    const amount = Number(line.amount ?? 0);
    if (line.component_type === "service_charge") {
      serviceByUnit.set(unitId, (serviceByUnit.get(unitId) ?? 0) + amount);
      continue;
    }
    if (NOT_LABOR.has(line.component_type)) continue;
    laborByUnit.set(unitId, (laborByUnit.get(unitId) ?? 0) + amount);
    laborByComponent.set(
      line.component_type,
      (laborByComponent.get(line.component_type) ?? 0) + amount,
    );
  }

  const revenueByUnit = new Map<string, number>();
  for (const row of revenueResult.data ?? []) {
    revenueByUnit.set(
      row.business_unit_id,
      (revenueByUnit.get(row.business_unit_id) ?? 0) + Number(row.revenue ?? 0),
    );
  }

  const hoursByUnit = new Map<string, number>();
  for (const row of hoursResult.data ?? []) {
    hoursByUnit.set(
      row.business_unit_id,
      (hoursByUnit.get(row.business_unit_id) ?? 0) + Number(row.hours ?? 0),
    );
  }

  const unitIds = Array.from(
    new Set([...laborByUnit.keys(), ...revenueByUnit.keys()]),
  );
  const rows = unitIds
    .map((unitId) => {
      const revenue = revenueByUnit.get(unitId) ?? 0;
      const labor = laborByUnit.get(unitId) ?? 0;
      const hours = hoursByUnit.get(unitId) ?? 0;
      return {
        unitId,
        name: unitNameById.get(unitId) ?? unitId,
        revenue,
        labor,
        hours,
        service: serviceByUnit.get(unitId) ?? 0,
        laborCost: revenue > 0 ? (labor / revenue) * 100 : null,
        splh: revenue > 0 && hours > 0 ? revenue / hours : null,
      };
    })
    .filter((row) => row.revenue > 0 || row.labor > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const totalLabor = rows.reduce((sum, row) => sum + row.labor, 0);
  const totalService = rows.reduce((sum, row) => sum + row.service, 0);
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const totalLaborCost =
    totalRevenue > 0 ? (totalLabor / totalRevenue) * 100 : null;
  const totalSplh =
    totalRevenue > 0 && totalHours > 0 ? totalRevenue / totalHours : null;

  const componentRows = Array.from(laborByComponent.entries())
    .filter(([, amount]) => Math.abs(amount) > 0.005)
    .sort((a, b) => b[1] - a[1]);

  const hasRevenue = totalRevenue > 0;

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Дашборд</Link>
          <span>/</span>
          <strong>Лейбор-кост</strong>
        </nav>

        <AnalyticsNav current="/analytics/labor-cost" />

        <section className="analytics-header">
          <div>
            <h1>Лейбор-кост</h1>
            <p className="muted">
              Доля затрат на персонал в выручке: {formatDate(period.date_from)} —{" "}
              {formatDate(period.date_to)}. ФОТ — последняя версия расчёта
              зарплаты; выручка — продажи блюд из iiko.
            </p>
          </div>
          <div className="analytics-actions">
            <form method="get">
              <select
                name="period"
                defaultValue={period.id}
                className="form-input"
              >
                {periods.map((row) => (
                  <option key={row.id} value={row.id}>
                    {formatDate(row.date_from)} — {formatDate(row.date_to)}
                  </option>
                ))}
              </select>{" "}
              <button type="submit" className="action-button">
                Показать
              </button>
            </form>
            <AnalyticsRefreshButton
              from={period.date_from}
              to={period.date_to}
            />
          </div>
        </section>

        {!hasRevenue && (
          <div className="notice warn">
            За этот период нет данных о выручке — нажмите «Обновить из iiko»
            (кнопка выше): портал заберёт продажи за{" "}
            {formatDate(period.date_from)} — {formatDate(period.date_to)}, и
            лейбор-кост с SPLH посчитаются.
          </div>
        )}

        <section className="metric-grid" style={{ margin: "18px 0" }}>
          <article className="metric-card accent">
            <span>Лейбор-кост</span>
            <strong>{percent(totalLaborCost)}</strong>
            <small>ФОТ ÷ выручка по всем ресторанам</small>
          </article>
          <article className="metric-card">
            <span>Выручка</span>
            <strong className="metric-money">
              {formatMoneyWhole(totalRevenue)}
            </strong>
            <small>продажи блюд за период</small>
          </article>
          <article className="metric-card">
            <span>ФОТ</span>
            <strong className="metric-money">
              {formatMoneyWhole(totalLabor)}
            </strong>
            <small>начисления без покупок и серв. сбора</small>
          </article>
          <article className="metric-card">
            <span>SPLH</span>
            <strong className="metric-money">
              {totalSplh === null ? "—" : formatMoneyWhole(totalSplh)}
            </strong>
            <small>
              выручка на человеко-час · {Math.round(totalHours)} ч за период
            </small>
          </article>
          <article className="metric-card">
            <span>Сервисный сбор</span>
            <strong className="metric-money">
              {formatMoneyWhole(totalService)}
            </strong>
            <small>выплачен из надбавки гостей, в ФОТ не входит</small>
          </article>
        </section>

        <section className="content-card" style={{ marginBottom: "22px" }}>
          <div className="section-heading">
            <div>
              <h2>По ресторанам</h2>
              <p>
                Ориентир для ресторанов — 20–30% в зависимости от формата.
              </p>
            </div>
          </div>
          <div className="payroll-table-wrap" style={{ marginTop: "12px" }}>
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Ресторан</th>
                  <th className="numeric">Выручка, ₽</th>
                  <th className="numeric">ФОТ, ₽</th>
                  <th className="numeric">Лейбор-кост</th>
                  <th className="numeric">Часы</th>
                  <th className="numeric">SPLH, ₽/ч</th>
                  <th className="numeric">Серв. сбор, ₽</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.unitId}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td className="numeric">{formatMoneyWhole(row.revenue)}</td>
                    <td className="numeric">{formatMoneyWhole(row.labor)}</td>
                    <td className="numeric">
                      <strong>{percent(row.laborCost)}</strong>
                    </td>
                    <td className="numeric">{Math.round(row.hours)}</td>
                    <td className="numeric">
                      {row.splh === null ? "—" : formatMoneyWhole(row.splh)}
                    </td>
                    <td className="numeric">{formatMoneyWhole(row.service)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Итого</strong>
                  </td>
                  <td className="numeric">
                    <strong>{formatMoneyWhole(totalRevenue)}</strong>
                  </td>
                  <td className="numeric">
                    <strong>{formatMoneyWhole(totalLabor)}</strong>
                  </td>
                  <td className="numeric">
                    <strong>{percent(totalLaborCost)}</strong>
                  </td>
                  <td className="numeric">
                    <strong>{Math.round(totalHours)}</strong>
                  </td>
                  <td className="numeric">
                    <strong>
                      {totalSplh === null ? "—" : formatMoneyWhole(totalSplh)}
                    </strong>
                  </td>
                  <td className="numeric">
                    <strong>{formatMoneyWhole(totalService)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="content-card">
          <div className="section-heading">
            <div>
              <h2>Из чего состоит ФОТ</h2>
              <p>Сумма по всем ресторанам за период.</p>
            </div>
          </div>
          <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
            {componentRows.map(([componentType, amount]) => (
              <div key={componentType} className="plain-row">
                <span>{humanizeComponent(componentType)}</span>
                <strong>{formatMoneyWhole(amount)}</strong>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
