import Link from "next/link";

// Навигация по отчётам аналитики. Новые отчёты добавлять сюда —
// разделы и план: docs/ANALYTICS-PLAN.md.
const REPORTS: Array<{
  href: string;
  section: string;
  label: string;
}> = [
  { href: "/analytics", section: "Товары и склады", label: "Продажи и ABC" },
  { href: "/analytics/labor-cost", section: "Персонал", label: "Лейбор-кост" },
];

export function AnalyticsNav({ current }: { current: string }) {
  return (
    <nav className="period-tabs" aria-label="Отчёты аналитики">
      {REPORTS.map((report) => (
        <Link
          key={report.href}
          href={report.href}
          className={report.href === current ? "period-tab active" : "period-tab"}
        >
          <span className="muted">{report.section} · </span>
          {report.label}
        </Link>
      ))}
    </nav>
  );
}
