import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { GoogleScheduleCard } from "@/components/google-schedule-card";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ImportPage() {
  const { profile } = await requireUser();

  if (!["owner", "accountant"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

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

        <GoogleScheduleCard initialYear={currentYear} initialMonth={currentMonth} />
      </main>
    </div>
  );
}
