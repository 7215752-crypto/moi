import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, humanizeComponent } from "@/lib/format";

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
                      <small>Источник: {line.source_table ?? "ручной ввод"}</small>
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
      </main>
    </div>
  );
}
