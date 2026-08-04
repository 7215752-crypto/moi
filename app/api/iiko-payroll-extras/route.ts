import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchEmployeePurchases,
  fetchSalaryBonuses,
  fetchServiceCharges,
} from "@/lib/iiko/olap";
import { nameMatchKey, normalizeName } from "@/lib/iiko/attendance";

export const dynamic = "force-dynamic";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function getPeriod(request: NextRequest):
  | { from: string; to: string; errorResponse: null }
  | { from: null; to: null; errorResponse: NextResponse } {
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";

  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    return {
      from: null,
      to: null,
      errorResponse: NextResponse.json(
        { ok: false, error: "Укажите корректные даты from и to (YYYY-MM-DD)." },
        { status: 400 },
      ),
    };
  }

  return { from, to, errorResponse: null };
}

type MatchedSum = {
  employee_id: string;
  employee_name: string;
  business_unit_id: string | null;
  business_unit_name: string | null;
  amount: number;
};

type Prepared = {
  periodId: string;
  bonuses: MatchedSum[];
  bonusesUnmatched: Array<{ name: string; amount: number }>;
  bonusesUnassigned: number;
  purchases: MatchedSum[];
  purchasesUnmatched: Array<{ name: string; amount: number }>;
  serviceCharges: Array<{
    business_unit_id: string | null;
    business_unit_name: string;
    amount: number;
  }>;
};

