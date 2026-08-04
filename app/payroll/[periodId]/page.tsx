import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { PayoutCheckbox } from "@/components/payout-checkbox";
import { RecalcButton } from "@/components/recalc-button";
import { requireUser } from "@/lib/auth";
import { formatAmountCell, formatDate, formatMoneyWhole } from "@/lib/format";

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

type Payout = {
  business_unit_id: string;
  employee_id: string;
  amount_paid: number | string;
  paid_by_name: string | null;
  paid_at: string;
};

type Rate = {
  employee_id: string;
  business_unit_id: string | null;
  rate_type: "hourly" | "shift" | "monthly";
  amount: number | string;
  valid_from: string;
  valid_to: string | null;
};

type EmployeeRow = {
  employeeId: string;
  name: string;
  hours: number;
  components: Record<string, number>;
  total: number;
  payout: Payout | null;
  rateLabel: string | null;
  hasRate: boolean;
};

type UnitGroup = {
  id: string;
  name: string;
  version: number | null;
  rows: EmployeeRow[];
  columnTotals: Record<string, number>;
  hoursTotal: number;
  total: number;
  paidCount: number;
  paidSum: number;
  remaining: number;
};

// Колонки — как в Google-файле «ЗП»: каждой колонке соответствуют типы строк расчёта.
// source — короткая подпись под названием колонки, hint — полное пояснение в тултипе.
const COMPONENT_COLUMNS: Array<{
  key: string;
  label: string;
  source: string;
  hint: string;
  types: string[];
}> = [
  {
    key: "base",
    label: "По ставке",
    source: "часы × ставка",
    hint: "Начислено за отработанные часы, смены или месячный оклад",
    types: ["hourly_pay", "shift_pay", "monthly_pay"],
  },
  {
    key: "motivation",
    label: "% от продаж",
    source: "бонусы iiko",
    hint: "Процент от продаж — готовые бонусы из iiko (счёт «Зарплата»)",
    types: ["iiko_motivation"],
  },
  {
    key: "fixed",
    label: "Фикс блюда",
    source: "бонусы iiko",
    hint: "Фиксированные бонусы за блюда из iiko",
    types: ["iiko_fixed_bonus"],
  },
  {
    key: "service",
    label: "Сервисный",
    source: "чеки iiko",
    hint: "Сервисный сбор из чеков iiko — распределяет менеджер",
    types: ["service_charge"],
  },
  {
    key: "bonus",
    label: "Премии",
    source: "вручную",
    hint: "Премии — вводятся вручную с комментарием",
    types: ["tg_bonus"],
  },
  {
    key: "fine",
    label: "Штрафы",
    source: "вручную",
    hint: "Депремирования — вводятся вручную с комментарием",
    types: ["fine"],
  },
  {
    key: "purchase",
    label: "Покупки",
    source: "накладные iiko",
    hint: "Покупки в счёт зарплаты — расходные накладные iiko на сотрудника",
    types: ["purchase"],
  },
  {
    key: "inventory",
    label: "Официалка",
    source: "вручную",
    hint: "Официальная часть и инвентаризация — вводятся вручную",
    types: ["official_inventory"],
  },
  {
    key: "leader",
    label: "Шифт-лидер",
    source: "график смен",
    hint: "Бонус за подтверждённые шифт-лидерские смены из графика",
    types: ["leader_kpi"],
  },
];

const KNOWN_TYPES = new Set(COMPONENT_COLUMNS.flatMap((column) => column.types));

function columnKeyFor(componentType: string): string {
  for (const column of COMPONENT_COLUMNS) {
    if (column.types.includes(componentType)) return column.key;
  }
  return "other";
}

