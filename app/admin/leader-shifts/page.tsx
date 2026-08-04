import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { LeaderShiftsBoard } from "@/components/leader-shifts-board";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ period?: string }>;
};

export default async function LeaderShiftsPage({ searchParams }: Props) {
  const { supabase, profile } = await requireUser();

  if (!["owner", "accountant", "manager"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  let periodId = query.period ?? null;
  let periodLabel = "";

  if (periodId) {
    const { data: period } = await supabase
      .from("payroll_periods")
      .select("id, date_from, date_to")
      .eq("id", periodId)
      .maybeSingle();
    if (!period) periodId = null;
    else periodLabel = `${formatDate(period.date_from)} — ${formatDate(period.date_to)}`;
  }

  if (!periodId) {
    const { data: latest } = await supabase
      .from("payroll_periods")
      .select("id, date_from, date_to")
      .order("date_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) redirect("/dashboard");
    periodId = latest.id;
    periodLabel = `${formatDate(latest.date_from)} — ${formatDate(latest.date_to)}`;
  }

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Главная</Link>
          <span>/</span>
          <Link href={`/payroll/${periodId}`}>Расчёт периода</Link>
          <span>/</span>
          <strong>Шифт-лидерские смены</strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <h1>Шифт-лидерские смены</h1>
            <p className="muted wide">
              {periodLabel} · смены из графика Google. Подтверждённые попадают
              в колонку «Шифт-лидер» при пересчёте зарплаты.
            </p>
          </div>
        </section>

        <LeaderShiftsBoard periodId={periodId} />
      </main>
    </div>
  );
}
