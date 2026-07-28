import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

type Props = {
  params: Promise<{ periodId: string }>;
  searchParams: Promise<{ unit?: string }>;
};

type Period = {
  id: string;
  date_from: string;
  date_to: string;
  payment_due_date: string;
  status: string;
};

type TotalRow = {
  employee_id: string;
  full_name: string;
  business_unit_id: string;
  business_unit_name: string;
  total_amount: number | string;
};

type UnitGroup = {
  id: string;
  name: string;
  rows: TotalRow[];
  total: number;
};

export default async function PayrollPeriodPage({ params, searchParams }: Props) {
  const { periodId } = await params;
  const query = await searchParams;
  const { supabase, profile } = await requireUser();

  const { data: periodData, error: periodError } = await supabase
    .from("payroll_periods")
    .select("id, date_from, date_to, payment_due_date, status")
    .eq("id", periodId)
    .single();

  if (periodError || !periodData) notFound();
  const period = periodData as Period;

  const { data: latestRun } = await supabase
    .from("payroll_runs")
    .select("version")
    .eq("payroll_period_id", periodId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = latestRun?.version ?? null;
  const totalsResult = version
    ? await supabase
        .from("payroll_employee_totals")
        .select(
          "employee_id, full_name, business_unit_id, business_unit_name, total_amount",
        )
        .eq("payroll_period_id", periodId)
        .eq("version", version)
        .order("business_unit_name")
        .order("full_name")
    : { data: [], error: null };

  if (totalsResult.error) {
    throw new Error(`Не удалось загрузить расчёт: ${totalsResult.error.message}`);
  }

  const allRows = (totalsResult.data ?? []) as TotalRow[];
  const selectedUnit = query.unit ?? "all";
  const visibleRows =
    selectedUnit === "all"
      ? allRows
      : allRows.filter((row) => row.business_unit_id === selectedUnit);

  const groupsMap = new Map<string, UnitGroup>();
  for (const row of visibleRows) {
    const existing = groupsMap.get(row.business_unit_id) ?? {
      id: row.business_unit_id,
      name: row.business_unit_name,
      rows: [],
      total: 0,
    };
    existing.rows.push(row);
    existing.total += Number(row.total_amount ?? 0);
    groupsMap.set(row.business_unit_id, existing);
  }
  const groups = Array.from(groupsMap.values());
  const units = Array.from(
    new Map(
      allRows.map((row) => [
        row.business_unit_id,
        { id: row.business_unit_id, name: row.business_unit_name },
      ]),
    ).values(),
  );

  const { data: miscRows } = await supabase
    .from("payroll_misc_items")
    .select("business_unit_id, amount, description")
    .eq("payroll_period_id", periodId);

  const miscTotal = (miscRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  );
  const employeeTotal = allRows.reduce(
    (sum, row) => sum + Number(row.total_amount ?? 0),
    0,
  );
  const negativeRows = allRows.filter((row) => Number(row.total_amount) < 0).length;

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Периоды</Link>
          <span>/</span>
          <strong>
            {formatDate(period.date_from)} — {formatDate(period.date_to)}
          </strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <div className="title-with-status">
              <h1>Зарплата за период</h1>
              <StatusBadge status={period.status} />
            </div>
            <p className="muted wide">
              {formatDate(period.date_from)} — {formatDate(period.date_to)} · версия
              расчёта {version ?? "не создана"}
            </p>
          </div>
          <div className="hero-date">
            <span>Дата выплаты</span>
            <strong>{formatDate(period.payment_due_date)}</strong>
          </div>
        </section>

        <section className="metric-grid four">
          <article className="metric-card accent">
            <span>Начислено сотрудникам</span>
            <strong className="metric-money">{formatMoney(employeeTotal)}</strong>
            <small>{allRows.length} строк по ресторанам</small>
          </article>
          <article className="metric-card">
            <span>Прочие расходы</span>
            <strong className="metric-money">{formatMoney(miscTotal)}</strong>
            <small>Расходы без привязки к сотруднику</small>
          </article>
          <article className="metric-card">
            <span>Итого периода</span>
            <strong className="metric-money">
              {formatMoney(employeeTotal + miscTotal)}
            </strong>
            <small>Сотрудники и прочие расходы</small>
          </article>
          <article className="metric-card">
            <span>Контроль</span>
            <strong>{negativeRows === 0 ? "Без ошибок" : negativeRows}</strong>
            <small>
              {negativeRows === 0
                ? "Нет отрицательных итоговых зарплат"
                : "Отрицательных итогов требуют проверки"}
            </small>
          </article>
        </section>

        <section className="content-card">
          <div className="section-heading responsive">
            <div>
              <h2>Сотрудники</h2>
              <p>Нажмите на сотрудника, чтобы открыть расшифровку.</p>
            </div>
            <form className="filter-form" method="get">
              <label htmlFor="unit">Ресторан</label>
              <select id="unit" name="unit" defaultValue={selectedUnit}>
                <option value="all">Все рестораны</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
              <button className="secondary-button" type="submit">
                Показать
              </button>
            </form>
          </div>

          {groups.length === 0 ? (
            <div className="empty-state">В выбранном периоде нет расчёта.</div>
          ) : (
            <div className="unit-groups">
              {groups.map((group) => (
                <section className="unit-section" key={group.id}>
                  <div className="unit-heading">
                    <div>
                      <h3>{group.name}</h3>
                      <span>{group.rows.length} строк</span>
                    </div>
                    <strong>{formatMoney(group.total)}</strong>
                  </div>
                  <div className="payroll-table-wrap">
                    <table className="payroll-table">
                      <thead>
                        <tr>
                          <th>Сотрудник</th>
                          <th>Ресторан</th>
                          <th className="numeric">К начислению</th>
                          <th aria-label="Открыть" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={`${row.employee_id}-${row.business_unit_id}`}>
                            <td>
                              <strong>{row.full_name}</strong>
                            </td>
                            <td>{row.business_unit_name}</td>
                            <td className="numeric money-cell">
                              {formatMoney(row.total_amount)}
                            </td>
                            <td className="open-cell">
                              <Link
                                aria-label={`Открыть расчёт ${row.full_name}`}
                                href={`/payroll/${periodId}/employee/${row.employee_id}?unit=${row.business_unit_id}&version=${version}`}
                              >
                                →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        {(miscRows ?? []).length > 0 ? (
          <section className="content-card slim">
            <div className="section-heading">
              <div>
                <h2>Прочие расходы</h2>
                <p>Операции, не привязанные к конкретному сотруднику.</p>
              </div>
            </div>
            <div className="misc-list">
              {(miscRows ?? []).map((row, index) => (
                <div key={`${row.description}-${index}`}>
                  <span>{row.description}</span>
                  <strong>{formatMoney(row.amount)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
