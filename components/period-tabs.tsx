"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PeriodTabs({ periodId }: { periodId: string }) {
  const pathname = usePathname();
  const base = `/payroll/${periodId}`;

  const tabs = [
    { href: base, label: "Расчёт", exact: true },
    { href: `${base}/import`, label: "Импорт данных", exact: false },
    { href: `${base}/service-charge`, label: "Сервисный сбор", exact: false },
  ];

  return (
    <nav className="period-tabs" aria-label="Разделы периода">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "period-tab active" : "period-tab"}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
