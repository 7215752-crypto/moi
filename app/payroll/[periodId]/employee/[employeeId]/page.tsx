import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import {
  formatDate,
  formatMoney,
  humanizeComponent,
  humanizeSource,
} from "@/lib/format";

function formatDayLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

type Props = {
  params: Promise<{ periodId: string; employeeId: string }>;
  searchParams: Promise<{ unit?: string; version?: string }>;
};

type PayrollLine = {
  id: string;
  component_type: string;
  amount: number | string;
  description: string;
  source_table: string | null;
};

type PlannedShift = {
  shift_date: string;
  planned_start: string | null;
  planned_end: string | null;
  is_shift_leader: boolean;
};

type AttendanceDay = {
  work_date: string;
  hours: number | string;
  first_in: string | null;
  last_out: string | null;
};

type ShiftDay = {
  date: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  isLeader: boolean;
  factIn: string | null;
  factOut: string | null;
  factHours: number;
  lateMinutes: number | null;
  status: "ok" | "late" | "missed" | "extra" | "other_unit";
};

// В базе моменты времени хранятся в UTC — показываем в московском поясе,
// как их видит iiko и менеджер на точке.
function clockFromTimestamp(value: string | null): string | null {
  if (!value) return null;
  const iso = value.replace(" ", "T").replace(/\+00(:00)?$/, "Z");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function clockFromTime(value: string | null): string | null {
  if (!value) return null;
  const clock = value.substring(0, 5);
  return /^\d{2}:\d{2}$/.test(clock) ? clock : null;
}

function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function buildShiftDays(
  planned: PlannedShift[],
  attendance: AttendanceDay[],
  otherUnitDates: Set<string>,
): ShiftDay[] {
  const plannedByDate = new Map<string, PlannedShift>();
  for (const shift of planned) {
    plannedByDate.set(shift.shift_date, shift);
  }
  const factByDate = new Map<string, AttendanceDay>();
  for (const day of attendance) {
    factByDate.set(day.work_date, day);
  }

  const dates = Array.from(
    new Set([...plannedByDate.keys(), ...factByDate.keys()]),
  ).sort();

  return dates.map((date) => {
    const plan = plannedByDate.get(date) ?? null;
    const fact = factByDate.get(date) ?? null;

    const plannedStart = clockFromTime(plan?.planned_start ?? null);
    const factIn = clockFromTimestamp(fact?.first_in ?? null);

    let lateMinutes: number | null = null;
    if (plannedStart && factIn) {
      const diff = minutesOf(factIn) - minutesOf(plannedStart);
      lateMinutes = diff > 0 ? diff : 0;
    }

    let status: ShiftDay["status"] = "ok";
    if (plan && !fact)
      status = otherUnitDates.has(date) ? "other_unit" : "missed";
    else if (!plan && fact) status = "extra";
    else if ((lateMinutes ?? 0) > 0) status = "late";

    return {
      date,
      plannedStart,
      plannedEnd: clockFromTime(plan?.planned_end ?? null),
      isLeader: plan?.is_shift_leader ?? false,
      factIn,
      factOut: clockFromTimestamp(fact?.last_out ?? null),
      factHours: Number(fact?.hours ?? 0),
      lateMinutes,
      status,
    };
  });
}

export default async function EmployeePayrollPage({ params, searchParams }: Props) {
  const { periodId, employeeId } = await params;
  const query = await searchParams;
  const unitId = query.unit;
  const requestedVersion = Number(query.version ?? 0);
  if (!unitId) notFound();

  const { supabase, profile } = await requireUser();

  const [periodResult, employeeResult, unitResult] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("date_from, date_to, payment_due_date, status")
      .eq("id", periodId)
      .single(),
    supabase.from("employees").select("full_name").eq("id", employeeId).single(),
    supabase.from("business_units").select("name").eq("id", unitId).single(),
  ]);

  if (periodResult.error || employeeResult.error || unitResult.error) notFound();

  let version = requestedVersion;
  if (!version) {
    const { data } = await supabase
      .from("payroll_runs")
      .select("version")
      .eq("payroll_period_id", periodId)
      .eq("business_unit_id", unitId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = data?.version ?? 0;
  }

  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select("id, status")
    .eq("payroll_period_id", periodId)
    .eq("business_unit_id", unitId)
    .eq("version", version)
    .maybeSingle();

  if (runError || !run) notFound();

  const { data: linesData, error: linesError } = await supabase
    .from("payroll_lines")
    .select("id, component_type, amount, description, source_table")
    .eq("payroll_run_id", run.id)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: true });

  if (linesError) {
    throw new Error(`Не удалось загрузить расшифровку: ${linesError.message}`);
  }

  const [plannedResult, attendanceResult, otherUnitsResult] = await Promise.all([
    supabase
      .from("planned_shifts")
      .select("shift_date, planned_start, planned_end, is_shift_leader")
      .eq("employee_id", employeeId)
      .eq("business_unit_id", unitId)
      .gte("shift_date", periodResult.data.date_from)
      .lte("shift_date", periodResult.data.date_to)
      .order("shift_date"),
    supabase
      .from("attendance_records")
      .select("work_date, hours, first_in, last_out")
      .eq("payroll_period_id", periodId)
      .eq("employee_id", employeeId)
      .eq("business_unit_id", unitId)
      .order("work_date"),
    // Явки в других ресторанах: «неявка» здесь может быть работой там.
    supabase
      .from("attendance_records")
      .select("work_date")
      .eq("payroll_period_id", periodId)
      .eq("employee_id", employeeId)
      .neq("business_unit_id", unitId),
  ]);

  const otherUnitDates = new Set(
    (otherUnitsResult.data ?? []).map((row) => row.work_date as string),
  );

  const shiftDays = buildShiftDays(
    (plannedResult.data ?? []) as PlannedShift[],
    (attendanceResult.data ?? []) as AttendanceDay[],
    otherUnitDates,
  );
  const lateDays = shiftDays.filter((day) => (day.lateMinutes ?? 0) > 0);
  const lateTotalMinutes = lateDays.reduce(
    (sum, day) => sum + (day.lateMinutes ?? 0),
    0,
  );
  const missedDays = shiftDays.filter((day) => day.status === "missed").length;
  const extraDays = shiftDays.filter((day) => day.status === "extra").length;
  const leaderDays = shiftDays.filter((day) => day.isLeader).length;
  const factHoursTotal = shiftDays.reduce((sum, day) => sum + day.factHours, 0);
  const timesKnown = shiftDays.some((day) => day.factIn !== null);

  const lines = (linesData ?? []) as PayrollLine[];
  const total = lines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
  const positive = lines
    .filter((line) => Number(line.amount) > 0)
    .reduce((sum, line) => sum + Number(line.amount), 0);
  const deductions = lines
    .filter((line) => Number(line.amount) < 0)
    .reduce((sum, line) => sum + Math.abs(Number(line.amount)), 0);

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container narrow">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Периоды</Link>
          <span>/</span>
          <Link href={`/payroll/${periodId}`}>Расчёт периода</Link>
          <span>/</span>
          <strong>{employeeResult.data.full_name}</strong>
        </nav>

        <section className="employee-summary-card">
          <div>
            <p className="eyebrow">Расчётный листок</p>
            <h1>{employeeResult.data.full_name}</h1>
            <p>
              {unitResult.data.name} · {formatDate(periodResult.data.date_from)} —{" "}
              {formatDate(periodResult.data.date_to)} · версия {version}
            </p>
          </div>
          <div className="salary-total">
            <span>К выплате</span>
            <strong>{formatMoney(total)}</strong>
            <small>до {formatDate(periodResult.data.payment_due_date)}</small>
          </div>
        </section>

        <section className="mini-metrics">
          <article>
            <span>Начисления</span>
            <strong>{formatMoney(positive)}</strong>
          </article>
          <article>
            <span>Удержания и вычеты</span>
            <strong>{formatMoney(deductions)}</strong>
          </article>
          <article>
            <span>Составляющих</span>
            <strong>{lines.length}</strong>
          </article>
        </section>

        <section className="content-card">
          <div className="section-heading">
            <div>
              <h2>Расшифровка</h2>
              <p>Каждая сумма сохранена отдельной строкой с источником.</p>
            </div>
          </div>
          {lines.length === 0 ? (
            <div className="empty-state">Начисления не найдены.</div>
          ) : (
            <div className="breakdown-list">
              {lines.map((line) => {
                const amount = Number(line.amount);
                return (
                  <article className="breakdown-row" key={line.id}>
                    <div className={`amount-indicator ${amount < 0 ? "negative" : "positive"}`}>
                      {amount < 0 ? "−" : "+"}
                    </div>
                    <div className="breakdown-main">
                      <strong>{humanizeComponent(line.component_type)}</strong>
                      <p>{line.description}</p>
                      <small>Источник: {humanizeSource(line.source_table)}</small>
                    </div>
                    <strong className={amount < 0 ? "negative-money" : "positive-money"}>
                      {amount < 0 ? "−" : "+"}
                      {formatMoney(Math.abs(amount))}
                    </strong>
                  </article>
                );
              })}
              <div className="breakdown-total">
                <span>Итого к выплате</span>
                <strong>{formatMoney(total)}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="content-card">
          <div className="section-heading">
            <div>
              <h2>Смены и опоздания</h2>
              <p>
                План из графика против факта из iiko. Опоздания показываются
                для контроля и на оплату не влияют.
              </p>
            </div>
          </div>

          {shiftDays.length === 0 ? (
            <div className="empty-state">
              За период нет ни графика, ни явок по этому ресторану.
            </div>
          ) : (
            <>
              <section className="mini-metrics">
                <article>
                  <span>Опоздания</span>
                  <strong>
                    {lateDays.length > 0
                      ? `${lateDays.length} раз · ${lateTotalMinutes} мин`
                      : "не было"}
                  </strong>
                </article>
                <article>
                  <span>Неявки по графику</span>
                  <strong>{missedDays > 0 ? missedDays : "не было"}</strong>
                </article>
                <article>
                  <span>Смены вне графика</span>
                  <strong>{extraDays > 0 ? extraDays : "не было"}</strong>
                </article>
                <article>
                  <span>Часы по факту</span>
                  <strong>
                    {factHoursTotal.toLocaleString("ru-RU", {
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </article>
                <article>
                  <span>Шифт-лидерские смены</span>
                  <strong>{leaderDays > 0 ? leaderDays : "не было"}</strong>
                </article>
              </section>

              {!timesKnown && (
                <p className="muted" style={{ marginBottom: "14px" }}>
                  Времена прихода появятся после следующего нажатия «Рассчитать
                  зарплату» на странице периода.
                </p>
              )}

              <div className="payroll-table-wrap">
                <table className="payroll-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>По графику</th>
                      <th>Факт (iiko)</th>
                      <th className="numeric">Часы</th>
                      <th>Отметка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftDays.map((day) => (
                      <tr key={day.date}>
                        <td>
                          <strong>{formatDayLabel(day.date)}</strong>
                        </td>
                        <td>
                          {day.plannedStart
                            ? `${day.plannedStart}–${day.plannedEnd ?? "…"}`
                            : day.status === "extra"
                              ? "—"
                              : "смена без времени"}
                          {day.isLeader && (
                            <span className="leader-hint"> · шифт-лидер</span>
                          )}
                        </td>
                        <td>
                          {day.factIn
                            ? `${day.factIn}–${day.factOut ?? "…"}`
                            : day.factHours > 0
                              ? "часы без времени"
                              : "—"}
                        </td>
                        <td className="numeric">
                          {day.factHours > 0
                            ? day.factHours.toLocaleString("ru-RU", {
                                maximumFractionDigits: 2,
                              })
                            : "—"}
                        </td>
                        <td>
                          {day.status === "missed" && (
                            <span className="shift-status missed">неявка</span>
                          )}
                          {day.status === "other_unit" && (
                            <span className="shift-status extra">
                              работал в другом ресторане
                            </span>
                          )}
                          {day.status === "extra" && (
                            <span className="shift-status extra">
                              вне графика
                            </span>
                          )}
                          {day.status === "late" && (
                            <span className="shift-status late">
                              опоздал на {day.lateMinutes} мин
                            </span>
                          )}
                          {day.status === "ok" &&
                            (day.plannedStart && day.factIn ? (
                              <span className="shift-status ok">вовремя</span>
                            ) : (
                              <span className="dim">—</span>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
