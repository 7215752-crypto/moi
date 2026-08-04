import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOlapColumns, runOlapReport } from "@/lib/iiko/server-client";

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
  const mode = params.get("mode") ?? "columns";
  const reportType = params.get("reportType") ?? "SALES";

  try {
    if (mode === "columns") {
      const raw = await getOlapColumns(reportType);
      const parsed = JSON.parse(raw) as Record<
        string,
        {
          name?: string;
          type?: string;
          aggregationAllowed?: boolean;
          groupingAllowed?: boolean;
          filteringAllowed?: boolean;
        }
      >;

      const q = (params.get("q") ?? "").toLowerCase();
      const fields = Object.entries(parsed)
        .filter(
          ([field, meta]) =>
            !q ||
            field.toLowerCase().includes(q) ||
            (meta.name ?? "").toLowerCase().includes(q),
        )
        .map(([field, meta]) => ({
          field,
          name: meta.name ?? "",
          type: meta.type ?? "",
          agg: meta.aggregationAllowed ? 1 : 0,
          group: meta.groupingAllowed ? 1 : 0,
          filter: meta.filteringAllowed ? 1 : 0,
        }))
        .sort((a, b) => a.field.localeCompare(b.field));

      return NextResponse.json({
        ok: true,
        reportType,
        field_count: fields.length,
        fields,
      });
    }

    if (mode === "report") {
      const from = params.get("from") ?? "2026-07-16";
      const to = params.get("to") ?? "2026-07-31";

      if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
        return NextResponse.json(
          { ok: false, error: "Некорректные from/to." },
          { status: 400 },
        );
      }

      const group = (params.get("group") ?? "Department")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const agg = (params.get("agg") ?? "DishDiscountSumInt")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      const dateField = params.get("dateField") ?? "OpenDate.Typed";

      const filters: Record<string, unknown> = {
        [dateField]: {
          filterType: "DateRange",
          periodType: "CUSTOM",
          from,
          to,
          includeLow: true,
          includeHigh: true,
        },
      };

      // Необязательный фильтр по значениям: ?vfField=Account.Name&vfValues=Зарплата|Другой счёт
      const vfField = params.get("vfField");
      const vfValues = (params.get("vfValues") ?? "")
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean);
      if (vfField && vfValues.length > 0) {
        filters[vfField] = { filterType: "IncludeValues", values: vfValues };
      }

      const body: Record<string, unknown> = {
        reportType,
        buildSummary: "false",
        groupByRowFields: group,
        aggregateFields: agg,
        filters,
      };

      const raw = await runOlapReport(body);
      const parsed = JSON.parse(raw) as { data?: unknown[] };
      const rows = parsed.data ?? [];

      return NextResponse.json({
        ok: true,
        reportType,
        from,
        to,
        row_count: rows.length,
        rows: rows.slice(0, 200),
      });
    }

    return NextResponse.json(
      { ok: false, error: "mode должен быть columns или report." },
      { status: 400 },
    );
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
