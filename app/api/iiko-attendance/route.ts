import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEmployeesAndAttendance } from "@/lib/iiko/server-client";
import {
  attendanceHours,
  attendanceWorkDate,
  nameMatchKey,
  normalizeName,
  parseAttendanceXml,
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

  if (profileError || !profile?.is_active) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        { ok: false, error: "Профиль пользователя неактивен." },
        { status: 403 },
      ),
    };
  }

  if (!["owner", "accountant", "manager"].includes(profile.role)) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        { ok: false, error: "Недостаточно прав для расчёта зарплаты." },
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

function splitIntoChunks<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

type PreparedImport = {
  totalSourceRecords: number;
  typeBreakdown: Record<string, number>;
  unmatchedBusinessUnits: string[];
  unmatchedEmployees: Array<{
    iiko_employee_id: string;
    employee_name: string;
    known_name: boolean;
    total_hours: number;
  }>;
  newAliasRows: Array<{
    employee_id: string;
    source_system: string;
    external_key: string;
    source_name: string;
  }>;
  summaryRows: Array<{
    employee_name: string;
    business_unit_name: string;
    department_name: string | null;
    total_hours: number;
    has_rate: boolean;
  }>;
  attendanceRows: Array<{
    employee_id: string;
    business_unit_id: string;
    department_id: string | null;
    work_date: string;
    hours: number;
    first_in: string | null;
    last_out: string | null;
    source_system: string;
    external_record_id: string;
  }>;
  shiftRateEmployeeIds: string[];
};

