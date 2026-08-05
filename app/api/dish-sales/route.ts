import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getMeasureUnits,
  getProductsList,
  runOlapReport,
} from "@/lib/iiko/server-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;

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
        { ok: false, error: "Недостаточно прав для обновления аналитики." },
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

  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (days > MAX_RANGE_DAYS) {
    return {
      from: null,
      to: null,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: `Слишком длинный период: максимум ${MAX_RANGE_DAYS} дня за один импорт.`,
        },
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

type OlapRow = Record<string, unknown>;

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 && text !== "null" ? text : null;
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

type SalesInsertRow = {
  sale_date: string;
  business_unit_id: string;
  dish_id: string;
  dish_name: string;
  dish_type: "DISH" | "MODIFIER";
  main_dish_id: string | null;
  main_dish_name: string | null;
  category: string | null;
  group_name: string | null;
  cooking_place: string | null;
  quantity: number;
  revenue: number;
  cost: number | null;
  avg_guest_wait_seconds: number | null;
};

// Обновляет справочник номенклатуры iiko (имена ингредиентов для техкарт).
// Ошибка здесь не должна ронять импорт продаж — возвращаем предупреждение.
async function refreshProducts(
  supabase: SupabaseServerClient,
): Promise<{ productCount: number; warning: string | null }> {
  try {
    const [productsRaw, unitsRaw] = await Promise.all([
      getProductsList(),
      getMeasureUnits(),
    ]);

    const unitNameById = new Map<string, string>();
    for (const unit of JSON.parse(unitsRaw) as Array<{
      id?: string;
      name?: string;
    }>) {
      if (unit.id && unit.name) unitNameById.set(unit.id, unit.name);
    }

    const products = (
      JSON.parse(productsRaw) as Array<{
        id?: string;
        name?: string;
        mainUnit?: string;
        type?: string;
        deleted?: boolean;
      }>
    )
      .filter((product) => product.id && product.name && !product.deleted)
      .map((product) => ({
        id: product.id as string,
        name: product.name as string,
        main_unit: product.mainUnit
          ? (unitNameById.get(product.mainUnit) ?? null)
          : null,
        product_type: product.type ?? null,
        updated_at: new Date().toISOString(),
      }));

    for (const chunk of splitIntoChunks(products, 500)) {
      const { error } = await supabase
        .from("iiko_products")
        .upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(error.message);
    }

    return { productCount: products.length, warning: null };
  } catch (error) {
    return {
      productCount: 0,
      warning: `Справочник продуктов не обновлён: ${
        error instanceof Error ? error.message : "неизвестная ошибка"
      }`,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, errorResponse } = await getAuthorizedClient();
    if (errorResponse) return errorResponse;

    const period = getPeriod(request);
    if (period.errorResponse) return period.errorResponse;

    const { data: units, error: unitsError } = await supabase
      .from("business_units")
      .select("id, name, iiko_department")
      .not("iiko_department", "is", null);

    if (unitsError) {
      throw new Error(`Рестораны: ${unitsError.message}`);
    }

    const unitByDepartment = new Map<string, string>();
    for (const unit of units ?? []) {
      if (unit.iiko_department) {
        unitByDepartment.set(unit.iiko_department, unit.id);
      }
    }

    if (unitByDepartment.size === 0) {
      throw new Error(
        "Ни у одного ресторана не заполнено поле iiko_department.",
      );
    }

    // Продажи из iiko OLAP: только реальные позиции — без удалённых и сторно.
    const raw = await runOlapReport({
      reportType: "SALES",
      buildSummary: "false",
      groupByRowFields: [
        "OpenDate.Typed",
        "Department",
        "DishId",
        "DishName",
        "DishType",
        "SoldWithDish.Id",
        "SoldWithDish",
        "DishGroup",
        "DishGroup.TopParent",
        "CookingPlace",
      ],
      aggregateFields: [
        "DishAmountInt",
        "DishDiscountSumInt",
        "ProductCostBase.ProductCost",
        "Cooking.GuestWaitTime.Avg",
      ],
      filters: {
        "OpenDate.Typed": {
          filterType: "DateRange",
          periodType: "CUSTOM",
          from: period.from,
          to: period.to,
          includeLow: true,
          includeHigh: true,
        },
        OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
        DeletedWithWriteoff: {
          filterType: "IncludeValues",
          values: ["NOT_DELETED"],
        },
        Storned: { filterType: "IncludeValues", values: ["FALSE"] },
      },
    });

    const olapRows = (JSON.parse(raw) as { data?: OlapRow[] }).data ?? [];

    const unmatchedDepartments = new Set<string>();
    const rows: SalesInsertRow[] = [];

    for (const olapRow of olapRows) {
      const department = asText(olapRow["Department"]);
      const saleDate = asText(olapRow["OpenDate.Typed"])?.slice(0, 10);
      const dishId = asText(olapRow["DishId"]);
      const dishName = asText(olapRow["DishName"]);
      const dishType = asText(olapRow["DishType"]);

      if (!department || !saleDate || !dishId || !dishName) continue;
      if (dishType !== "DISH" && dishType !== "MODIFIER") continue;

      const businessUnitId = unitByDepartment.get(department);
      if (!businessUnitId) {
        unmatchedDepartments.add(department);
        continue;
      }

      const quantity = asNumber(olapRow["DishAmountInt"]);
      const revenue = asNumber(olapRow["DishDiscountSumInt"]);
      if (quantity === 0 && revenue === 0) continue;

      const costValue = olapRow["ProductCostBase.ProductCost"];
      const waitValue = asNumber(olapRow["Cooking.GuestWaitTime.Avg"]);

      rows.push({
        sale_date: saleDate,
        business_unit_id: businessUnitId,
        dish_id: dishId,
        dish_name: dishName,
        dish_type: dishType,
        main_dish_id: asText(olapRow["SoldWithDish.Id"]),
        main_dish_name: asText(olapRow["SoldWithDish"]),
        category: asText(olapRow["DishGroup.TopParent"]),
        group_name: asText(olapRow["DishGroup"]),
        cooking_place: asText(olapRow["CookingPlace"]),
        quantity,
        revenue,
        cost:
          costValue === null || costValue === undefined
            ? null
            : asNumber(costValue),
        avg_guest_wait_seconds: waitValue > 0 ? waitValue : null,
      });
    }

    // Повторный импорт заменяет данные за период целиком.
    const { error: deleteError } = await supabase
      .from("dish_sales_daily")
      .delete()
      .gte("sale_date", period.from)
      .lte("sale_date", period.to);

    if (deleteError) {
      throw new Error(`Очистка старых продаж: ${deleteError.message}`);
    }

    for (const chunk of splitIntoChunks(rows, 1000)) {
      const { error: insertError } = await supabase
        .from("dish_sales_daily")
        .insert(chunk);
      if (insertError) {
        throw new Error(`Запись продаж: ${insertError.message}`);
      }
    }

    const products = await refreshProducts(supabase);

    return NextResponse.json({
      ok: true,
      from: period.from,
      to: period.to,
      source_row_count: olapRows.length,
      imported_row_count: rows.length,
      product_count: products.productCount,
      product_warning: products.warning,
      unmatched_departments: Array.from(unmatchedDepartments),
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
