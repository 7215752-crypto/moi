"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

type HeaderProfile = {
  role: string;
  full_name?: string | null;
  email?: string | null;
};

type SiteHeaderProps = {
  profile: HeaderProfile;
};

const roleLabels: Record<string, string> = {
  owner: "Владелец",
  accountant: "Бухгалтер",
  manager: "Менеджер",
  administrator: "Администратор",
};

export function SiteHeader({
  profile,
}: SiteHeaderProps) {
  const pathname = usePathname();

  const userName =
    profile.full_name?.trim() ||
    profile.email?.trim() ||
    "Пользователь";

  const navItems = [
    {
      href: "/dashboard",
      label: "Главная",
      active: pathname === "/dashboard",
    },
    {
      href: "/dashboard#planning",
      label: "Планирование",
      active:
        pathname.startsWith("/planning"),
    },
    {
      href: "/dashboard#payroll-periods",
      label: "Сотрудники",
      active:
        pathname.startsWith("/payroll") ||
        pathname.startsWith("/employees"),
    },
    {
      href: "/dashboard#analytics",
      label: "Аналитика",
      active:
        pathname.startsWith("/analytics"),
    },
  ];

  return (
    <header className="site-header">
      <div className="header-left">
        <Link
          href="/dashboard"
          className="brand-link"
          aria-label="MOI Group — главная"
        >
          <span className="mini-brand-mark">
            M
          </span>

          <span>
            <strong>MOI Group</strong>
            <small>
              Портал для менеджеров
            </small>
          </span>
        </Link>

        <nav
          className="header-nav"
          aria-label="Основные разделы"
        >
          {navItems.map((item) => (
            <Link
              href={item.href}
              key={item.label}
              className={
                item.active
                  ? "nav-link active"
                  : "nav-link"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="header-right">
        <ThemeToggle />

        <span className="header-role">
          {roleLabels[profile.role] ??
            profile.role}
        </span>

        <div className="header-user">
          <div>
            <strong>{userName}</strong>
            <span>MOI Group</span>
          </div>

          <form
            action="/auth/signout"
            method="post"
          >
            <button
              type="submit"
              className="signout-button has-tooltip"
              data-tooltip="Завершить текущий сеанс и выйти из портала."
              title="Выйти из портала"
            >
              Выйти
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
