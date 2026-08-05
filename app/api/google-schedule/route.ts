import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type GoogleShift = {
  shift_date: string;
  weekday: string;
  employee_name: string;
  business_unit_code: string;
  department_code: string;
  shift_text: string;
  is_shift_leader: boolean;
  source_sheet: string;
  source_row: number;
  source_column: number;
};

type GoogleScheduleResponse = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  year?: number;
  month?: number;
  source_sheet?: string;
  count?: number;
  shifts?: GoogleShift[];
};

type EmployeeMatchReport = {
  matchedShiftCount: number;
  unmatchedShiftCount: number;
  uniqueEmployeeCount: number;
  unmatchedEmployees: Array<{
    employee_name: string;
    shift_count: number;
  }>;
};

type ParsedShiftTime = {
  plannedStart: string;
  plannedEnd: string;
  isOvernight: boolean;
};

type SupabaseServerClient = Awaited<
  ReturnType<typeof createClient>
>;

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
        {
          ok: false,
          error: "Необходимо войти в портал.",
        },
        { status: 401 },
      ),
    };
  }

  const { data: profile, error: profileError } =
    await supabase
      .from("user_profiles")
      .select("role, is_active")
      .eq("user_id", user.id)
      .single();

  if (profileError || !profile?.is_active) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "Профиль пользователя неактивен.",
        },
        { status: 403 },
      ),
    };
  }

  if (
    !["owner", "accountant", "manager"].includes(profile.role)
  ) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error:
            "Недостаточно прав для работы с графиком.",
        },
        { status: 403 },
      ),
    };
  }

  return {
    supabase,
    errorResponse: null,
  };
}

function getPeriod(request: NextRequest):
  | {
      year: number;
      month: number;
      errorResponse: null;
    }
  | {
      year: null;
      month: null;
      errorResponse: NextResponse;
    } {
  const now = new Date();

  const year = Number(
    request.nextUrl.searchParams.get("year") ??
      now.getFullYear(),
  );

  const month = Number(
    request.nextUrl.searchParams.get("month") ??
      now.getMonth() + 1,
  );

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return {
      year: null,
      month: null,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "Некорректный год или месяц.",
        },
        { status: 400 },
      ),
    };
  }

  return {
    year,
    month,
    errorResponse: null,
  };
}

async function fetchGoogleSchedule(
  year: number,
  month: number,
): Promise<GoogleScheduleResponse> {
  const apiUrl =
    process.env.GOOGLE_SCHEDULE_API_URL;

  const apiToken =
    process.env.GOOGLE_SCHEDULE_API_TOKEN;

  if (!apiUrl || !apiToken) {
    throw new Error(
      "В Vercel не настроены переменные графика.",
    );
  }

  const googleUrl = new URL(apiUrl);

  googleUrl.searchParams.set("token", apiToken);
  googleUrl.searchParams.set("year", String(year));
  googleUrl.searchParams.set(
    "month",
    String(month),
  );

  const googleResponse = await fetch(
    googleUrl.toString(),
    {
      cache: "no-store",
    },
  );

  if (!googleResponse.ok) {
    throw new Error(
      "Google вернул ошибку HTTP " +
        googleResponse.status,
    );
  }

  const result =
    (await googleResponse.json()) as GoogleScheduleResponse;

  if (!result.ok || !result.shifts) {
    throw new Error(
      result.error ??
        "Google не вернул данные графика.",
    );
  }

  return result;
}

function normalizeName(
  value: string | null | undefined,
): string {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

// Ключ без учёта порядка слов: «Наталья Казарина» = «Казарина Наталья».
function sortedNameKey(
  value: string | null | undefined,
): string {
  return normalizeName(value)
    .split(" ")
    .sort()
    .join(" ");
}

function lookupEmployee(
  employeeMap: Map<string, string>,
  name: string | null | undefined,
): string | undefined {
  return (
    employeeMap.get(normalizeName(name)) ??
    employeeMap.get(sortedNameKey(name))
  );
}

async function loadEmployeeMap(
  supabase: SupabaseServerClient,
): Promise<Map<string, string>> {
  const [
    { data: employees, error: employeesError },
    { data: aliases, error: aliasesError },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name"),

    supabase
      .from("employee_aliases")
      .select(
        "employee_id, external_key, source_name",
      ),
  ]);

  if (employeesError) {
    throw new Error(
      "Ошибка чтения сотрудников: " +
        employeesError.message,
    );
  }

  if (aliasesError) {
    throw new Error(
      "Ошибка чтения псевдонимов: " +
        aliasesError.message,
    );
  }

  const employeeMap = new Map<string, string>();
  const ambiguousKeys = new Set<string>();

  // Первый владелец ключа выигрывает; ключ, указывающий на разных
  // сотрудников, становится неоднозначным и убирается совсем.
  const addKey = (
    key: string,
    employeeId: string,
  ) => {
    if (!key || ambiguousKeys.has(key)) return;
    const existing = employeeMap.get(key);
    if (existing === undefined) {
      employeeMap.set(key, employeeId);
    } else if (existing !== employeeId) {
      employeeMap.delete(key);
      ambiguousKeys.add(key);
    }
  };

  const addName = (
    value: string | null | undefined,
    employeeId: string,
  ) => {
    addKey(normalizeName(value), employeeId);
    addKey(sortedNameKey(value), employeeId);
  };

  for (const employee of employees ?? []) {
    addName(employee.full_name, employee.id);
  }

  for (const alias of aliases ?? []) {
    addName(alias.external_key, alias.employee_id);
    addName(alias.source_name, alias.employee_id);
  }

  return employeeMap;
}

