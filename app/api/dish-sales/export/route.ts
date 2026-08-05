import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  computeDishStats,
  defaultRange,
  isValidIsoDate,
  previousRange,
  type DishSummaryRow,
} from "@/lib/dish-sales";

export const dynamic = "force-dynamic";

// Число в формате русского Excel: запятая как разделитель дробной части.
function csvNumber(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toFixed(digits).replace(".", ",");
}

function csvText(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

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

  const params = request.nextUrl.searchParams;
  const fallback = defaultRange();
  const fromParam = params.get("from") ?? undefined;
  const toParam = params.get("to") ?? undefined;
  let from = isValidIsoDate(fromParam) ? fromParam : fallback.from;
  let to = isValidIsoDate(toParam) ? toParam : fallback.to;
  if (from > to) [from, to] = [to, from];

  const unit = params.get("unit") || null;
  const category = params.get("cat") || null;
  const abcParam = params.get("abc");
  const abc = abcParam === "A" || abcParam === "B" || abcParam === "C" ? abcParam : null;
  const search = (params.get("q") ?? "").trim().toLowerCase();

  const prev = previousRange(from, to);

  const [currentResult, prevResult] = await Promise.all([
    supabase.rpc("dish_sales_summary", { p_from: from, p_to: to, p_unit: unit }),
    supabase.rpc("dish_sales_summary", {
      p_from: prev.from,
      p_to: prev.to,
      p_unit: unit,
    }),
  ]);

  if (currentResult.error) {
    return NextResponse.json(
      { ok: false, error: currentResult.error.message },
      { status: 500 },
    );
  }

  const { stats } = computeDishStats(
    (currentResult.data ?? []) as DishSummaryRow[],
    ((prevResult.error ? [] : prevResult.data) ?? []) as DishSummaryRow[],
  );

  const filtered = stats
    .filter(
      (stat) =>
        (!category || stat.category === category) &&
        (!abc || stat.abc === abc) &&
        (!search || stat.name.toLowerCase().includes(search)),
    )
    .sort((a, b) => b.revenue - a.revenue);

  const header = [
    "№",
    "Блюдо",
    "Категория",
    "Продано, шт",
    "Выручка, ₽",
    "Доля, %",
    "Допы, ₽",
    "Допы ₽/порц.",
    "Себестоимость, ₽",
    "Фудкост, %",
    "Время отдачи, мин",
    "К прошлому периоду, %",
    "Класс ABC",
  ].join(";");

  const lines = filtered.map((stat, index) =>
    [
      String(index + 1),
      csvText(stat.name),
      csvText(stat.category),
      csvNumber(stat.quantity, stat.quantity % 1 === 0 ? 0 : 1),
      csvNumber(stat.revenue, 2),
      csvNumber(stat.share, 1),
      csvNumber(stat.attachRevenue, 2),
      csvNumber(stat.attachPerPortion, 2),
      csvNumber(stat.cost, 2),
      csvNumber(stat.foodcostPercent, 1),
      csvNumber(
        stat.avgWaitSeconds !== null ? stat.avgWaitSeconds / 60 : null,
        1,
      ),
      csvNumber(stat.deltaPercent, 1),
      stat.abc,
    ].join(";"),
  );

  // BOM — чтобы Excel открыл кириллицу как UTF-8.
  const csv = `﻿${header}\n${lines.join("\n")}`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dish-sales_${from}_${to}.csv"`,
    },
  });
}
