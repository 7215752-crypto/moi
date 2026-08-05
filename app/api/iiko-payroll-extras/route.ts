import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchEmployeePurchases,
  fetchSalaryBonuses,
  fetchSalesByWaiter,
  fetchServiceCharges,
} from "@/lib/iiko/olap";
import { getEmployeesXml } from "@/lib/iiko/server-client";
import {
  nameMatchKey,
  normalizeName,
  parseEmployeesXml,
} from "@/lib/iiko/attendance";

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

type SalesPercentRow = MatchedSum & {
  role: "waiter" | "bartender";
  sales_amount: number;
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
  salesPercent: SalesPercentRow[];
  salesUnmatched: Array<{ name: string; amount: number }>;
  salesSkippedRole: Array<{ name: string; amount: number }>;
};

// Шкала мотивации (PDF «Система мотивации BMB/BRISKET», сверена до копейки).
// Официант, личная выручка за полупериод: до 600 000 ₽ — 4%;
// 600 000–750 000 ₽ — 5% на превышение; свыше 750 000 ₽ — 6% на превышение.
// Бармен — плоские 2%.
const WAITER_TIER_1 = 600000;
const WAITER_TIER_2 = 750000;

function salesPercentAmount(role: "waiter" | "bartender", sales: number): number {
  if (role === "bartender") return Math.round(sales * 0.02 * 100) / 100;
  const tier1 = Math.min(sales, WAITER_TIER_1) * 0.04;
  const tier2 = Math.max(0, Math.min(sales, WAITER_TIER_2) - WAITER_TIER_1) * 0.05;
  const tier3 = Math.max(0, sales - WAITER_TIER_2) * 0.06;
  return Math.round((tier1 + tier2 + tier3) * 100) / 100;
}

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
    { data: departments, error: departmentsError },
  ] = await Promise.all([
    supabase.from("employees").select("id, full_name"),
    supabase.from("employee_aliases").select("employee_id, external_key, source_name"),
    supabase.from("business_units").select("id, name"),
    supabase
      .from("attendance_records")
      .select("employee_id, business_unit_id, department_id, hours")
      .eq("payroll_period_id", period.id),
    supabase
      .from("employee_assignments")
      .select(
        "employee_id, business_unit_id, position_name, is_primary, valid_from, valid_to",
      ),
    supabase.from("departments").select("id, name"),
  ]);

  if (employeesError) throw new Error(`Сотрудники: ${employeesError.message}`);
  if (aliasesError) throw new Error(`Псевдонимы: ${aliasesError.message}`);
  if (businessUnitsError)
    throw new Error(`Рестораны: ${businessUnitsError.message}`);
  if (attendanceError) throw new Error(`Явки: ${attendanceError.message}`);
  if (assignmentsError)
    throw new Error(`Назначения: ${assignmentsError.message}`);
  if (departmentsError)
    throw new Error(`Департаменты: ${departmentsError.message}`);

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

  const [bonusesRaw, purchasesRaw, serviceRaw, salesRaw, employeesXml] = [
    await fetchSalaryBonuses(from, to),
    await fetchEmployeePurchases(from, to),
    await fetchServiceCharges(from, to),
    await fetchSalesByWaiter(from, to),
    await getEmployeesXml(),
  ];

  // Роли из iiko: код основной роли WR* = официант, BR* = бармен.
  // Сотрудника ищем по алиасу с iiko-UUID, иначе по имени.
  const aliasEmployeeByExternalKey = new Map<string, string>();
  for (const alias of aliases ?? []) {
    if (alias.external_key)
      aliasEmployeeByExternalKey.set(alias.external_key, alias.employee_id);
  }
  const iikoRoleByEmployee = new Map<string, "waiter" | "bartender">();
  for (const iikoEmployee of parseEmployeesXml(employeesXml)) {
    const code = iikoEmployee.mainRoleCode.toUpperCase();
    const role = code.startsWith("WR")
      ? ("waiter" as const)
      : code.startsWith("BR")
        ? ("bartender" as const)
        : null;
    if (!role) continue;
    const employeeId =
      aliasEmployeeByExternalKey.get(iikoEmployee.id) ??
      resolveByName(iikoEmployee.name);
    if (employeeId && !iikoRoleByEmployee.has(employeeId)) {
      iikoRoleByEmployee.set(employeeId, role);
    }
  }

  // Роль для процента с продаж: должность из назначений портала (можно
  // переопределить руками), затем роль в iiko, затем департамент явок.
  const roleOf = (employeeId: string): "waiter" | "bartender" | null => {
    const active = (assignments ?? [])
      .filter(
        (row) =>
          row.employee_id === employeeId &&
          row.valid_from <= to &&
          (row.valid_to === null || row.valid_to >= from),
      )
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    let hasOtherPosition = false;
    for (const assignment of active) {
      const position = normalizeName(assignment.position_name);
      if (position.includes("офици")) return "waiter";
      if (position.includes("бармен")) return "bartender";
      if (position) hasOtherPosition = true;
    }
    // Должность в портале задана и это не официант/бармен (повар, управляющий…) —
    // процент не положен, к фолбэкам не идём.
    if (hasOtherPosition) return null;

    const iikoRole = iikoRoleByEmployee.get(employeeId);
    if (iikoRole) return iikoRole;

    const departmentNameById = new Map<string, string>();
    for (const department of departments ?? []) {
      departmentNameById.set(department.id, normalizeName(department.name));
    }
    const hoursByDepartment = new Map<string, number>();
    for (const row of attendance ?? []) {
      if (row.employee_id !== employeeId || !row.department_id) continue;
      hoursByDepartment.set(
        row.department_id,
        (hoursByDepartment.get(row.department_id) ?? 0) + Number(row.hours ?? 0),
      );
    }
    const topDepartment = Array.from(hoursByDepartment.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];
    if (topDepartment) {
      const name = departmentNameById.get(topDepartment[0]) ?? "";
      if (name.includes("зал")) return "waiter";
      if (name.includes("бар")) return "bartender";
    }
    return null;
  };

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

  // Процент от продаж: личная выручка (кто пробил позицию) суммируется по всем
  // ресторанам — пороги шкалы действуют на человека за полупериод целиком.
  const salesByName = new Map<string, number>();
  for (const row of salesRaw) {
    const key = row.waiterName;
    salesByName.set(key, (salesByName.get(key) ?? 0) + row.amount);
  }

  const salesByEmployee = new Map<string, number>();
  const salesUnmatched: Array<{ name: string; amount: number }> = [];
  for (const [name, amount] of salesByName.entries()) {
    const employeeId = resolveByName(name);
    const rounded = Math.round(amount * 100) / 100;
    if (!employeeId) {
      salesUnmatched.push({ name, amount: rounded });
      continue;
    }
    salesByEmployee.set(
      employeeId,
      Math.round(((salesByEmployee.get(employeeId) ?? 0) + rounded) * 100) / 100,
    );
  }

  const salesPercent: SalesPercentRow[] = [];
  const salesSkippedRole: Array<{ name: string; amount: number }> = [];
  for (const [employeeId, salesAmount] of salesByEmployee.entries()) {
    const employeeName = employeeNameById.get(employeeId) ?? employeeId;
    const role = roleOf(employeeId);
    if (!role) {
      salesSkippedRole.push({ name: employeeName, amount: salesAmount });
      continue;
    }
    const amount = salesPercentAmount(role, salesAmount);
    if (amount <= 0) continue;
    const businessUnitId = mainBusinessUnit(employeeId);
    salesPercent.push({
      employee_id: employeeId,
      employee_name: employeeName,
      business_unit_id: businessUnitId,
      business_unit_name: businessUnitId
        ? (buNameById.get(businessUnitId) ?? null)
        : null,
      amount,
      role,
      sales_amount: salesAmount,
    });
  }
  salesPercent.sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name, "ru"),
  );
  salesUnmatched.sort((a, b) => b.amount - a.amount);

  return {
    periodId: period.id,
    bonuses: bonuses.matched,
    bonusesUnmatched: bonuses.unmatched,
    bonusesUnassigned: bonusesRaw.unassigned,
    purchases: purchases.matched,
    purchasesUnmatched: purchases.unmatched,
    serviceCharges,
    salesPercent,
    salesUnmatched,
    salesSkippedRole,
  };
}

