import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/auth";

const roleNames: Record<UserProfile["role"], string> = {
  owner: "Владелец",
  accountant: "Бухгалтер",
  manager: "Управляющий",
  employee: "Сотрудник",
};

async function logout() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export function SiteHeader({ profile }: { profile: UserProfile }) {
  return (
    <header className="site-header">
      <Link href="/dashboard" className="brand-link">
        <span className="mini-brand-mark">R</span>
        <span>
          <strong>Redman Salary</strong>
          <small>Система расчёта сотрудников</small>
        </span>
      </Link>
      <div className="header-user">
        <div>
          <strong>{profile.full_name}</strong>
          <span>{roleNames[profile.role]}</span>
        </div>
        <form action={logout}>
          <button className="ghost-button" type="submit">
            Выйти
          </button>
        </form>
      </div>
    </header>
  );
}
