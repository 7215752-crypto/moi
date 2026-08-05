// Расчёты товарной аналитики: ABC-классы, дельты к прошлому периоду, периоды-пресеты.
// Используется страницей /analytics и экспортом CSV.

export type DishSummaryRow = {
  dish_id: string;
  dish_name: string;
  category: string | null;
  quantity: number | string;
  revenue: number | string;
  cost: number | string | null;
  attach_revenue: number | string;
  avg_wait_seconds: number | string | null;
};

export type CategorySummaryRow = {
  category: string | null;
  dish_type: string;
  quantity: number | string;
  revenue: number | string;
  cost: number | string | null;
};

export type AbcClass = "A" | "B" | "C";

export type DishStat = {
  dishId: string;
  name: string;
  category: string;
  quantity: number;
  revenue: number;
  cost: number | null;
  foodcostPercent: number | null;
  attachRevenue: number;
  attachPerPortion: number | null;
  avgWaitSeconds: number | null;
  share: number;
  abc: AbcClass;
  prevRevenue: number | null;
  deltaPercent: number | null;
};

export const NO_CATEGORY = "Без группы";

export function toNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

// ABC по выручке: A — блюда, дающие первые 80% выручки, B — следующие 15%, C — хвост.
function assignAbc(revenues: Array<{ id: string; revenue: number }>): Map<string, AbcClass> {
  const total = revenues.reduce((sum, item) => sum + Math.max(item.revenue, 0), 0);
  const sorted = [...revenues].sort((a, b) => b.revenue - a.revenue);
  const result = new Map<string, AbcClass>();

  let cumulative = 0;
  for (const item of sorted) {
    if (total <= 0 || item.revenue <= 0) {
      result.set(item.id, "C");
      continue;
    }
    cumulative += item.revenue;
    const shareCumulative = cumulative / total;
    result.set(item.id, shareCumulative <= 0.8 ? "A" : shareCumulative <= 0.95 ? "B" : "C");
  }

  // Самое продаваемое блюдо всегда A, даже если одно даёт больше 80%.
  if (sorted.length > 0 && sorted[0].revenue > 0) {
    result.set(sorted[0].id, "A");
  }

  return result;
}

export function computeDishStats(
  current: DishSummaryRow[],
  previous: DishSummaryRow[],
): {
  stats: DishStat[];
  prevAbc: Map<string, AbcClass>;
  prevDishes: Map<string, { name: string; category: string; revenue: number; quantity: number }>;
} {
  const prevDishes = new Map<
    string,
    { name: string; category: string; revenue: number; quantity: number }
  >();
  for (const row of previous) {
    prevDishes.set(row.dish_id, {
      name: row.dish_name,
      category: row.category ?? NO_CATEGORY,
      revenue: toNumber(row.revenue),
      quantity: toNumber(row.quantity),
    });
  }

  const prevAbc = assignAbc(
    previous.map((row) => ({ id: row.dish_id, revenue: toNumber(row.revenue) })),
  );
  const currentAbc = assignAbc(
    current.map((row) => ({ id: row.dish_id, revenue: toNumber(row.revenue) })),
  );

  const totalRevenue = current.reduce((sum, row) => sum + toNumber(row.revenue), 0);

  const stats: DishStat[] = current.map((row) => {
    const revenue = toNumber(row.revenue);
    const quantity = toNumber(row.quantity);
    const cost = row.cost === null || row.cost === undefined ? null : toNumber(row.cost);
    const attachRevenue = toNumber(row.attach_revenue);
    const wait =
      row.avg_wait_seconds === null || row.avg_wait_seconds === undefined
        ? null
        : toNumber(row.avg_wait_seconds);
    const prev = prevDishes.get(row.dish_id);

    return {
      dishId: row.dish_id,
      name: row.dish_name,
      category: row.category ?? NO_CATEGORY,
      quantity,
      revenue,
      cost,
      foodcostPercent: cost !== null && revenue > 0 ? (cost / revenue) * 100 : null,
      attachRevenue,
      attachPerPortion: quantity > 0 ? attachRevenue / quantity : null,
      avgWaitSeconds: wait,
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      abc: currentAbc.get(row.dish_id) ?? "C",
      prevRevenue: prev ? prev.revenue : null,
      deltaPercent:
        prev && prev.revenue > 0 ? ((revenue - prev.revenue) / prev.revenue) * 100 : null,
    };
  });

  return { stats, prevAbc, prevDishes };
}

// ---- Даты. «Сегодня» считаем по московскому времени: рестораны живут в нём,
// а сервер Vercel — в UTC.

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export function todayMskIso(): string {
  return new Date(Date.now() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

// Прошлый период той же длины, вплотную перед текущим.
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo };
}

export type PeriodPreset = { key: string; label: string; from: string; to: string };

export function periodPresets(): PeriodPreset[] {
  const today = todayMskIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = addDaysIso(monthStart, -1);
  const prevMonthStart = `${prevMonthEnd.slice(0, 7)}-01`;

  return [
    { key: "today", label: "Сегодня", from: today, to: today },
    { key: "yesterday", label: "Вчера", from: addDaysIso(today, -1), to: addDaysIso(today, -1) },
    { key: "week", label: "7 дней", from: addDaysIso(today, -6), to: today },
    { key: "month", label: "Этот месяц", from: monthStart, to: today },
    { key: "prev-month", label: "Прошлый месяц", from: prevMonthStart, to: prevMonthEnd },
  ];
}

export function defaultRange(): { from: string; to: string } {
  const today = todayMskIso();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

// ---- Форматирование количеств и времени (деньги — в lib/format.ts).

export function formatQuantity(value: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: value % 1 === 0 ? 0 : 1,
  });
}

export function formatWaitMinutes(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const minutes = seconds / 60;
  if (minutes < 1) return "<1 мин";
  return `${minutes.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} мин`;
}

export function formatDeltaPercent(value: number | null): string {
  if (value === null) return "новое";
  const rounded = Math.round(value);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}
