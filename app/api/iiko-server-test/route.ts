import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEmployeesAndAttendance } from "@/lib/iiko/server-client";
import {
  attendanceHours,
  attendanceWorkDate,
  normalizeName,
  parseAttendanceXml,
  parseEmployeesXml,
} from "@/lib/iiko/attendance";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { ok: false, error: "Необходимо войти в портал." },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .single();

  if (
    profileError ||
    !profile?.is_active ||
    !["owner", "accountant"].includes(profile.role)
  ) {
    return NextResponse.json(
      { ok: false, error: "Недостаточно прав." },
      { status: 403 },
    );
  }

  const params = request.nextUrl.searchParams;
  const from = DATE_PATTERN.test(params.get("from") ?? "")
    ? (params.get("from") as string)
    : "2026-07-16";
  const to = DATE_PATTERN.test(params.get("to") ?? "")
    ? (params.get("to") as string)
    : "2026-07-31";
  const employeeQuery = normalizeName(params.get("employee"));

  try {
    const { employeesXml, attendanceXml } = await getEmployeesAndAttendance(
      from,
      to,
    );

    const iikoEmployees = parseEmployeesXml(employeesXml);
    const attendances = parseAttendanceXml(attendanceXml);

    const employeeNameById = new Map<string, string>();
    for (const employee of iikoEmployees) {
      employeeNameById.set(employee.id, employee.name);
    }

    // Сводка по подразделениям, как их видит iiko.
    const departments = new Map<string, { records: number; hours: number }>();
    for (const record of attendances) {
      const key = record.departmentName || "(без подразделения)";
      const entry = departments.get(key) ?? { records: 0, hours: 0 };
      entry.records += 1;
      entry.hours += attendanceHours(record);
      departments.set(key, entry);
    }

    // Поиск конкретного сотрудника по части имени.
    let employeeReport: unknown = null;
    if (employeeQuery) {
      const matchedIds = iikoEmployees
        .filter((employee) =>
          normalizeName(employee.name).includes(employeeQuery),
        )
        .map((employee) => employee.id);

      const records = attendances
        .filter((record) => matchedIds.includes(record.employeeId))
        .map((record) => ({
          employee: employeeNameById.get(record.employeeId),
          date: attendanceWorkDate(record),
          from: record.dateFrom,
          to: record.dateTo,
          hours: attendanceHours(record),
          department: record.departmentName || "(без подразделения)",
          type: record.attendanceType,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      employeeReport = {
        matched_names: matchedIds.map((id) => employeeNameById.get(id)),
        record_count: records.length,
        total_hours:
          Math.round(records.reduce((sum, r) => sum + r.hours, 0) * 100) / 100,
        records,
      };
    }

    return NextResponse.json({
      ok: true,
      from,
      to,
      attendance_count: attendances.length,
      departments: Array.from(departments.entries())
        .map(([name, entry]) => ({
          name,
          records: entry.records,
          hours: Math.round(entry.hours * 10) / 10,
        }))
        .sort((a, b) => b.hours - a.hours),
      employee: employeeReport,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}
