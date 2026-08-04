"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

// Следующий полумесячный период после последнего существующего.
function nextHalfPeriod(lastTo: string | null): { from: string; to: string } {
  const iso = (date: Date) => date.toISOString().substring(0, 10);

  if (!lastTo) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    if (now.getUTCDate() <= 15) {
      return {
        from: iso(new Date(Date.UTC(year, month, 1))),
        to: iso(new Date(Date.UTC(year, month, 15))),
      };
    }
    return {
      from: iso(new Date(Date.UTC(year, month, 16))),
      to: iso(new Date(Date.UTC(year, month + 1, 0))),
    };
  }

  const last = new Date(`${lastTo}T00:00:00Z`);
  const year = last.getUTCFullYear();
  const month = last.getUTCMonth();

  if (last.getUTCDate() === 15) {
    return {
      from: iso(new Date(Date.UTC(year, month, 16))),
      to: iso(new Date(Date.UTC(year, month + 1, 0))),
    };
  }
  return {
    from: iso(new Date(Date.UTC(year, month + 1, 1))),
    to: iso(new Date(Date.UTC(year, month + 1, 15))),
  };
}

export async function createNextPeriod() {
  const { supabase, profile } = await requireUser();

  if (!["owner", "accountant", "manager"].includes(profile.role)) {
    redirect("/employees");
  }

  const { data: last } = await supabase
    .from("payroll_periods")
    .select("date_to")
    .order("date_to", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { from, to } = nextHalfPeriod(last?.date_to ?? null);

  const due = new Date(`${to}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 5);

  const { data: created, error } = await supabase
    .from("payroll_periods")
    .insert({
      date_from: from,
      date_to: to,
      payment_due_date: due.toISOString().substring(0, 10),
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Не удалось создать период: ${error?.message ?? "нет ответа"}`);
  }

  redirect(`/payroll/${created.id}`);
}