function buildEmployeeReport(
  shifts: GoogleShift[],
  employeeMap: Map<string, string>,
): EmployeeMatchReport {
  const unmatchedByName = new Map<
    string,
    {
      employee_name: string;
      shift_count: number;
    }
  >();

  const uniqueScheduleNames =
    new Set<string>();

  let matchedShiftCount = 0;

  for (const shift of shifts) {
    const normalizedName = normalizeName(
      shift.employee_name,
    );

    uniqueScheduleNames.add(normalizedName);

    if (
      lookupEmployee(
        employeeMap,
        shift.employee_name,
      ) !== undefined
    ) {
      matchedShiftCount += 1;
      continue;
    }

    const existing =
      unmatchedByName.get(normalizedName);

    if (existing) {
      existing.shift_count += 1;
    } else {
      unmatchedByName.set(normalizedName, {
        employee_name: shift.employee_name,
        shift_count: 1,
      });
    }
  }

  const unmatchedEmployees = Array.from(
    unmatchedByName.values(),
  ).sort((a, b) =>
    a.employee_name.localeCompare(
      b.employee_name,
      "ru",
    ),
  );

  return {
    matchedShiftCount,
    unmatchedShiftCount:
      shifts.length - matchedShiftCount,
    uniqueEmployeeCount:
      uniqueScheduleNames.size,
    unmatchedEmployees,
  };
}

function parseShiftTime(
  shiftText: string,
): ParsedShiftTime | null {
  const normalized = shiftText
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ")
    .trim();

  const match = normalized.match(
    /(\d{1,2})\s*-\s*(\d{1,2})/u,
  );

  if (!match) {
    return null;
  }

  const startHour = Number(match[1]);
  const endHour = Number(match[2]);

  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    startHour > 23 ||
    endHour < 0 ||
    endHour > 23
  ) {
    return null;
  }

  const plannedStart =
    String(startHour).padStart(2, "0") +
    ":00:00";

  const plannedEnd =
    String(endHour).padStart(2, "0") +
    ":00:00";

  return {
    plannedStart,
    plannedEnd,
    isOvernight: endHour <= startHour,
  };
}

function getSourceCell(
  shift: GoogleShift,
): string {
  return (
    "R" +
    shift.source_row +
    "C" +
    shift.source_column
  );
}

function splitIntoChunks<T>(
  values: T[],
  chunkSize: number,
): T[][] {
  const chunks: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += chunkSize
  ) {
    chunks.push(
      values.slice(index, index + chunkSize),
    );
  }

  return chunks;
}