async function prepareImport(
  supabase: SupabaseServerClient,
  from: string,
  to: string,
): Promise<PreparedImport> {
  const { employeesXml, attendanceXml } = await getEmployeesAndAttendance(
    from,
    to,
  );

  const iikoEmployees = parseEmployeesXml(employeesXml);
  const iikoAttendances = parseAttendanceXml(attendanceXml);

  const [
    { data: employees, error: employeesError },
    { data: aliases, error: aliasesError },
    { data: businessUnits, error: businessUnitsError },
    { data: assignments, error: assignmentsError },
    { data: rates, error: ratesError },
    { data: plannedShifts, error: plannedShiftsError },
  ] = await Promise.all([
    supabase.from("employees").select("id, full_name"),
    supabase
      .from("employee_aliases")
      .select("employee_id, source_system, external_key, source_name"),
    supabase.from("business_units").select("id, name"),
    supabase
      .from("employee_assignments")
      .select(
        "employee_id, business_unit_id, department_id, is_primary, valid_from, valid_to",
      ),
    supabase
      .from("employee_rates")
      .select(
        "employee_id, business_unit_id, department_id, rate_type, valid_from, valid_to",
      ),
    supabase
      .from("planned_shifts")
      .select("employee_id, business_unit_id, department_id, shift_date")
      .gte("shift_date", from)
      .lte("shift_date", to),
  ]);

  if (employeesError) throw new Error(`Сотрудники: ${employeesError.message}`);
  if (aliasesError) throw new Error(`Псевдонимы: ${aliasesError.message}`);
  if (businessUnitsError)
    throw new Error(`Рестораны: ${businessUnitsError.message}`);
  if (assignmentsError)
    throw new Error(`Назначения: ${assignmentsError.message}`);
  if (ratesError) throw new Error(`Ставки: ${ratesError.message}`);
  if (plannedShiftsError)
    throw new Error(`График смен: ${plannedShiftsError.message}`);

  // Подразделение дня из графика Google: сотрудник × ресторан × дата.
  const plannedDepartmentByDay = new Map<string, string>();
  for (const shift of plannedShifts ?? []) {
    if (!shift.department_id) continue;
    plannedDepartmentByDay.set(
      `${shift.employee_id}|${shift.business_unit_id}|${shift.shift_date}`,
      shift.department_id,
    );
  }

  // Сопоставление сотрудников: сперва по сохранённому iiko-ID, затем по ФИО
  // (в т.ч. с перестановкой имени и фамилии; неоднозначные совпадения пропускаем).
  const iikoIdToEmployee = new Map<string, string>();
  const nameToEmployee = new Map<string, string>();
  const sortedNameToEmployee = new Map<string, string | null>();

  const addNameKeys = (value: string | null | undefined, employeeId: string) => {
    const key = normalizeName(value);
    if (!key) return;

    if (!nameToEmployee.has(key)) {
      nameToEmployee.set(key, employeeId);
    }

    const sortedKey = nameMatchKey(value);
    const existing = sortedNameToEmployee.get(sortedKey);
    if (existing === undefined) {
      sortedNameToEmployee.set(sortedKey, employeeId);
    } else if (existing !== employeeId) {
      sortedNameToEmployee.set(sortedKey, null);
    }
  };

  for (const employee of employees ?? []) {
    addNameKeys(employee.full_name, employee.id);
  }

  for (const alias of aliases ?? []) {
    if (alias.source_system === "iiko" && alias.external_key) {
      iikoIdToEmployee.set(alias.external_key, alias.employee_id);
    }
    addNameKeys(alias.external_key, alias.employee_id);
    addNameKeys(alias.source_name, alias.employee_id);
  }

  const iikoEmployeeNameById = new Map<string, string>();
  for (const employee of iikoEmployees) {
    iikoEmployeeNameById.set(employee.id, employee.name);
  }

  const newAliasRows: PreparedImport["newAliasRows"] = [];

  function resolveEmployee(iikoEmployeeId: string): string | null {
    const direct = iikoIdToEmployee.get(iikoEmployeeId);
    if (direct) return direct;

    const iikoName = iikoEmployeeNameById.get(iikoEmployeeId);
    const matched =
      nameToEmployee.get(normalizeName(iikoName)) ??
      sortedNameToEmployee.get(nameMatchKey(iikoName)) ??
      null;

    if (matched && iikoName) {
      iikoIdToEmployee.set(iikoEmployeeId, matched);
      newAliasRows.push({
        employee_id: matched,
        source_system: "iiko",
        external_key: iikoEmployeeId,
        source_name: iikoName,
      });
      return matched;
    }

    return null;
  }

  // Рестораны iiko ("Brisket") ↔ наши ("Brisket Eat & Fun") — по началу названия.
  const buByNormalizedName = (iikoName: string): { id: string; name: string } | null => {
    const key = normalizeName(iikoName);
    if (!key) return null;

    for (const unit of businessUnits ?? []) {
      const unitKey = normalizeName(unit.name);
      if (unitKey === key || unitKey.startsWith(key) || key.startsWith(unitKey)) {
        return { id: unit.id, name: unit.name };
      }
    }
    return null;
  };

  const assignmentDepartment = (
    employeeId: string,
    businessUnitId: string,
  ): string | null => {
    const candidates = (assignments ?? []).filter(
      (row) =>
        row.employee_id === employeeId &&
        row.business_unit_id === businessUnitId &&
        row.valid_from <= to &&
        (row.valid_to === null || row.valid_to >= from),
    );
    candidates.sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary),
    );
    return candidates[0]?.department_id ?? null;
  };

  const hasRate = (
    employeeId: string,
    businessUnitId: string,
    departmentId: string | null,
  ): boolean =>
    (rates ?? []).some(
      (rate) =>
        rate.employee_id === employeeId &&
        (rate.business_unit_id === null ||
          rate.business_unit_id === businessUnitId) &&
        (rate.department_id === null || rate.department_id === departmentId) &&
        rate.valid_from <= to &&
        (rate.valid_to === null || rate.valid_to >= from),
    );

  const typeBreakdown: Record<string, number> = {};
  const unmatchedBuSet = new Set<string>();
  const unmatchedByIikoId = new Map<
    string,
    { employee_name: string; known_name: boolean; total_hours: number }
  >();
  const dayTotals = new Map<
    string,
    {
      employee_id: string;
      business_unit_id: string;
      department_id: string | null;
      work_date: string;
      hours: number;
      first_in: string | null;
      last_out: string | null;
    }
  >();

  for (const record of iikoAttendances) {
    const workDate = attendanceWorkDate(record);
    if (workDate < from || workDate > to) continue;

    const hours = attendanceHours(record);
    if (hours <= 0) continue;

    const typeKey = record.attendanceType || "—";
    typeBreakdown[typeKey] = (typeBreakdown[typeKey] ?? 0) + 1;

    const unit = buByNormalizedName(record.departmentName);
    if (!unit) {
      if (record.departmentName) unmatchedBuSet.add(record.departmentName);
      continue;
    }

    const employeeId = resolveEmployee(record.employeeId);
    if (!employeeId) {
      const iikoName = iikoEmployeeNameById.get(record.employeeId);
      const entry = unmatchedByIikoId.get(record.employeeId);

      if (entry) {
        entry.total_hours += hours;
      } else {
        unmatchedByIikoId.set(record.employeeId, {
          employee_name: iikoName ?? `iiko:${record.employeeId}`,
          known_name: Boolean(iikoName),
          total_hours: hours,
        });
      }
      continue;
    }

    // Приоритет — плановое подразделение из графика (бар/зал в конкретный день),
    // затем постоянное назначение сотрудника.
    const departmentId =
      plannedDepartmentByDay.get(`${employeeId}|${unit.id}|${workDate}`) ??
      assignmentDepartment(employeeId, unit.id);
    const key = `${employeeId}|${unit.id}|${workDate}`;
    const existing = dayTotals.get(key);

    if (existing) {
      existing.hours = Math.round((existing.hours + hours) * 10000) / 10000;
      if (record.dateFrom < (existing.first_in ?? "9999")) {
        existing.first_in = record.dateFrom;
      }
      if (record.dateTo > (existing.last_out ?? "")) {
        existing.last_out = record.dateTo;
      }
    } else {
      dayTotals.set(key, {
        employee_id: employeeId,
        business_unit_id: unit.id,
        department_id: departmentId,
        work_date: workDate,
        hours,
        first_in: record.dateFrom || null,
        last_out: record.dateTo || null,
      });
    }
  }

  const employeeNameById = new Map<string, string>();
  for (const employee of employees ?? []) {
    employeeNameById.set(employee.id, employee.full_name);
  }
  const buNameById = new Map<string, string>();
  for (const unit of businessUnits ?? []) {
    buNameById.set(unit.id, unit.name);
  }

  const departmentNameById = new Map<string, string>();
  {
    const { data: departments } = await supabase
      .from("departments")
      .select("id, name");
    for (const department of departments ?? []) {
      departmentNameById.set(department.id, department.name);
    }
  }

  const summaryMap = new Map<
    string,
    PreparedImport["summaryRows"][number] & {
      employee_id: string;
      business_unit_id: string;
      department_id: string | null;
    }
  >();

  for (const row of dayTotals.values()) {
    const key = `${row.employee_id}|${row.business_unit_id}`;
    const existing = summaryMap.get(key);

    if (existing) {
      existing.total_hours =
        Math.round((existing.total_hours + row.hours) * 100) / 100;
    } else {
      summaryMap.set(key, {
        employee_id: row.employee_id,
        business_unit_id: row.business_unit_id,
        department_id: row.department_id,
        employee_name:
          employeeNameById.get(row.employee_id) ?? row.employee_id,
        business_unit_name:
          buNameById.get(row.business_unit_id) ?? row.business_unit_id,
        department_name: row.department_id
          ? (departmentNameById.get(row.department_id) ?? null)
          : null,
        total_hours: Math.round(row.hours * 100) / 100,
        has_rate: hasRate(
          row.employee_id,
          row.business_unit_id,
          row.department_id,
        ),
      });
    }
  }

  const summaryRows = Array.from(summaryMap.values())
    .map(({ employee_id, business_unit_id, department_id, ...rest }) => rest)
    .sort((a, b) =>
      (a.business_unit_name + a.employee_name).localeCompare(
        b.business_unit_name + b.employee_name,
        "ru",
      ),
    );

  // Времена iiko приходят без часового пояса и сохраняются как есть (UTC в базе):
  // при показе сравниваем «условно-локальные» часы-минуты с planned_start графика.
  const attendanceRows = Array.from(dayTotals.values()).map((row) => ({
    employee_id: row.employee_id,
    business_unit_id: row.business_unit_id,
    department_id: row.department_id,
    work_date: row.work_date,
    hours: row.hours,
    first_in: row.first_in,
    last_out: row.last_out,
    source_system: "iiko",
    external_record_id: `${row.work_date}:${row.employee_id}:${row.business_unit_id}`,
  }));

  // Сотрудники со ставкой «за смену»: их день с явкой станет одной сменой.
  const shiftRateEmployeeIds = Array.from(
    new Set(
      (rates ?? [])
        .filter(
          (rate) =>
            rate.rate_type === "shift" &&
            rate.valid_from <= to &&
            (rate.valid_to === null || rate.valid_to >= from),
        )
        .map((rate) => rate.employee_id as string),
    ),
  );

  return {
    totalSourceRecords: iikoAttendances.length,
    typeBreakdown,
    unmatchedBusinessUnits: Array.from(unmatchedBuSet),
    unmatchedEmployees: Array.from(unmatchedByIikoId.entries())
      .map(([iiko_employee_id, entry]) => ({
        iiko_employee_id,
        employee_name: entry.employee_name,
        known_name: entry.known_name,
        total_hours: Math.round(entry.total_hours * 100) / 100,
      }))
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name, "ru")),
    newAliasRows,
    summaryRows,
    attendanceRows,
    shiftRateEmployeeIds,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, errorResponse } = await getAuthorizedClient();
    if (errorResponse) return errorResponse;

    const period = getPeriod(request);
    if (period.errorResponse) return period.errorResponse;

    const prepared = await prepareImport(supabase, period.from, period.to);

    return NextResponse.json({
      ok: true,
      from: period.from,
      to: period.to,
      source_record_count: prepared.totalSourceRecords,
      type_breakdown: prepared.typeBreakdown,
      row_count: prepared.attendanceRows.length,
      new_alias_count: prepared.newAliasRows.length,
      unmatched_business_units: prepared.unmatchedBusinessUnits,
      unmatched_employees: prepared.unmatchedEmployees,
      summary: prepared.summaryRows,
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

    let prepared = await prepareImport(supabase, period.from, period.to);

    // Сотрудников, которых нет в базе, создаём автоматически по данным iiko.
    const creatable = prepared.unmatchedEmployees.filter(
      (entry) => entry.known_name,
    );
    const createdEmployees: string[] = [];

    if (creatable.length > 0) {
      for (const entry of creatable) {
        const { data: created, error: createEmployeeError } = await supabase
          .from("employees")
          .insert({ full_name: entry.employee_name, status: "active" })
          .select("id")
          .single();

        if (createEmployeeError || !created) {
          throw new Error(
            `Создание сотрудника «${entry.employee_name}»: ${createEmployeeError?.message ?? "нет ответа"}`,
          );
        }

        const { error: createAliasError } = await supabase
          .from("employee_aliases")
          .insert({
            employee_id: created.id,
            source_system: "iiko",
            external_key: entry.iiko_employee_id,
            source_name: entry.employee_name,
          });

        if (createAliasError) {
          throw new Error(
            `Связка сотрудника «${entry.employee_name}» с iiko: ${createAliasError.message}`,
          );
        }

        createdEmployees.push(entry.employee_name);
      }

      // Повторная подготовка: теперь новые сотрудники сопоставятся по iiko-ID.
      prepared = await prepareImport(supabase, period.from, period.to);
    }

    // Находим или создаём расчётный период.
    const { data: existingPeriod, error: findError } = await supabase
      .from("payroll_periods")
      .select("id")
      .eq("date_from", period.from)
      .eq("date_to", period.to)
      .maybeSingle();

    if (findError) {
      throw new Error(`Поиск периода: ${findError.message}`);
    }

    let periodId = existingPeriod?.id as string | undefined;

    if (!periodId) {
      const dueDate = new Date(`${period.to}T00:00:00Z`);
      dueDate.setUTCDate(dueDate.getUTCDate() + 5);
      const paymentDueDate = dueDate.toISOString().substring(0, 10);

      const { data: createdPeriod, error: createError } = await supabase
        .from("payroll_periods")
        .insert({
          date_from: period.from,
          date_to: period.to,
          payment_due_date: paymentDueDate,
          status: "draft",
        })
        .select("id")
        .single();

      if (createError || !createdPeriod) {
        throw new Error(
          `Создание периода: ${createError?.message ?? "нет ответа"}`,
        );
      }

      periodId = createdPeriod.id;
    }

    // Запоминаем найденные соответствия сотрудников iiko.
    for (const chunk of splitIntoChunks(prepared.newAliasRows, 100)) {
      const { error: aliasError } = await supabase
        .from("employee_aliases")
        .insert(chunk);
      if (aliasError) {
        throw new Error(`Сохранение соответствий: ${aliasError.message}`);
      }
    }

    // Повторный импорт заменяет прошлые данные iiko за период.
    const { error: deleteError } = await supabase
      .from("attendance_records")
      .delete()
      .eq("payroll_period_id", periodId)
      .eq("source_system", "iiko");

    if (deleteError) {
      throw new Error(`Очистка старых явок: ${deleteError.message}`);
    }

    const rows = prepared.attendanceRows.map((row) => ({
      ...row,
      payroll_period_id: periodId,
    }));

    for (const chunk of splitIntoChunks(rows, 200)) {
      const { error: insertError } = await supabase
        .from("attendance_records")
        .insert(chunk);
      if (insertError) {
        throw new Error(`Запись явок: ${insertError.message}`);
      }
    }

    // Для сотрудников со ставкой «за смену» день с явкой считается одной сменой.
    const shiftEmployeeSet = new Set(prepared.shiftRateEmployeeIds);
    const shiftRows = prepared.attendanceRows
      .filter((row) => shiftEmployeeSet.has(row.employee_id))
      .map((row) => ({
        payroll_period_id: periodId,
        employee_id: row.employee_id,
        business_unit_id: row.business_unit_id,
        department_id: row.department_id,
        work_date: row.work_date,
        shift_count: 1,
        source_system: "iiko",
        external_record_id: row.external_record_id,
      }));

    const { error: deleteShiftsError } = await supabase
      .from("worked_shift_records")
      .delete()
      .eq("payroll_period_id", periodId)
      .eq("source_system", "iiko");

    if (deleteShiftsError) {
      throw new Error(`Очистка старых смен: ${deleteShiftsError.message}`);
    }

    for (const chunk of splitIntoChunks(shiftRows, 200)) {
      const { error: insertShiftsError } = await supabase
        .from("worked_shift_records")
        .insert(chunk);
      if (insertShiftsError) {
        throw new Error(`Запись смен: ${insertShiftsError.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      from: period.from,
      to: period.to,
      payroll_period_id: periodId,
      imported_row_count: rows.length,
      created_employees: createdEmployees,
      new_alias_count: prepared.newAliasRows.length,
      unmatched_business_units: prepared.unmatchedBusinessUnits,
      unmatched_employees: prepared.unmatchedEmployees,
      summary: prepared.summaryRows,
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
