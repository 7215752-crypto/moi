import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

async function getAuthorizedClient(): Promise<{
  supabase: SupabaseServerClient;
  errorResponse: NextResponse | null;
}> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        { ok: false, error: "Необходимо войти в портал." },
        { status: 401 },
      ),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .single();

  if (
    profileError ||
    !profile?.is_active ||
    !["owner", "accountant", "manager"].includes(profile.role)
  ) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        { ok: false, error: "Недостаточно прав." },
        { status: 403 },
      ),
    };
  }

  return { supabase, errorResponse: null };
}

const ROLE_RU: Record<string, string> = {
  hall: "зал",
  bar: "бар",
  kitchen: "кухня",
};

export async function GET(request: NextRequest) {
  try {
    const { supabase, errorResponse } = await getAuthorizedClient();
    if (errorResponse) return errorResponse;

    const periodId = request.nextUrl.searchParams.get("period") ?? "";
    if (!UUID_PATTERN.test(periodId)) {
      return NextResponse.json(
        { ok: false, error: "Укажите period." },
        { status: 400 },
      );
    }

    const { data: period, error: periodError } = await supabase
      .from("payroll_periods")
      .select("id, date_from, date_to")
      .eq("id", periodId)
      .single();
    if (periodError || !period) {
      return NextResponse.json(
        { ok: false, error: "Период не найден." },
        { status: 404 },
      );
    }

    const { data: shifts, error: shiftsError } = await supabase
      .from("leader_shifts")
      .select(
        `id, leader_role, maximum_bonus, status,
         planned_shifts!inner(shift_date, employee_id, business_unit_id,
           employees(full_name), business_units(name)),
         leader_kpi_results(block_code, approved_amount)`,
      )
      .gte("planned_shifts.shift_date", period.date_from)
      .lte("planned_shifts.shift_date", period.date_to);

    if (shiftsError) {
      throw new Error(`Смены лидеров: ${shiftsError.message}`);
    }

    type RawShift = {
      id: string;
      leader_role: string;
      maximum_bonus: number | string;
      status: string;
      planned_shifts: {
        shift_date: string;
        employee_id: string;
        business_unit_id: string;
        employees: { full_name: string } | null;
        business_units: { name: string } | null;
      };
      leader_kpi_results: Array<{
        block_code: string;
        approved_amount: number | string;
      }>;
    };

    const rows = ((shifts ?? []) as unknown as RawShift[])
      .map((shift) => {
        const approved = shift.leader_kpi_results.find(
          (result) => result.block_code === "shift_total",
        );
        return {
          id: shift.id,
          date: shift.planned_shifts.shift_date,
          employee_name:
            shift.planned_shifts.employees?.full_name ?? "—",
          business_unit_name:
            shift.planned_shifts.business_units?.name ?? "—",
          role: ROLE_RU[shift.leader_role] ?? shift.leader_role,
          maximum_bonus: Number(shift.maximum_bonus),
          approved: shift.status === "approved",
          approved_amount: approved
            ? Number(approved.approved_amount)
            : null,
        };
      })
      .sort(
        (a, b) =>
          a.business_unit_name.localeCompare(b.business_unit_name, "ru") ||
          a.date.localeCompare(b.date) ||
          a.employee_name.localeCompare(b.employee_name, "ru"),
      );

    return NextResponse.json({
      ok: true,
      period: {
        id: period.id,
        date_from: period.date_from,
        date_to: period.date_to,
      },
      shifts: rows,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, errorResponse } = await getAuthorizedClient();
    if (errorResponse) return errorResponse;

    const body = (await request.json()) as {
      decisions?: Array<{
        leader_shift_id?: string;
        approved?: boolean;
        amount?: number;
      }>;
    };

    const decisions = (body.decisions ?? []).filter(
      (decision) =>
        decision.leader_shift_id &&
        UUID_PATTERN.test(decision.leader_shift_id),
    );

    if (decisions.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Нет решений для сохранения." },
        { status: 400 },
      );
    }

    let approvedCount = 0;

    for (const decision of decisions) {
      const shiftId = decision.leader_shift_id as string;

      const { data: shift, error: shiftError } = await supabase
        .from("leader_shifts")
        .select("id, maximum_bonus")
        .eq("id", shiftId)
        .single();
      if (shiftError || !shift) continue;

      const maximum = Number(shift.maximum_bonus);

      // Сбрасываем прежний итог смены.
      const { error: deleteError } = await supabase
        .from("leader_kpi_results")
        .delete()
        .eq("leader_shift_id", shiftId)
        .eq("block_code", "shift_total");
      if (deleteError)
        throw new Error(`Очистка итога: ${deleteError.message}`);

      if (decision.approved) {
        const requested =
          typeof decision.amount === "number" &&
          Number.isFinite(decision.amount)
            ? decision.amount
            : maximum;
        const amount =
          Math.round(Math.min(Math.max(requested, 0), maximum) * 100) / 100;

        const { error: insertError } = await supabase
          .from("leader_kpi_results")
          .insert({
            leader_shift_id: shiftId,
            block_code: "shift_total",
            block_name: "Итог смены (подтверждение менеджера)",
            possible_amount: maximum,
            is_completed: true,
            approved_amount: amount,
          });
        if (insertError)
          throw new Error(`Сохранение итога: ${insertError.message}`);

        const { error: updateError } = await supabase
          .from("leader_shifts")
          .update({ status: "approved" })
          .eq("id", shiftId);
        if (updateError)
          throw new Error(`Статус смены: ${updateError.message}`);

        approvedCount += 1;
      } else {
        const { error: updateError } = await supabase
          .from("leader_shifts")
          .update({ status: "pending" })
          .eq("id", shiftId);
        if (updateError)
          throw new Error(`Статус смены: ${updateError.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      saved: decisions.length,
      approved: approvedCount,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}
