import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ServiceChargeForm } from "@/components/service-charge-form";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ period?: string; unit?: string }>;
};

export default async function ServiceChargePage({ searchParams }: Props) {
  const { supabase, profile } = await requireUser();

  if (!["owner", "accountant", "manager"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const periodId = query.period;
  const unitId = query.unit;

  // Без параметров — выбор: последний период и список ресторанов.
  if (!periodId || !unitId) {
    const [{ data: period }, { data: units }] = await Promise.all([
      supabase
        .from("payroll_periods")
        .select("id, date_from, date_to")
        .order("date_from", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("business_units")
        .select("id, name, unit_type")
        .eq("is_active", true)
        .order("name"),
    ]);

    return (
      <div className="app-shell">
        <SiteHeader profile={profile} />
        <main className="page-container narrow">
          <nav className="breadcrumbs">
            <Link href="/dashboard">Главная</Link>
            <span>/</span>
            <strong>Сервисный сбор</strong>
          </nav>

          <section className="hero-row compact">
            <div>
              <h1>Сервисный сбор</h1>
              <p className="muted wide">
                Выберите ресторан
                {period
                  ? ` — период ${formatDate(period.date_from)} — ${formatDate(period.date_to)}`
                  : ""}
                .
              </p>
            </div>
          </section>

          <section className="content-card">
            {!period ? (
              <div className="empty-state">Расчётных периодов пока нет.</div>
            ) : (
              <div className="misc-list">
                {(units ?? [])
                  .filter((unit) => unit.unit_type === "restaurant")
                  .map((unit) => (
                    <div key={unit.id}>
                      <span>{unit.name}</span>
                      <Link
                        className="portal-link"
                        href={`/admin/service-charge?period=${period.id}&unit=${unit.id}`}
                      >
                        Открыть →
                      </Link>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }

  const [{ data: period }, { data: unit }] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("id, date_from, date_to")
      .eq("id", periodId)
      .maybeSingle(),
    supabase
      .from("business_units")
      .select("id, name")
      .eq("id", unitId)
      .maybeSingle(),
  ]);

  if (!period || !unit) redirect("/admin/service-charge");

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />
      <main className="page-container">
        <nav className="breadcrumbs">
          <Link href="/dashboard">Главная</Link>
          <span>/</span>
          <Link href={`/payroll/${period.id}`}>Расчёт периода</Link>
          <span>/</span>
          <strong>Сервисный сбор</strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <h1>Сервисный сбор — {unit.name}</h1>
            <p className="muted wide">
              {formatDate(period.date_from)} — {formatDate(period.date_to)} ·
              суммы из чеков iiko, распределение вручную.
            </p>
          </div>
        </section>

        <ServiceChargeForm periodId={period.id} unitId={unit.id} />
      </main>
    </div>
  );
}