async function prepare(
  supabase: SupabaseServerClient,
  from: string,
  to: string,
): Promise<Prepared> {
  const { data: period, error: periodError } = await supabase
    .from("payroll_periods")
    .select("id")
    .eq("date_from", from)
    .eq("date_to", to)
    .maybeSingle();

  if (periodError) throw new Error(`Поиск периода: ${periodError.message}`);
  if (!period) {
    throw new Error(
      "Расчётный период не найден — сначала импортируйте явки за эти даты.",
    );
  }

  const [
    { data: employees, error: employeesError },
    { data: aliases, error: aliasesError },
    { data: businessUnits, error: businessUnitsError },
    { data: attendance, error: attendanceError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    supabase.from("employees").select("id, full_name"),
    supabase.from("employee_aliases").select("employee_id, external_key, source_name"),
    supabase.from("business_units").select("id, name"),
    supabase
      .from("attendance_records")
      .select("employee_id, business_unit_id, hours")
      .eq("payroll_period_id", period.id),
    supabase
      .from("employee_assignments")
      .select("employee_id, business_unit_id, is_primary, valid_from, valid_to"),
  ]);

  if (employeesError) throw new Error(`Сотрудники: ${employeesError.message}`);
  if (aliasesError) throw new Error(`Псевдонимы: ${aliasesError.message}`);
  if (businessUnitsError)
    throw new Error(`Рестораны: ${businessUnitsError.message}`);
  if (attendanceError) throw new Error(`Явки: ${attendanceError.message}`);
  if (assignmentsError)
    throw new Error(`Назначения: ${assignmentsError.message}`);

  // Сопоставление по имени (включая перестановку слов; неоднозначное — пропуск).
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

  const employeeNameById = new Map<string, string>();
  for (const employee of employees ?? []) {
    addNameKeys(employee.full_name, employee.id);
    employeeNameById.set(employee.id, employee.full_name);
  }
  for (const alias of aliases ?? []) {
    addNameKeys(alias.external_key, alias.employee_id);
    addNameKeys(alias.source_name, alias.employee_id);
  }

  const resolveByName = (name: string): string | null =>
    nameToEmployee.get(normalizeName(name)) ??
    sortedNameToEmployee.get(nameMatchKey(name)) ??
    null;

  const buNameById = new Map<string, string>();
  for (const unit of businessUnits ?? []) buNameById.set(unit.id, unit.name);

  // Основной ресторан сотрудника в периоде: максимум часов по явкам, иначе назначение.
  const hoursByEmployeeBu = new Map<string, Map<string, number>>();
  for (const row of attendance ?? []) {
    const inner =
      hoursByEmployeeBu.get(row.employee_id) ?? new Map<string, number>();
    inner.set(
      row.business_unit_id,
      (inner.get(row.business_unit_id) ?? 0) + Number(row.hours ?? 0),
    );
    hoursByEmployeeBu.set(row.employee_id, inner);
  }

  const mainBusinessUnit = (employeeId: string): string | null => {
    const inner = hoursByEmployeeBu.get(employeeId);
    if (inner && inner.size > 0) {
      return Array.from(inner.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }
    const candidates = (assignments ?? [])
      .filter(
        (row) =>
          row.employee_id === employeeId &&
          row.valid_from <= to &&
          (row.valid_to === null || row.valid_to >= from),
      )
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    return candidates[0]?.business_unit_id ?? null;
  };

  const [bonusesRaw, purchasesRaw, serviceRaw] = [
    await fetchSalaryBonuses(from, to),
    await fetchEmployeePurchases(from, to),
    await fetchServiceCharges(from, to),
  ];

  const toMatched = (
    items: Array<{ name: string; amount: number }>,
  ): { matched: MatchedSum[]; unmatched: Array<{ name: string; amount: number }> } => {
    const matched: MatchedSum[] = [];
    const unmatched: Array<{ name: string; amount: number }> = [];

    for (const item of items) {
      const employeeId = resolveByName(item.name);
      if (!employeeId) {
        unmatched.push(item);
        continue;
      }
      const businessUnitId = mainBusinessUnit(employeeId);
      matched.push({
        employee_id: employeeId,
        employee_name: employeeNameById.get(employeeId) ?? item.name,
        business_unit_id: businessUnitId,
        business_unit_name: businessUnitId
          ? (buNameById.get(businessUnitId) ?? null)
          : null,
        amount: item.amount,
      });
    }

    matched.sort((a, b) => a.employee_name.localeCompare(b.employee_name, "ru"));
    return { matched, unmatched };
  };

  const bonuses = toMatched(bonusesRaw.byEmployee);
  const purchases = toMatched(purchasesRaw);

  const matchBu = (departmentName: string): string | null => {
    const key = normalizeName(departmentName);
    for (const unit of businessUnits ?? []) {
      const unitKey = normalizeName(unit.name);
      if (unitKey === key || unitKey.startsWith(key) || key.startsWith(unitKey)) {
        return unit.id;
      }
    }
    return null;
  };

  const serviceCharges = serviceRaw.map((row) => {
    const businessUnitId = matchBu(row.departmentName);
    return {
      business_unit_id: businessUnitId,
      business_unit_name: businessUnitId
        ? (buNameById.get(businessUnitId) ?? row.departmentName)
        : row.departmentName,
      amount: row.amount,
    };
  });

  return {
    periodId: period.id,
    bonuses: bonuses.matched,
    bonusesUnmatched: bonuses.unmatched,
    bonusesUnassigned: bonusesRaw.unassigned,
    purchases: purchases.matched,
    purchasesUnmatched: purchases.unmatched,
    serviceCharges,
  };
}

function summaryPayload(prepared: Prepared) {
  const total = (rows: Array<{ amount: number }>) =>
    Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;

  return {
    bonuses: prepared.bonuses,
    bonuses_total: total(prepared.bonuses),
    bonuses_unmatched: prepared.bonusesUnmatched,
    bonuses_unassigned: prepared.bonusesUnassigned,
    purchases: prepared.purchases,
    purchases_total: total(prepared.purchases),
    purchases_unmatched: prepared.purchasesUnmatched,
    service_charges: prepared.serviceCharges,
    service_charges_total: total(prepared.serviceCharges),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, errorResponse } = await getAuthorizedClient();
    if (errorResponse) return errorResponse;

    const period = getPeriod(request);
    if (period.errorResponse) return period.errorResponse;

    const prepared = await prepare(supabase, period.from, period.to);

    return NextResponse.json({
      ok: true,
      from: period.from,
      to: period.to,
      ...summaryPayload(prepared),
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

    const period = getPeriod(request);
    if (period.errorResponse) return period.errorResponse;

    const prepared = await prepare(supabase, period.from, period.to);
    const periodId = prepared.periodId;

    // Бонусы мотивации — только с определённым рестораном (иначе строка потеряется в расчёте).
    const skippedNoBu: string[] = [];

    const motivationRows = prepared.bonuses
      .filter((row) => {
        if (!row.business_unit_id) {
          skippedNoBu.push(row.employee_name);
          return false;
        }
        return true;
      })
      .map((row) => ({
        payroll_period_id: periodId,
        employee_id: row.employee_id,
        business_unit_id: row.business_unit_id,
        work_date: period.to,
        program_name: "Бонусы iiko (счёт «Зарплата»)",
        sales_amount: 0,
        motivation_amount: row.amount,
        external_record_id: `olap-bonus:${row.employee_id}`,
      }));

    const { error: deleteBonusesError } = await supabase
      .from("iiko_motivation_records")
      .delete()
      .eq("payroll_period_id", periodId)
      .like("external_record_id", "olap-bonus:%");
    if (deleteBonusesError)
      throw new Error(`Очистка бонусов: ${deleteBonusesError.message}`);

    if (motivationRows.length > 0) {
      const { error: insertBonusesError } = await supabase
        .from("iiko_motivation_records")
        .insert(motivationRows);
      if (insertBonusesError)
        throw new Error(`Запись бонусов: ${insertBonusesError.message}`);
    }

    const purchaseRows = prepared.purchases
      .filter((row) => {
        if (!row.business_unit_id) {
          skippedNoBu.push(row.employee_name);
          return false;
        }
        return true;
      })
      .map((row) => ({
        payroll_period_id: periodId,
        employee_id: row.employee_id,
        business_unit_id: row.business_unit_id,
        adjustment_date: period.to,
        adjustment_type: "purchase",
        amount: -row.amount,
        comment: "Покупки в счёт зарплаты (iiko, «Текущие расчеты с сотрудниками»)",
        source_system: "iiko_olap",
        external_record_id: `olap-purchase:${row.employee_id}`,
      }));

    const { error: deletePurchasesError } = await supabase
      .from("manual_adjustments")
      .delete()
      .eq("payroll_period_id", periodId)
      .eq("source_system", "iiko_olap");
    if (deletePurchasesError)
      throw new Error(`Очистка покупок: ${deletePurchasesError.message}`);

    if (purchaseRows.length > 0) {
      const { error: insertPurchasesError } = await supabase
        .from("manual_adjustments")
        .insert(purchaseRows);
      if (insertPurchasesError)
        throw new Error(`Запись покупок: ${insertPurchasesError.message}`);
    }

    // Уже распределённое менеджером вычитаем — в «прочих расходах» остаётся только остаток.
    const { data: splitRows, error: splitError } = await supabase
      .from("manual_adjustments")
      .select("business_unit_id, amount")
      .eq("payroll_period_id", periodId)
      .eq("source_system", "service_split");
    if (splitError)
      throw new Error(`Распределение сбора: ${splitError.message}`);

    const distributedByBu = new Map<string, number>();
    for (const row of splitRows ?? []) {
      if (!row.business_unit_id) continue;
      distributedByBu.set(
        row.business_unit_id,
        (distributedByBu.get(row.business_unit_id) ?? 0) + Number(row.amount),
      );
    }

    const miscRows = prepared.serviceCharges
      .filter((row) => row.business_unit_id)
      .map((row) => {
        const remainder =
          Math.round(
            (row.amount -
              (distributedByBu.get(row.business_unit_id as string) ?? 0)) *
              100,
          ) / 100;
        return { ...row, remainder };
      })
      .filter((row) => row.remainder > 0.005)
      .map((row) => ({
        payroll_period_id: periodId,
        business_unit_id: row.business_unit_id,
        item_date: period.to,
        item_type: "service_charge",
        description: `Сервисный сбор из чеков (${row.business_unit_name}) — к распределению менеджером`,
        amount: row.remainder,
        source_system: "iiko_olap",
        external_record_id: `olap-service:${row.business_unit_id}`,
      }));

    const { error: deleteMiscError } = await supabase
      .from("payroll_misc_items")
      .delete()
      .eq("payroll_period_id", periodId)
      .eq("source_system", "iiko_olap");
    if (deleteMiscError)
      throw new Error(`Очистка сервисного сбора: ${deleteMiscError.message}`);

    if (miscRows.length > 0) {
      const { error: insertMiscError } = await supabase
        .from("payroll_misc_items")
        .insert(miscRows);
      if (insertMiscError)
        throw new Error(`Запись сервисного сбора: ${insertMiscError.message}`);
    }

    return NextResponse.json({
      ok: true,
      from: period.from,
      to: period.to,
      imported_bonus_count: motivationRows.length,
      imported_purchase_count: purchaseRows.length,
      imported_service_charge_count: miscRows.length,
      skipped_no_business_unit: Array.from(new Set(skippedNoBu)),
      ...summaryPayload(prepared),
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