export async function GET(request: NextRequest) {
  try {
    const {
      supabase,
      errorResponse,
    } = await getAuthorizedClient();

    if (errorResponse) {
      return errorResponse;
    }

    const period = getPeriod(request);

    if (period.errorResponse) {
      return period.errorResponse;
    }

    const result = await fetchGoogleSchedule(
      period.year,
      period.month,
    );

    const employeeMap =
      await loadEmployeeMap(supabase);

    const report = buildEmployeeReport(
      result.shifts ?? [],
      employeeMap,
    );

    const leaderCount = (
      result.shifts ?? []
    ).filter(
      (shift) => shift.is_shift_leader,
    ).length;

    return NextResponse.json({
      ok: true,
      year: period.year,
      month: period.month,
      source_sheet: result.source_sheet,
      count: result.shifts?.length ?? 0,
      leader_count: leaderCount,
      unique_employee_count:
        report.uniqueEmployeeCount,
      matched_shift_count:
        report.matchedShiftCount,
      unmatched_shift_count:
        report.unmatchedShiftCount,
      unmatched_employee_count:
        report.unmatchedEmployees.length,
      unmatched_employees:
        report.unmatchedEmployees,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    const {
      supabase,
      errorResponse,
    } = await getAuthorizedClient();

    if (errorResponse) {
      return errorResponse;
    }

    const period = getPeriod(request);

    if (period.errorResponse) {
      return period.errorResponse;
    }

    const result = await fetchGoogleSchedule(
      period.year,
      period.month,
    );

    const shifts = result.shifts ?? [];

    const [
      employeeMap,
      {
        data: businessUnits,
        error: businessUnitsError,
      },
      {
        data: departments,
        error: departmentsError,
      },
    ] = await Promise.all([
      loadEmployeeMap(supabase),

      supabase
        .from("business_units")
        .select("id, code"),

      supabase
        .from("departments")
        .select(
          "id, business_unit_id, code",
        ),
    ]);

    if (businessUnitsError) {
      throw new Error(
        "Ошибка чтения ресторанов: " +
          businessUnitsError.message,
      );
    }

    if (departmentsError) {
      throw new Error(
        "Ошибка чтения подразделений: " +
          departmentsError.message,
      );
    }

    const businessUnitMap = new Map<
      string,
      string
    >();

    for (const unit of businessUnits ?? []) {
      businessUnitMap.set(
        String(unit.code).toUpperCase(),
        unit.id,
      );
    }

    const departmentMap = new Map<
      string,
      string
    >();

    for (const department of departments ?? []) {
      const key =
        department.business_unit_id +
        "|" +
        String(department.code).toUpperCase();

      departmentMap.set(key, department.id);
    }

    const sourceSheetId =
      "google_schedule:" +
      String(result.source_sheet ?? "");

    const importedAt =
      new Date().toISOString();

    const plannedShiftRows: Array<{
      employee_id: string;
      business_unit_id: string;
      department_id: string;
      shift_date: string;
      planned_start: string;
      planned_end: string;
      is_overnight: boolean;
      is_shift_leader: boolean;
      raw_value: string;
      source_sheet_id: string;
      source_cell: string;
      imported_at: string;
    }> = [];

    const metadataByCell = new Map<
      string,
      {
        departmentCode: string;
      }
    >();

    let invalidTimeCount = 0;
    let missingDepartmentCount = 0;

    for (const shift of shifts) {
      const employeeId = lookupEmployee(
        employeeMap,
        shift.employee_name,
      );

      if (!employeeId) {
        continue;
      }

      const parsedTime = parseShiftTime(
        shift.shift_text,
      );

      if (!parsedTime) {
        invalidTimeCount += 1;
        continue;
      }

      const businessUnitCode =
        String(
          shift.business_unit_code,
        ).toUpperCase();

      // Пометка «бар» в тексте ячейки («м15-02барл») переводит смену в бар,
      // даже если строка сотрудника стоит в секции «Зал» листа.
      const sectionCode = String(
        shift.department_code,
      ).toUpperCase();

      const departmentCode =
        (sectionCode === "HALL" ||
          sectionCode === "BAR") &&
        normalizeName(
          shift.shift_text,
        ).includes("бар")
          ? "BAR"
          : sectionCode;

      const businessUnitId =
        businessUnitMap.get(
          businessUnitCode,
        );

      if (!businessUnitId) {
        missingDepartmentCount += 1;
        continue;
      }

      const departmentId =
        departmentMap.get(
          businessUnitId +
            "|" +
            departmentCode,
        );

      if (!departmentId) {
        missingDepartmentCount += 1;
        continue;
      }

      const sourceCell = getSourceCell(shift);

      plannedShiftRows.push({
        employee_id: employeeId,
        business_unit_id: businessUnitId,
        department_id: departmentId,
        shift_date: shift.shift_date,
        planned_start:
          parsedTime.plannedStart,
        planned_end:
          parsedTime.plannedEnd,
        is_overnight:
          parsedTime.isOvernight,
        is_shift_leader:
          shift.is_shift_leader,
        raw_value: shift.shift_text,
        source_sheet_id: sourceSheetId,
        source_cell: sourceCell,
        imported_at: importedAt,
      });

      metadataByCell.set(sourceCell, {
        departmentCode,
      });
    }

    const importedPlannedShifts: Array<{
      id: string;
      source_cell: string;
      is_shift_leader: boolean;
    }> = [];

    const plannedShiftChunks =
      splitIntoChunks(
        plannedShiftRows,
        200,
      );

    for (const chunk of plannedShiftChunks) {
      const {
        data: upsertedRows,
        error: upsertError,
      } = await supabase
        .from("planned_shifts")
        .upsert(chunk, {
          onConflict:
            "source_sheet_id,source_cell",
        })
        .select(
          "id, source_cell, is_shift_leader",
        );

      if (upsertError) {
        throw new Error(
          "Ошибка записи смен: " +
            upsertError.message,
        );
      }

      importedPlannedShifts.push(
        ...((upsertedRows ?? []) as Array<{
          id: string;
          source_cell: string;
          is_shift_leader: boolean;
        }>),
      );
    }

    const nonLeaderIds =
      importedPlannedShifts
        .filter(
          (shift) =>
            !shift.is_shift_leader,
        )
        .map((shift) => shift.id);

    for (const idChunk of splitIntoChunks(
      nonLeaderIds,
      150,
    )) {
      const { error: deleteLeaderError } =
        await supabase
          .from("leader_shifts")
          .delete()
          .in("planned_shift_id", idChunk);

      if (deleteLeaderError) {
        throw new Error(
          "Ошибка удаления старых отметок лидера: " +
            deleteLeaderError.message,
        );
      }
    }

    const leaderPlannedShifts =
      importedPlannedShifts.filter(
        (shift) => shift.is_shift_leader,
      );

    const leaderIds =
      leaderPlannedShifts.map(
        (shift) => shift.id,
      );

    const existingLeaderIds =
      new Set<string>();

    for (const idChunk of splitIntoChunks(
      leaderIds,
      150,
    )) {
      const {
        data: existingLeaders,
        error: existingLeadersError,
      } = await supabase
        .from("leader_shifts")
        .select("planned_shift_id")
        .in("planned_shift_id", idChunk);

      if (existingLeadersError) {
        throw new Error(
          "Ошибка чтения смен лидеров: " +
            existingLeadersError.message,
        );
      }

      for (
        const existingLeader of
          existingLeaders ?? []
      ) {
        existingLeaderIds.add(
          existingLeader.planned_shift_id,
        );
      }
    }

    const missingLeaderRows: Array<{
      planned_shift_id: string;
      leader_role: string;
      maximum_bonus: number;
      status: string;
    }> = [];

    const existingLeaderGroups = new Map<
      string,
      {
        leaderRole: string;
        maximumBonus: number;
        ids: string[];
      }
    >();

    for (const plannedShift of
      leaderPlannedShifts) {
      const metadata = metadataByCell.get(
        plannedShift.source_cell,
      );

      if (!metadata) {
        continue;
      }

      const leaderRole =
        metadata.departmentCode.toLowerCase();

      const maximumBonus =
        metadata.departmentCode === "HALL"
          ? 1500
          : 1000;

      if (
        existingLeaderIds.has(
          plannedShift.id,
        )
      ) {
        const groupKey =
          leaderRole +
          "|" +
          maximumBonus;

        const existingGroup =
          existingLeaderGroups.get(groupKey);

        if (existingGroup) {
          existingGroup.ids.push(
            plannedShift.id,
          );
        } else {
          existingLeaderGroups.set(
            groupKey,
            {
              leaderRole,
              maximumBonus,
              ids: [plannedShift.id],
            },
          );
        }

        continue;
      }

      missingLeaderRows.push({
        planned_shift_id:
          plannedShift.id,
        leader_role: leaderRole,
        maximum_bonus: maximumBonus,
        status: "pending",
      });
    }

    for (const chunk of splitIntoChunks(
      missingLeaderRows,
      100,
    )) {
      const { error: insertLeaderError } =
        await supabase
          .from("leader_shifts")
          .insert(chunk);

      if (insertLeaderError) {
        throw new Error(
          "Ошибка записи смен лидеров: " +
            insertLeaderError.message,
        );
      }
    }

    for (const group of
      existingLeaderGroups.values()) {
      for (const idChunk of splitIntoChunks(
        group.ids,
        150,
      )) {
        const { error: updateLeaderError } =
          await supabase
            .from("leader_shifts")
            .update({
              leader_role:
                group.leaderRole,
              maximum_bonus:
                group.maximumBonus,
            })
            .in(
              "planned_shift_id",
              idChunk,
            );

        if (updateLeaderError) {
          throw new Error(
            "Ошибка обновления смен лидеров: " +
              updateLeaderError.message,
          );
        }
      }
    }

    const report = buildEmployeeReport(
      shifts,
      employeeMap,
    );

    return NextResponse.json({
      ok: true,
      year: period.year,
      month: period.month,
      source_sheet: result.source_sheet,
      source_shift_count: shifts.length,
      imported_shift_count:
        importedPlannedShifts.length,
      imported_leader_count:
        leaderPlannedShifts.length,
      unmatched_shift_count:
        report.unmatchedShiftCount,
      unmatched_employee_count:
        report.unmatchedEmployees.length,
      unmatched_employees:
        report.unmatchedEmployees,
      invalid_time_count:
        invalidTimeCount,
      missing_department_count:
        missingDepartmentCount,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}