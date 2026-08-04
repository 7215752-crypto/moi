"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

export type PayoutActionResult = { ok: boolean; error?: string };

export async function markPaid(input: {
  periodId: string;
  businessUnitId: string;
  employeeId: string;
  amount: number;
}): Promise<PayoutActionResult> {
  const { supabase, user, profile } = await requireUser();

  if (!["owner", "accountant", "manager"].includes(profile.role)) {
    return { ok: false, error: "Недостаточно прав для отметки выплаты." };
  }

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Сумма к выплате должна быть больше нуля." };
  }

  const { error } = await supabase.from("payroll_payouts").insert({
    payroll_period_id: input.periodId,
    business_unit_id: input.businessUnitId,
    employee_id: input.employeeId,
    amount_paid: amount,
    paid_by: user.id,
    paid_by_name: profile.full_name,
  });

  if (error) {
    // 23505 — уникальный индекс: выплата уже отмечена, вторая невозможна.
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Выплата этому сотруднику уже отмечена — повторная невозможна.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/payroll/${input.periodId}`);
  return { ok: true };
}

export async function unmarkPaid(input: {
  periodId: string;
  businessUnitId: string;
  employeeId: string;
}): Promise<PayoutActionResult> {
  const { supabase, profile } = await requireUser();

  if (profile.role !== "owner") {
    return { ok: false, error: "Снять отметку выплаты может только владелец." };
  }

  const { error } = await supabase
    .from("payroll_payouts")
    .delete()
    .eq("payroll_period_id", input.periodId)
    .eq("business_unit_id", input.businessUnitId)
    .eq("employee_id", input.employeeId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/payroll/${input.periodId}`);
  return { ok: true };
}
