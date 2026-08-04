import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { PeriodTabs } from "@/components/period-tabs";
import { ServiceChargeForm } from "@/components/service-charge-form";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ periodId: string }>;
  searchParams: Promise<{ unit?: string }>;
};

export default async function PeriodServiceChargePage({
  params,
  searchParams,
}: Props) {
  const { periodId } = await params;
  const { unit: unitId } = await searchParams;
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

  const { data: units } = await supabase
    .from("business_units")
    .select("id, name, unit_type")
    .eq("is_active", true)
    .order("name");

  const restaurants = (units ?? []).filter(
    (unit) => unit.unit_type === "restaurant",
  );
  const selected = restaurants.find((unit) => unit.id === unitId) ?? null;

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
          <strong>Сервисный сбор</strong>
        </nav>

        <section className="hero-row compact">
          <div>
            <h1>
              Сервисный сбор{selected ? ` — ${selected.name}` : ""}
            </h1>
            <p className="muted wide">
              Суммы из чеков iiko, распределение между сотрудниками — вручную.
            </p>
          </div>
        </section>

        <PeriodTabs periodId={periodId} />

        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "20px",
          }}
        >
          {restaurants.map((unit) => (
            <Link
              key={unit.id}
              href={`/payroll/${periodId}/service-charge?unit=${unit.id}`}
              className={
                unit.id === selected?.id ? "period-tab active" : "period-tab"
              }
              style={{
                border: "1px solid var(--line)",
                background:
                  unit.id === selected?.id
                    ? "var(--surface-strong)"
                    : "var(--surface-dim)",
              }}
            >
              {unit.name}
            </Link>
          ))}
        </div>

        {selected ? (
          <ServiceChargeForm periodId={periodId} unitId={selected.id} />
        ) : (
          <div className="empty-state">Выберите ресторан.</div>
        )}
      </main>
    </div>
  );
}
