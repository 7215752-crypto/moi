import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AnalyticsNav } from "@/components/analytics-nav";
import { requireUser } from "@/lib/auth";
import { fetchRevenueByDepartment } from "@/lib/iiko/olap";
import { normalizeName } from "@/lib/iiko/attendance";
import { formatDate, formatMoneyWhole, humanizeComponent } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Компоненты, которые не считаем затратами на персонал:
// покупки — удержание из зарплаты, сервисный сбор — надбавка из денег гостей.
const NOT_LABOR: ReadonlySet<string> = new Set(["purchase", "service_charge"]);

const NO_DEPARTMENT = "Без подразделения";

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

  const [unitsResult, runsResult, hoursResult, departmentsResult] =
    await Promise.all([
      supabase
        .from("business_units")
        .select("id, name, iiko_department")
        .order("name"),
      supabase
        .from("payroll_runs")
        .select("id, business_unit_id, version")
        .eq("payroll_period_id", period.id),
      supabase
        .from("attendance_records")
        .select("business_unit_id, department_id, employee_id, hours")
        .eq("payroll_period_id", period.id)
        .limit(5000),
      supabase.from("departments").select("id, name"),
    ]);

  if (unitsResult.error) throw new Error(`Рестораны: ${unitsResult.error.message}`);
  if (runsResult.error) throw new Error(`Расчёты: ${runsResult.error.message}`);
  if (hoursResult.error) throw new Error(`Явки: ${hoursResult.error.message}`);
  if (departmentsResult.error)
    throw new Error(`Подразделения: ${departmentsResult.error.message}`);

  const units = unitsResult.data ?? [];
  const unitNameById = new Map<string, string>();
  for (const unit of units) unitNameById.set(unit.id, unit.name);

  const departmentNameById = new Map<string, string>();
  for (const department of departmentsResult.data ?? []) {
    departmentNameById.set(department.id, department.name);
  }

  // Выручка живьём из iiko: без скидок (основа) и со скидками (справочно).
  let revenueError: string | null = null;
  const grossByUnit = new Map<string, number>();
  const netByUnit = new Map<string, number>();
  try {
    const revenue = await fetchRevenueByDepartment(
      period.date_from,
      period.date_to,
    );
    for (const row of revenue) {
      const key = normalizeName(row.departmentName);
      const unit = units.find((candidate) => {
        const unitKeys = [candidate.iiko_department, candidate.name]
          .filter(Boolean)
          .map((value) => normalizeName(String(value)));
        return unitKeys.some(
          (unitKey) =>
            unitKey === key ||
            unitKey.startsWith(key) ||
            key.startsWith(unitKey),
        );
      });
      if (!unit) continue;
      grossByUnit.set(unit.id, (grossByUnit.get(unit.id) ?? 0) + row.grossRevenue);
      netByUnit.set(unit.id, (netByUnit.get(unit.id) ?? 0) + row.netRevenue);
    }
  } catch (error) {
    revenueError =
      error instanceof Error ? error.message : "Не удалось получить выручку из iiko.";
  }

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
  const runUnitById = new Map<string, string>();
  for (const [unitId, run] of latestRunByUnit.entries()) {
    runUnitById.set(run.id, unitId);
  }
  const runIds = Array.from(runUnitById.keys());

  type LineRow = {
    payroll_run_id: string;
    employee_id: string;
    component_type: string;
    amount: number | string;
  };
  let lines: LineRow[] = [];
  if (runIds.length > 0) {
    const linesResult = await supabase
      .from("payroll_lines")
      .select("payroll_run_id, employee_id, component_type, amount")
      .in("payroll_run_id", runIds)
      .limit(5000);
    if (linesResult.error)
      throw new Error(`Начисления: ${linesResult.error.message}`);
    lines = (linesResult.data ?? []) as LineRow[];
  }

  // Часы: по ресторану, по подразделению и по сотруднику внутри ресторана
  // (сотрудника относим к подразделению, где у него больше часов).
  const hoursByUnit = new Map<string, number>();
  const hoursByUnitDepartment = new Map<string, number>(); // `${unitId}|${depName}`
  const employeeDepartmentHours = new Map<string, Map<string, number>>(); // `${unitId}|${employeeId}` → depName → hours
  for (const row of hoursResult.data ?? []) {
    const hours = Number(row.hours ?? 0);
    hoursByUnit.set(
      row.business_unit_id,
      (hoursByUnit.get(row.business_unit_id) ?? 0) + hours,
    );
    const depName = row.department_id
      ? (departmentNameById.get(row.department_id) ?? NO_DEPARTMENT)
      : NO_DEPARTMENT;
    const unitDepKey = `${row.business_unit_id}|${depName}`;
    hoursByUnitDepartment.set(
      unitDepKey,
      (hoursByUnitDepartment.get(unitDepKey) ?? 0) + hours,
    );
    const employeeKey = `${row.business_unit_id}|${row.employee_id}`;
    const byDep =
      employeeDepartmentHours.get(employeeKey) ?? new Map<string, number>();
    byDep.set(depName, (byDep.get(depName) ?? 0) + hours);
    employeeDepartmentHours.set(employeeKey, byDep);
  }

  const mainDepartmentOf = (unitId: string, employeeId: string): string => {
    const byDep = employeeDepartmentHours.get(`${unitId}|${employeeId}`);
    if (!byDep || byDep.size === 0) return NO_DEPARTMENT;
    return Array.from(byDep.entries()).sort((a, b) => b[1] - a[1])[0][0];
  };

  const laborByUnit = new Map<string, number>();
  const serviceByUnit = new Map<string, number>();
  const laborByComponent = new Map<string, number>();
  const laborByUnitDepartment = new Map<string, number>(); // `${unitId}|${depName}`
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
    const depKey = `${unitId}|${mainDepartmentOf(unitId, line.employee_id)}`;
    laborByUnitDepartment.set(
      depKey,
      (laborByUnitDepartment.get(depKey) ?? 0) + amount,
    );
  }

  const unitIds = Array.from(
    new Set([...laborByUnit.keys(), ...grossByUnit.keys()]),
  );
  const rows = unitIds
    .map((unitId) => {
      const gross = grossByUnit.get(unitId) ?? 0;
      const net = netByUnit.get(unitId) ?? 0;
      const labor = laborByUnit.get(unitId) ?? 0;
      const hours = hoursByUnit.get(unitId) ?? 0;
      return {
        unitId,
        name: unitNameById.get(unitId) ?? unitId,
        gross,
        discounts: gross - net,
        labor,
        hours,
        service: serviceByUnit.get(unitId) ?? 0,
        laborCost: gross > 0 ? (labor / gross) * 100 : null,
        splh: gross > 0 && hours > 0 ? gross / hours : null,
      };
    })
    .filter((row) => row.gross > 0 || row.labor > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const totalGross = rows.reduce((sum, row) => sum + row.gross, 0);
  const totalDiscounts = rows.reduce((sum, row) => sum + row.discounts, 0);
  const totalLabor = rows.reduce((sum, row) => sum + row.labor, 0);
  const totalService = rows.reduce((sum, row) => sum + row.service, 0);
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const totalLaborCost = totalGross > 0 ? (totalLabor / totalGross) * 100 : null;
  const totalSplh =
    totalGross > 0 && totalHours > 0 ? totalGross / totalHours : null;

  // Подразделения внутри концепций.
  const departmentRows = Array.from(laborByUnitDepartment.entries())
    .map(([key, labor]) => {
      const [unitId, depName] = key.split("|");
      const gross = grossByUnit.get(unitId) ?? 0;
      const hours = hoursByUnitDepartment.get(key) ?? 0;
      return {
        unitId,
        unitName: unitNameById.get(unitId) ?? unitId,
        depName,
        labor,
        hours,
        laborCost: gross > 0 ? (labor / gross) * 100 : null,
        costPerHour: hours > 0 ? labor / hours : null,
      };
    })
    .filter((row) => Math.abs(row.labor) > 0.005 || row.hours > 0)
    .sort(
      (a, b) =>
        a.unitName.localeCompare(b.unitName, "ru") || b.labor - a.labor,
    );

  const componentRows = Array.from(laborByComponent.entries())
    .filter(([, amount]) => Math.abs(amount) > 0.005)
    .sort((a, b) => b[1] - a[1]);

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
              {formatDate(period.date_to)}. Выручка — из iiko без учёта скидок
              (удалённые и сторнированные заказы исключены); ФОТ — последняя
              версия расчёта зарплаты.
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
          </div>
        </section>

        {revenueError && (
          <div className="notice error">
            <strong>Не удалось получить выручку из iiko:</strong> {revenueError}
          </div>
        )}

        <section className="metric-grid" style={{ margin: "18px 0" }}>
          <article className="metric-card accent">
            <span>Лейбор-кост</span>
            <strong>{percent(totalLaborCost)}</strong>
            <small>ФОТ ÷ выручка без скидок, все концепции</small>
          </article>
          <article className="metric-card">
            <span>Выручка без скидок</span>
            <strong className="metric-money">
              {formatMoneyWhole(totalGross)}
            </strong>
            <small>скидок за период: {formatMoneyWhole(totalDiscounts)}</small>
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
              <h2>По концепциям</h2>
              <p>Ориентир для ресторанов — 20–30% в зависимости от формата.</p>
            </div>
          </div>
          <div className="payroll-table-wrap" style={{ marginTop: "12px" }}>
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Концепция</th>
                  <th className="numeric">Выручка без скидок, ₽</th>
                  <th className="numeric">Скидки, ₽</th>
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
                    <td className="numeric">{formatMoneyWhole(row.gross)}</td>
                    <td className="numeric">{formatMoneyWhole(row.discounts)}</td>
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
                    <strong>{formatMoneyWhole(totalGross)}</strong>
                  </td>
                  <td className="numeric">
                    <strong>{formatMoneyWhole(totalDiscounts)}</strong>
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

        <section className="content-card" style={{ marginBottom: "22px" }}>
          <div className="section-heading">
            <div>
              <h2>По подразделениям</h2>
              <p>
                Кухня, зал и бар внутри каждой концепции. Лейбор-кост
                подразделения — от выручки всей концепции.
              </p>
            </div>
          </div>
          <div className="payroll-table-wrap" style={{ marginTop: "12px" }}>
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Концепция</th>
                  <th>Подразделение</th>
                  <th className="numeric">ФОТ, ₽</th>
                  <th className="numeric">Лейбор-кост</th>
                  <th className="numeric">Часы</th>
                  <th className="numeric">Стоимость часа, ₽</th>
                </tr>
              </thead>
              <tbody>
                {departmentRows.map((row) => (
                  <tr key={`${row.unitId}|${row.depName}`}>
                    <td>{row.unitName}</td>
                    <td>
                      <strong>{row.depName}</strong>
                    </td>
                    <td className="numeric">{formatMoneyWhole(row.labor)}</td>
                    <td className="numeric">
                      <strong>{percent(row.laborCost)}</strong>
                    </td>
                    <td className="numeric">{Math.round(row.hours)}</td>
                    <td className="numeric">
                      {row.costPerHour === null
                        ? "—"
                        : formatMoneyWhole(row.costPerHour)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: "10px" }}>
            Сотрудник целиком относится к подразделению, где у него больше
            часов в этой концепции. «Без подразделения» — явки без привязки к
            кухне/залу/бару (например, офис или нет графика).
          </p>
        </section>

        <section className="content-card">
          <div className="section-heading">
            <div>
              <h2>Из чего состоит ФОТ</h2>
              <p>Сумма по всем концепциям за период.</p>
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
