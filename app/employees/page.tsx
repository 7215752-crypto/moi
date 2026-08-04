import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth";
import { formatDate, formatShortDate } from "@/lib/format";
import { createNextPeriod } from "./actions";

export const dynamic = "force-dynamic";

type PeriodRow = {
  id: string;
  date_from: string;
  date_to: string;
  payment_due_date: string;
  status: string;
};

export default async function EmployeesPage() {
  const { supabase, profile } = await requireUser();

  const { data: periodsData, error } = await supabase
    .from("payroll_periods")
    .select("id, date_from, date_to, payment_due_date, status")
    .order("date_from", { ascending: false });

  if (error) {
    throw new Error(`Не удалось загрузить периоды: ${error.message}`);
  }

  const periods = (periodsData ?? []) as PeriodRow[];
  const canCreate = ["owner", "accountant", "manager"].includes(profile.role);

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container narrow">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Главная</Link>
          <span>/</span>
          <strong>Сотрудники</strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <h1>Расчёт зарплаты</h1>
            <p className="muted wide">
              Выберите период — импорт данных, расчёт и сервисный сбор
              находятся внутри периода.
            </p>
          </div>
          {canCreate && (
            <form action={createNextPeriod}>
              <button type="submit" className="primary-button">
                Новый период
              </button>
            </form>
          )}
        </section>

        <section className="content-card">
          {periods.length === 0 ? (
            <div className="empty-state">
              Периодов пока нет — нажмите «Новый период».
            </div>
          ) : (
            periods.map((period) => (
              <div className="portal-period-strip" key={period.id}>
                <div className="portal-period-main">
                  <strong>
                    {formatDate(period.date_from)} — {formatDate(period.date_to)}
                  </strong>
                  <span>
                    Выплата до {formatShortDate(period.payment_due_date)}
                  </span>
                </div>
                <StatusBadge status={period.status} />
                <Link
                  href={`/payroll/${period.id}`}
                  className="portal-period-link has-tooltip"
                  data-tooltip="Открыть период: расчёт, импорт, сервисный сбор."
                  title="Открыть период"
                >
                  →
                </Link>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
