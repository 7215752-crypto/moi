import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { GoogleScheduleCard } from "@/components/google-schedule-card";
import { IikoAttendanceCard } from "@/components/iiko-attendance-card";
import { IikoExtrasCard } from "@/components/iiko-extras-card";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";

function previousHalfMonth(now: Date): { from: string; to: string } {
  const iso = (date: Date) => date.toISOString().substring(0, 10);
  const year = now.getFullYear();
  const month = now.getMonth();

  if (now.getDate() >= 16) {
    return {
      from: iso(new Date(Date.UTC(year, month, 1))),
      to: iso(new Date(Date.UTC(year, month, 15))),
    };
  }

  return {
    from: iso(new Date(Date.UTC(year, month - 1, 16))),
    to: iso(new Date(Date.UTC(year, month, 0))),
  };
}

export default async function ImportPage() {
  const { profile } = await requireUser();

  if (!["owner", "accountant"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const halfMonth = previousHalfMonth(now);

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />

      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Главная</Link>
          <span>/</span>
          <strong>Импорт данных</strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <h1>Импорт данных</h1>
            <p className="muted wide">
              Загрузка графика смен и ставок из Google-таблиц для расчёта зарплаты.
            </p>
          </div>
        </section>

        <IikoAttendanceCard
          initialFrom={halfMonth.from}
          initialTo={halfMonth.to}
        />

        <IikoExtrasCard
          initialFrom={halfMonth.from}
          initialTo={halfMonth.to}
        />

        <GoogleScheduleCard initialYear={currentYear} initialMonth={currentMonth} />
      </main>
    </div>
  );
}