function summaryPayload(prepared: Prepared) {
  const total = (rows: Array<{ amount: number }>) =>
    Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;

  return {
    sales_percent: prepared.salesPercent,
    sales_percent_total: total(prepared.salesPercent),
    sales_unmatched: prepared.salesUnmatched,
    sales_skipped_role: prepared.salesSkippedRole,
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

    // Строки без определённого ресторана пропускаем (иначе потеряются в расчёте).
    const skippedNoBu: string[] = [];

    // «% от продаж» — считаем сами по шкале мотивации → iiko_motivation_records.
    const motivationRows = prepared.salesPercent
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
        program_name:
          row.role === "bartender"
            ? "Процент от продаж (бармен 2%)"
            : "Процент от продаж (официант 4/5/6%)",
        sales_amount: row.sales_amount,
        motivation_amount: row.amount,
        external_record_id: `olap-sales-pct:${row.employee_id}`,
      }));

    // Чистим и легаси-записи olap-bonus (фиксы раньше жили в этой таблице).
    for (const pattern of ["olap-bonus:%", "olap-sales-pct:%"]) {
      const { error: deleteMotivationError } = await supabase
        .from("iiko_motivation_records")
        .delete()
        .eq("payroll_period_id", periodId)
        .like("external_record_id", pattern);
      if (deleteMotivationError)
        throw new Error(`Очистка процентов: ${deleteMotivationError.message}`);
    }

    if (motivationRows.length > 0) {
      const { error: insertMotivationError } = await supabase
        .from("iiko_motivation_records")
        .insert(motivationRows);
      if (insertMotivationError)
        throw new Error(`Запись процентов: ${insertMotivationError.message}`);
    }

    // Фиксы за блюда (счёт «Зарплата») → колонка «Фикс блюда».
    const fixedRows = prepared.bonuses
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
        adjustment_type: "iiko_fixed_bonus",
        amount: row.amount,
        comment: "Фикс за блюда (iiko, счёт «Зарплата»)",
        source_system: "iiko_olap",
        external_record_id: `olap-bonus:${row.employee_id}`,
      }));

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

    const { error: deleteAdjustmentsError } = await supabase
      .from("manual_adjustments")
      .delete()
      .eq("payroll_period_id", periodId)
      .eq("source_system", "iiko_olap");
    if (deleteAdjustmentsError)
      throw new Error(`Очистка покупок и фиксов: ${deleteAdjustmentsError.message}`);

    const adjustmentRows = [...fixedRows, ...purchaseRows];
    if (adjustmentRows.length > 0) {
      const { error: insertAdjustmentsError } = await supabase
        .from("manual_adjustments")
        .insert(adjustmentRows);
      if (insertAdjustmentsError)
        throw new Error(`Запись покупок и фиксов: ${insertAdjustmentsError.message}`);
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
      imported_sales_percent_count: motivationRows.length,
      imported_bonus_count: fixedRows.length,
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