function formatHours(value: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function rateLabelFor(
  rates: Rate[],
  employeeId: string,
  businessUnitId: string,
): { label: string | null; hasRate: boolean } {
  const candidates = rates
    .filter(
      (rate) =>
        rate.employee_id === employeeId &&
        (rate.business_unit_id === null ||
          rate.business_unit_id === businessUnitId),
    )
    .sort((a, b) => {
      const aSpecific = a.business_unit_id ? 0 : 1;
      const bSpecific = b.business_unit_id ? 0 : 1;
      if (aSpecific !== bSpecific) return aSpecific - bSpecific;
      return a.valid_from < b.valid_from ? 1 : -1;
    });

  const rate = candidates[0];
  if (!rate) return { label: null, hasRate: false };

  const amount = Number(rate.amount).toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  });
  const suffix =
    rate.rate_type === "hourly"
      ? "₽/ч"
      : rate.rate_type === "shift"
        ? "₽/смена"
        : "₽/мес";
  return { label: `${amount} ${suffix}`, hasRate: true };
}

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

  const [
    runsResult,
    attendanceResult,
    payoutsResult,
    unitsResult,
    employeesResult,
    ratesResult,
    miscResult,
  ] = await Promise.all([
    supabase
      .from("payroll_runs")
      .select("id, business_unit_id, version")
      .eq("payroll_period_id", periodId),
    supabase
      .from("attendance_records")
      .select("employee_id, business_unit_id, hours")
      .eq("payroll_period_id", periodId),
    supabase
      .from("payroll_payouts")
      .select("business_unit_id, employee_id, amount_paid, paid_by_name, paid_at")
      .eq("payroll_period_id", periodId),
    supabase.from("business_units").select("id, name"),
    supabase.from("employees").select("id, full_name"),
    supabase
      .from("employee_rates")
      .select("employee_id, business_unit_id, rate_type, amount, valid_from, valid_to")
      .lte("valid_from", period.date_to)
      .or(`valid_to.is.null,valid_to.gte.${period.date_from}`),
    supabase
      .from("payroll_misc_items")
      .select("business_unit_id, amount, description, item_type")
      .eq("payroll_period_id", periodId),
  ]);

  // Версия расчёта — последняя по каждому ресторану (а не по периоду в целом).
  const latestRunByUnit = new Map<string, { id: string; version: number }>();
  for (const run of runsResult.data ?? []) {
    if (!run.business_unit_id) continue;
    const existing = latestRunByUnit.get(run.business_unit_id);
    if (!existing || run.version > existing.version) {
      latestRunByUnit.set(run.business_unit_id, {
        id: run.id,
        version: run.version,
      });
    }
  }

  const runIds = Array.from(latestRunByUnit.values()).map((run) => run.id);
  const unitByRunId = new Map<string, string>();
  for (const [unitId, run] of latestRunByUnit.entries()) {
    unitByRunId.set(run.id, unitId);
  }

  const linesResult = runIds.length
    ? await supabase
        .from("payroll_lines")
        .select("payroll_run_id, employee_id, component_type, amount")
        .in("payroll_run_id", runIds)
    : { data: [], error: null };

  if (linesResult.error) {
    throw new Error(`Не удалось загрузить расчёт: ${linesResult.error.message}`);
  }

  const unitNameById = new Map<string, string>(
    (unitsResult.data ?? []).map((unit) => [unit.id, unit.name]),
  );
  const employeeNameById = new Map<string, string>(
    (employeesResult.data ?? []).map((employee) => [employee.id, employee.full_name]),
  );
  const rates = (ratesResult.data ?? []) as Rate[];
  const payouts = (payoutsResult.data ?? []) as Payout[];
  const payoutByKey = new Map<string, Payout>(
    payouts.map((payout) => [
      `${payout.business_unit_id}|${payout.employee_id}`,
      payout,
    ]),
  );

  // Сборка строк: сотрудник × ресторан. Сначала суммы расчёта, затем часы из явок —
  // сотрудники с часами, но без начислений тоже попадают в таблицу (светофор «нет ставки»).
  const rowsByUnit = new Map<string, Map<string, EmployeeRow>>();
  let hasOtherColumn = false;

  const ensureRow = (unitId: string, employeeId: string): EmployeeRow => {
    let unitRows = rowsByUnit.get(unitId);
    if (!unitRows) {
      unitRows = new Map();
      rowsByUnit.set(unitId, unitRows);
    }
    let row = unitRows.get(employeeId);
    if (!row) {
      const { label, hasRate } = rateLabelFor(rates, employeeId, unitId);
      row = {
        employeeId,
        name: employeeNameById.get(employeeId) ?? "Без имени",
        hours: 0,
        components: {},
        total: 0,
        payout: payoutByKey.get(`${unitId}|${employeeId}`) ?? null,
        rateLabel: label,
        hasRate,
      };
      unitRows.set(employeeId, row);
    }
    return row;
  };

  for (const line of linesResult.data ?? []) {
    const unitId = unitByRunId.get(line.payroll_run_id);
    if (!unitId) continue;
    const row = ensureRow(unitId, line.employee_id);
    const amount = Number(line.amount ?? 0);
    const key = columnKeyFor(line.component_type);
    if (!KNOWN_TYPES.has(line.component_type)) hasOtherColumn = true;
    row.components[key] = (row.components[key] ?? 0) + amount;
    row.total += amount;
  }

  for (const record of attendanceResult.data ?? []) {
    const row = ensureRow(record.business_unit_id, record.employee_id);
    row.hours += Number(record.hours ?? 0);
  }

  const columns = hasOtherColumn
    ? [
        ...COMPONENT_COLUMNS,
        {
          key: "other",
          label: "Прочее",
          source: "разное",
          hint: "Строки расчёта, не попавшие в основные колонки",
          types: [],
        },
      ]
    : COMPONENT_COLUMNS;

  const allGroups: UnitGroup[] = Array.from(rowsByUnit.entries())
    .map(([unitId, unitRows]) => {
      const rows = Array.from(unitRows.values()).sort((a, b) =>
        a.name.localeCompare(b.name, "ru"),
      );
      const columnTotals: Record<string, number> = {};
      let hoursTotal = 0;
      let total = 0;
      let paidCount = 0;
      let paidSum = 0;
      let remaining = 0;

      for (const row of rows) {
        hoursTotal += row.hours;
        total += row.total;
        for (const column of columns) {
          columnTotals[column.key] =
            (columnTotals[column.key] ?? 0) + (row.components[column.key] ?? 0);
        }
        if (row.payout) {
          paidCount += 1;
          paidSum += Number(row.payout.amount_paid);
        } else if (row.total > 0) {
          remaining += row.total;
        }
      }

      return {
        id: unitId,
        name: unitNameById.get(unitId) ?? "Ресторан",
        version: latestRunByUnit.get(unitId)?.version ?? null,
        rows,
        columnTotals,
        hoursTotal,
        total,
        paidCount,
        paidSum,
        remaining,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const selectedUnit = query.unit ?? "all";
  const groups =
    selectedUnit === "all"
      ? allGroups
      : allGroups.filter((group) => group.id === selectedUnit);

  const employeeTotal = allGroups.reduce((sum, group) => sum + group.total, 0);
  const paidTotal = allGroups.reduce((sum, group) => sum + group.paidSum, 0);
  const paidPeople = allGroups.reduce((sum, group) => sum + group.paidCount, 0);
  const totalPeople = allGroups.reduce(
    (sum, group) => sum + group.rows.length,
    0,
  );
  const remainingTotal = allGroups.reduce(
    (sum, group) => sum + group.remaining,
    0,
  );

  const problems: string[] = [];
  const negativeRows = allGroups
    .flatMap((group) => group.rows)
    .filter((row) => row.total < 0).length;
  const noRateRows = allGroups
    .flatMap((group) => group.rows)
    .filter((row) => row.hours > 0 && !row.hasRate).length;
  const diffRows = allGroups
    .flatMap((group) => group.rows)
    .filter(
      (row) =>
        row.payout &&
        Math.round((row.total - Number(row.payout.amount_paid)) * 100) !== 0,
    ).length;
  if (negativeRows > 0) problems.push(`отрицательных итогов: ${negativeRows}`);
  if (noRateRows > 0) problems.push(`часы без ставки: ${noRateRows}`);
  if (diffRows > 0) problems.push(`расчёт изменился после выплаты: ${diffRows}`);

  const miscRows = miscResult.data ?? [];
  const canRecalc = ["owner", "accountant", "manager"].includes(profile.role);

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
              {formatDate(period.date_from)} — {formatDate(period.date_to)} ·
              выплата до {formatDate(period.payment_due_date)} ·{" "}
              <Link
                className="portal-link"
                href={`/admin/leader-shifts?period=${periodId}`}
                title="Подтвердить шифт-лидерские смены периода"
              >
                шифт-лидерские смены →
              </Link>
            </p>
          </div>
          {canRecalc && (
            <RecalcButton from={period.date_from} to={period.date_to} />
          )}
        </section>

        <section className="metric-grid four">
          <article className="metric-card accent">
            <span>Начислено сотрудникам</span>
            <strong className="metric-money">
              {formatMoneyWhole(employeeTotal)}
            </strong>
            <small>{totalPeople} сотрудников по ресторанам</small>
          </article>
          <article className="metric-card">
            <span>Выплачено</span>
            <strong className="metric-money">{formatMoneyWhole(paidTotal)}</strong>
            <small>
              {paidPeople} из {totalPeople} с отметкой «выплачено»
            </small>
          </article>
          <article className="metric-card">
            <span>Осталось выдать</span>
            <strong className="metric-money">
              {formatMoneyWhole(remainingTotal)}
            </strong>
            <small>Строки без отметки «выплачено»</small>
          </article>
          <article className="metric-card">
            <span>Контроль</span>
            <strong>{problems.length === 0 ? "Без ошибок" : "Внимание"}</strong>
            <small>
              {problems.length === 0
                ? "Нет отрицательных сумм и часов без ставки"
                : problems.join(" · ")}
            </small>
          </article>
        </section>

        <section className="content-card">
          <div className="section-heading responsive">
            <div>
              <h2>Расчёт по ресторанам</h2>
              <p>
                Под названием каждой колонки — откуда берутся цифры. Суммы в
                рублях без копеек; точный расчёт — в карточке сотрудника.
              </p>
            </div>
            <form className="filter-form" method="get">
              <label htmlFor="unit">Ресторан</label>
              <select id="unit" name="unit" defaultValue={selectedUnit}>
                <option value="all">Все рестораны</option>
                {allGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <button className="secondary-button" type="submit">
                Показать
              </button>
            </form>
          </div>

          {groups.length === 0 ? (
            <div className="empty-state">
              В этом периоде пока нет данных. Нажмите «Рассчитать зарплату»,
              чтобы забрать явки из iiko.
            </div>
          ) : (
            <div className="unit-groups">
              {groups.map((group) => (
                <section className="unit-section" key={group.id}>
                  <div className="unit-heading">
                    <div>
                      <h3>{group.name}</h3>
                      <span>
                        версия {group.version ?? "—"} · выплачено{" "}
                        {group.paidCount} из {group.rows.length}
                        {group.remaining > 0 &&
                          ` · осталось ${formatMoneyWhole(group.remaining)}`}
                      </span>
                    </div>
                    <strong>{formatMoneyWhole(group.total)}</strong>
                  </div>
                  <div className="payroll-table-wrap scrollable">
                    <table className="payroll-table pivot">
                      <thead>
                        <tr>
                          <th>
                            <span className="th-label">Сотрудник</span>
                            <span className="th-source">и его ставка</span>
                          </th>
                          <th
                            className="numeric"
                            title="Фактически отработанные часы из явок iiko"
                          >
                            <span className="th-label">Часы</span>
                            <span className="th-source">явки iiko</span>
                          </th>
                          {columns.map((column) => (
                            <th
                              className="numeric"
                              key={column.key}
                              title={column.hint}
                            >
                              <span className="th-label">{column.label}</span>
                              <span className="th-source">{column.source}</span>
                            </th>
                          ))}
                          <th
                            className="numeric"
                            title="Сумма всех начислений и удержаний"
                          >
                            <span className="th-label">К выдаче</span>
                            <span className="th-source">итог, ₽</span>
                          </th>
                          <th title="Отметка о выдаче денег — защита от двойной выплаты">
                            <span className="th-label">Выплата</span>
                            <span className="th-source">отметка</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr
                            key={row.employeeId}
                            className={row.total < 0 ? "problem-row" : undefined}
                          >
                            <td>
                              {group.version ? (
                                <Link
                                  className="employee-link"
                                  href={`/payroll/${periodId}/employee/${row.employeeId}?unit=${group.id}&version=${group.version}`}
                                >
                                  <strong>{row.name}</strong>
                                </Link>
                              ) : (
                                <strong>{row.name}</strong>
                              )}
                              {row.rateLabel && (
                                <small className="rate-hint">
                                  {row.rateLabel}
                                </small>
                              )}
                            </td>
                            <td className="numeric">
                              {row.hours > 0 ? formatHours(row.hours) : ""}
                            </td>
                            {columns.map((column) => {
                              const value = Math.round(
                                row.components[column.key] ?? 0,
                              );
                              const isBase = column.key === "base";
                              return (
                                <td
                                  className={`numeric ${value < 0 ? "neg" : ""}`}
                                  key={column.key}
                                >
                                  {value !== 0
                                    ? formatAmountCell(value)
                                    : isBase && row.hours > 0 && !row.hasRate
                                      ? (
                                          <span className="warn-badge">
                                            нет ставки
                                          </span>
                                        )
                                      : ""}
                                </td>
                              );
                            })}
                            <td
                              className={`numeric total-cell ${row.total < 0 ? "neg" : ""}`}
                            >
                              {formatAmountCell(Math.round(row.total))}
                            </td>
                            <td className="payout-cell">
                              <PayoutCheckbox
                                periodId={periodId}
                                businessUnitId={group.id}
                                employeeId={row.employeeId}
                                employeeName={row.name}
                                currentAmount={row.total}
                                payout={row.payout}
                                role={profile.role}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Итого</td>
                          <td className="numeric">
                            {formatHours(group.hoursTotal)}
                          </td>
                          {columns.map((column) => {
                            const value = Math.round(
                              group.columnTotals[column.key] ?? 0,
                            );
                            return (
                              <td
                                className={`numeric ${value < 0 ? "neg" : ""}`}
                                key={column.key}
                              >
                                {value !== 0 ? formatAmountCell(value) : ""}
                              </td>
                            );
                          })}
                          <td className="numeric total-cell">
                            {formatAmountCell(Math.round(group.total))}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        {miscRows.length > 0 ? (
          <section className="content-card slim">
            <div className="section-heading">
              <div>
                <h2>Прочие расходы</h2>
                <p>Операции, не привязанные к конкретному сотруднику.</p>
              </div>
            </div>
            <div className="misc-list">
              {miscRows.map((row, index) => (
                <div key={`${row.description}-${index}`}>
                  <span>
                    {row.description}
                    {row.item_type === "service_charge" && row.business_unit_id ? (
                      <>
                        {" "}
                        <Link
                          className="portal-link"
                          href={`/admin/service-charge?period=${periodId}&unit=${row.business_unit_id}`}
                          title="Открыть распределение сервисного сбора"
                        >
                          распределить →
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <strong>{formatMoneyWhole(row.amount)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
