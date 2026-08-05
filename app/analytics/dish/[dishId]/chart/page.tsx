import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { getAssemblyChart } from "@/lib/iiko/server-client";
import { formatDate } from "@/lib/format";
import { todayMskIso } from "@/lib/dish-sales";

type Props = {
  params: Promise<{ dishId: string }>;
};

type ChartItem = {
  productId?: string;
  amount?: number;
};

type PreparedChart = {
  items?: ChartItem[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Закладка в человеческом виде: «0.04 кг» → «40 г», «0.2 л» → «200 мл».
function humanizeAmount(amount: number, unit: string | null): string {
  if (unit === "кг" && amount < 1) {
    return `${Math.round(amount * 1000)} г`;
  }
  if (unit === "л" && amount < 1) {
    return `${Math.round(amount * 1000)} мл`;
  }
  const rounded =
    amount % 1 === 0
      ? amount.toString()
      : amount.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return unit ? `${rounded} ${unit}` : rounded;
}

export default async function DishChartPage({ params }: Props) {
  const { dishId } = await params;
  if (!UUID_PATTERN.test(dishId)) notFound();

  const { supabase, profile } = await requireUser();

  // Имя блюда — из справочника номенклатуры, запасной вариант — из продаж.
  const { data: product } = await supabase
    .from("iiko_products")
    .select("name")
    .eq("id", dishId)
    .maybeSingle();

  let dishName = product?.name ?? null;
  if (!dishName) {
    const { data: salesRow } = await supabase
      .from("dish_sales_daily")
      .select("dish_name")
      .eq("dish_id", dishId)
      .limit(1)
      .maybeSingle();
    dishName = salesRow?.dish_name ?? null;
  }
  if (!dishName) notFound();

  const today = todayMskIso();

  let items: Array<{ name: string; amount: string }> = [];
  let loadError: string | null = null;

  try {
    const raw = await getAssemblyChart(dishId, today);
    const parsed = JSON.parse(raw) as { preparedCharts?: PreparedChart[] };
    const chart = (parsed.preparedCharts ?? []).find(
      (candidate) => (candidate.items ?? []).length > 0,
    );

    const chartItems = (chart?.items ?? []).filter(
      (item): item is Required<ChartItem> =>
        Boolean(item.productId) && typeof item.amount === "number" && item.amount > 0,
    );

    if (chartItems.length > 0) {
      const productIds = Array.from(new Set(chartItems.map((item) => item.productId)));
      const { data: ingredients } = await supabase
        .from("iiko_products")
        .select("id, name, main_unit")
        .in("id", productIds);

      const ingredientById = new Map(
        (ingredients ?? []).map((ingredient) => [ingredient.id, ingredient]),
      );

      items = chartItems.map((item) => {
        const ingredient = ingredientById.get(item.productId);
        return {
          name: ingredient?.name ?? "Неизвестный ингредиент",
          amount: humanizeAmount(item.amount, ingredient?.main_unit ?? null),
        };
      });
    }
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Не удалось загрузить техкарту.";
  }

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />

      <main className="page-container">
        <section className="analytics-header">
          <div>
            <h1>Техкарта: {dishName}</h1>
            <p className="muted">
              Состав и нормы закладки из iiko, действует на {formatDate(today)}.
            </p>
          </div>
        </section>

        <section className="content-card">
          {loadError ? (
            <div className="notice error">{loadError}</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              Техкарта для этого блюда в iiko не заведена.
            </div>
          ) : (
            <div className="payroll-table-wrap">
              <table className="payroll-table">
                <thead>
                  <tr>
                    <th>Ингредиент</th>
                    <th className="numeric">Закладка на порцию</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={`${item.name}-${index}`}>
                      <td>{item.name}</td>
                      <td className="numeric">{item.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
