import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchServiceChargeReceipts } from "@/lib/iiko/olap";
import { nameMatchKey, normalizeName } from "@/lib/iiko/attendance";

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

async function loadContext(
  supabase: SupabaseServerClient,
  periodId: string,
  unitId: string,
) {
  const [
    { data: period, error: periodError },
    { data: unit, error: unitError },
  ] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("id, date_from, date_to")
      .eq("id", periodId)
      .single(),
    supabase
      .from("business_units")
      .select("id, name")
      .eq("id", unitId)
      .single(),
  ]);

  if (periodError || !period) throw new Error("Период не найден.");
  if (unitError || !unit) throw new Error("Ресторан не найден.");

  const receiptsAll = await fetchServiceChargeReceipts(
    period.date_from,
    period.date_to,
  );

  const unitKey = normalizeName(unit.name);
  const receipts = receiptsAll.filter((row) => {
    const key = normalizeName(row.departmentName);
    return key === unitKey || unitKey.startsWith(key) || key.startsWith(unitKey);
  });

  const total =
    Math.round(receipts.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;

  return { period, unit, receipts, total };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, errorResponse } = await getAuthorizedClient();
    if (errorResponse) return errorResponse;

    const periodId = request.nextUrl.searchParams.get("period") ?? "";
    const unitId = request.nextUrl.searchParams.get("unit") ?? "";
    if (!UUID_PATTERN.test(periodId) || !UUID_PATTERN.test(unitId)) {
      return NextResponse.json(
        { ok: false, error: "Укажите period и unit." },
        { status: 400 },
      );
    }

    const { period, unit, receipts, total } = await loadContext(
      supabase,
      periodId,
      unitId,
    );

    const [
      { data: attendance, error: attendanceError },
      { data: allocations, error: allocationsError },
      { data: aliases, error: aliasesError },
    ] = await Promise.all([
      supabase
        .from("attendance_records")
        .select("employee_id, hours, employees(full_name)")
        .eq("payroll_period_id", periodId)
        .eq("business_unit_id", unitId),
      supabase
        .from("manual_adjustments")
        .select("employee_id, amount")
        .eq("payroll_period_id", periodId)
        .eq("business_unit_id", unitId)
        .eq("source_system", "service_split"),
      supabase
        .from("employee_aliases")
        .select("employee_id, external_key, source_name"),
    ]);

    if (attendanceError) throw new Error(`Явки: ${attendanceError.message}`);
    if (allocationsError)
      throw new Error(`Распределение: ${allocationsError.message}`);
    if (aliasesError) throw new Error(`Псевдонимы: ${aliasesError.message}`);

    const allocationByEmployee = new Map<string, number>();
    for (const row of allocations ?? []) {
      allocationByEmployee.set(
        row.employee_id,
        (allocationByEmployee.get(row.employee_id) ?? 0) + Number(row.amount),
      );
    }

    const hoursByEmployee = new Map<
      string,
      { name: string; hours: number }
    >();
    for (const row of attendance ?? []) {
      const name =
        (row as unknown as { employees?: { full_name?: string } }).employees
          ?.full_name ?? "";
      const existing = hoursByEmployee.get(row.employee_id);
      if (existing) existing.hours += Number(row.hours ?? 0);
      else
        hoursByEmployee.set(row.employee_id, {
          name,
          hours: Number(row.hours ?? 0),
        });
    }

    const employees = Array.from(hoursByEmployee.entries())
      .map(([employee_id, info]) => ({
        employee_id,
        full_name: info.name || employee_id,
        hours: Math.round(info.hours * 10) / 10,
        allocated: allocationByEmployee.get(employee_id) ?? 0,
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));

    const distributed =
      Math.round(
        Array.from(allocationByEmployee.values()).reduce(
          (sum, value) => sum + value,
          0,
        ) * 100,
      ) / 100;

    // Подсказка «по чекам»: сбор каждого чека — официанту, который его пробил.
    const nameToEmployee = new Map<string, string>();
    const sortedNameToEmployee = new Map<string, string | null>();
    const addNameKeys = (value: string | null | undefined, employeeId: string) => {
      const key = normalizeName(value);
      if (!key) return;
      if (!nameToEmployee.has(key)) nameToEmployee.set(key, employeeId);
      const sortedKey = nameMatchKey(value);
      const existing = sortedNameToEmployee.get(sortedKey);
      if (existing === undefined) sortedNameToEmployee.set(sortedKey, employeeId);
      else if (existing !== employeeId) sortedNameToEmployee.set(sortedKey, null);
    };
    for (const [employeeId, info] of hoursByEmployee.entries()) {
      addNameKeys(info.name, employeeId);
    }
    for (const alias of aliases ?? []) {
      if (hoursByEmployee.has(alias.employee_id)) {
        addNameKeys(alias.external_key, alias.employee_id);
        addNameKeys(alias.source_name, alias.employee_id);
      }
    }

    const byReceipts: Record<string, number> = {};
    const receiptsUnmatched = new Map<string, number>();
    for (const receipt of receipts) {
      const employeeId =
        nameToEmployee.get(normalizeName(receipt.waiterName)) ??
        sortedNameToEmployee.get(nameMatchKey(receipt.waiterName)) ??
        null;
      if (employeeId) {
        byReceipts[employeeId] =
          Math.round(((byReceipts[employeeId] ?? 0) + receipt.amount) * 100) /
          100;
      } else {
        const key = receipt.waiterName || "(без официанта)";
        receiptsUnmatched.set(
          key,
          Math.round(((receiptsUnmatched.get(key) ?? 0) + receipt.amount) * 100) /
            100,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      period: {
        id: period.id,
        date_from: period.date_from,
        date_to: period.date_to,
      },
      unit: { id: unit.id, name: unit.name },
      total,
      distributed,
      remainder: Math.round((total - distributed) * 100) / 100,
      receipts,
      employees,
      by_receipts: byReceipts,
      by_receipts_unmatched: Array.from(receiptsUnmatched.entries()).map(
        ([name, amount]) => ({ name, amount }),
      ),
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
      periodId?: string;
      unitId?: string;
      allocations?: Array<{ employee_id?: string; amount?: number }>;
    };

    const periodId = body.periodId ?? "";
    const unitId = body.unitId ?? "";
    if (!UUID_PATTERN.test(periodId) || !UUID_PATTERN.test(unitId)) {
      return NextResponse.json(
        { ok: false, error: "Укажите periodId и unitId." },
        { status: 400 },
      );
    }

    const allocations = (body.allocations ?? [])
      .filter(
        (row) =>
          row.employee_id &&
          UUID_PATTERN.test(row.employee_id) &&
          typeof row.amount === "number" &&
          Number.isFinite(row.amount) &&
          (row.amount as number) > 0,
      )
      .map((row) => ({
        employee_id: row.employee_id as string,
        amount: Math.round((row.amount as number) * 100) / 100,
      }));

    const { period, unit, total } = await loadContext(
      supabase,
      periodId,
      unitId,
    );

    const distributed =
      Math.round(
        allocations.reduce((sum, row) => sum + row.amount, 0) * 100,
      ) / 100;

    if (distributed > total + 0.01) {
      return NextResponse.json(
        {
          ok: false,
          error: `Распределено ${distributed} ₽ — больше собранного сбора ${total} ₽.`,
        },
        { status: 400 },
      );
    }

    // Перезаписываем распределение этого ресторана.
    const { error: deleteError } = await supabase
      .from("manual_adjustments")
      .delete()
      .eq("payroll_period_id", periodId)
      .eq("business_unit_id", unitId)
      .eq("source_system", "service_split");
    if (deleteError)
      throw new Error(`Очистка распределения: ${deleteError.message}`);

    if (allocations.length > 0) {
      const { error: insertError } = await supabase
        .from("manual_adjustments")
        .insert(
          allocations.map((row) => ({
            payroll_period_id: periodId,
            employee_id: row.employee_id,
            business_unit_id: unitId,
            adjustment_date: period.date_to,
            adjustment_type: "service_charge",
            amount: row.amount,
            comment: "Сервисный сбор (распределение менеджера)",
            source_system: "service_split",
            external_record_id: `service-split:${periodId}:${row.employee_id}`,
          })),
        );
      if (insertError)
        throw new Error(`Запись распределения: ${insertError.message}`);
    }

    // Котёл в «прочих расходах» превращается в нераспределённый остаток.
    const remainder = Math.round((total - distributed) * 100) / 100;

    const { error: deleteMiscError } = await supabase
      .from("payroll_misc_items")
      .delete()
      .eq("payroll_period_id", periodId)
      .eq("business_unit_id", unitId)
      .eq("source_system", "iiko_olap")
      .eq("item_type", "service_charge");
    if (deleteMiscError)
      throw new Error(`Обновление котла: ${deleteMiscError.message}`);

    if (remainder > 0.005) {
      const { error: insertMiscError } = await supabase
        .from("payroll_misc_items")
        .insert({
          payroll_period_id: periodId,
          business_unit_id: unitId,
          item_date: period.date_to,
          item_type: "service_charge",
          description: `Сервисный сбор (${unit.name}) — нераспределённый остаток`,
          amount: remainder,
          source_system: "iiko_olap",
          external_record_id: `olap-service:${periodId}:${unitId}`,
        });
      if (insertMiscError)
        throw new Error(`Запись остатка: ${insertMiscError.message}`);
    }

    return NextResponse.json({
      ok: true,
      total,
      distributed,
      remainder,
      allocation_count: allocations.length,
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
