import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { fetchEmployeePurchaseDetails } from "@/lib/iiko/olap";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ periodId: string; employeeId: string }>;
};

export default async function EmployeePurchasesPage({ params }: Props) {
  const { periodId, employeeId } = await params;
  const { supabase, profile } = await requireUser();

  const [periodResult, employeeResult, aliasesResult] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("id, date_from, date_to")
      .eq("id", periodId)
      .maybeSingle(),
    supabase
      .from("employees")
      .select("id, full_name")
      .eq("id", employeeId)
      .maybeSingle(),
    supabase
      .from("employee_aliases")
      .select("source_name")
      .eq("employee_id", employeeId),
  ]);

  if (!periodResult.data || !employeeResult.data) notFound();

  const period = periodResult.data;
  const employee = employeeResult.data;

  // Имя в проводках iiko может отличаться от имени в портале — берём все
  // известные варианты (само имя + алиасы из iiko).
  const names = Array.from(
    new Set(
      [
        employee.full_name,
        ...(aliasesResult.data ?? []).map((row) => row.source_name),
      ].filter((name): name is string => Boolean(name && name.trim())),
    ),
  );

  let details: Awaited<ReturnType<typeof fetchEmployeePurchaseDetails>> = [];
  let loadError: string | null = null;
  try {
    details = await fetchEmployeePurchaseDetails(
      period.date_from,
      period.date_to,
      names,
    );
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Не удалось получить данные iiko.";
  }

  const total = details.reduce((sum, row) => sum + row.amount, 0);
  const hasUndocumented = details.some((row) => !row.document);

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container narrow">
        <nav className="breadcrumbs">
          <Link href={`/payroll/${periodId}`}>Расчёт периода</Link>
          <span>/</span>
          <Link href={`/payroll/${periodId}/employee/${employeeId}`}>
            {employee.full_name}
          </Link>
          <span>/</span>
          <strong>Покупки в зарплату</strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <h1>Покупки в зарплату — {employee.full_name}</h1>
            <p className="muted wide">
              Проводки счёта «Текущие расчеты с сотрудниками» из iiko за{" "}
              {formatDate(period.date_from)} — {formatDate(period.date_to)}:
              накладные и продукты. Эти суммы удерживаются из выплаты.
            </p>
          </div>
        </section>

        {loadError ? (
          <div className="notice error">
            <strong>Ошибка iiko:</strong> {loadError}
          </div>
        ) : details.length === 0 ? (
          <div className="empty-state">
            Покупок за период не найдено.
          </div>
        ) : (
          <section className="content-card">
            <div className="payroll-table-wrap">
              <table className="payroll-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Накладная</th>
                    <th>Продукт</th>
                    <th className="numeric">Сумма, ₽</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((row, index) => (
                    <tr key={`${row.date}-${row.document}-${index}`}>
                      <td>{formatDate(row.date)}</td>
                      <td>{row.document ?? "без документа"}</td>
                      <td>{row.product ?? "—"}</td>
                      <td className="numeric money-cell">
                        {formatMoney(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      <strong>Итого удержание</strong>
                    </td>
                    <td className="numeric money-cell">
                      <strong>{formatMoney(total)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {hasUndocumented && (
              <p className="muted" style={{ marginTop: "12px" }}>
                «Без документа» — ручная проводка по счёту без расходной
                накладной; что за операция, видно в iiko в персональном отчёте
                сотрудника.
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
