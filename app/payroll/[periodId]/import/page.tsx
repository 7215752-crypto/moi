import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { PeriodTabs } from "@/components/period-tabs";
import { IikoAttendanceCard } from "@/components/iiko-attendance-card";
import { IikoExtrasCard } from "@/components/iiko-extras-card";
import { GoogleScheduleCard } from "@/components/google-schedule-card";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ periodId: string }>;
};

export default async function PeriodImportPage({ params }: Props) {
  const { periodId } = await params;
  const { supabase, profile } = await requireUser();

  if (!["owner", "accountant", "manager"].includes(profile.role)) {
    redirect(`/payroll/${periodId}`);
  }

  const { data: period, error } = await supabase
    .from("payroll_periods")
    .select("id, date_from, date_to")
    .eq("id", periodId)
    .single();

  if (error || !period) notFound();

  const scheduleMonth = Number(period.date_from.substring(5, 7));
  const scheduleYear = Number(period.date_from.substring(0, 4));

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/employees">Периоды</Link>
          <span>/</span>
          <Link href={`/payroll/${periodId}`}>
            {formatDate(period.date_from)} — {formatDate(period.date_to)}
          </Link>
          <span>/</span>
          <strong>Импорт данных</strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <h1>Импорт данных</h1>
            <p className="muted wide">
              Данные за {formatDate(period.date_from)} —{" "}
              {formatDate(period.date_to)}: даты подставлены из периода.
              После импорта нажмите «Рассчитать зарплату» на вкладке «Расчёт».
            </p>
          </div>
        </section>

        <PeriodTabs periodId={periodId} />

        <IikoAttendanceCard
          initialFrom={period.date_from}
          initialTo={period.date_to}
        />

        <IikoExtrasCard
          initialFrom={period.date_from}
          initialTo={period.date_to}
        />

        <GoogleScheduleCard
          initialYear={scheduleYear}
          initialMonth={scheduleMonth}
        />
      </main>
    </div>
  );
}
