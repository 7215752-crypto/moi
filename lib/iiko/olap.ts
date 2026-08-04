import { runOlapReport } from "./server-client";

type OlapRow = Record<string, unknown>;

function dateFilter(field: string, from: string, to: string) {
  return {
    [field]: {
      filterType: "DateRange",
      periodType: "CUSTOM",
      from,
      to,
      includeLow: true,
      includeHigh: true,
    },
  };
}

async function runAndParse(body: Record<string, unknown>): Promise<OlapRow[]> {
  const raw = await runOlapReport(body);
  const parsed = JSON.parse(raw) as { data?: OlapRow[] };
  return parsed.data ?? [];
}

export type CounteragentSum = { name: string; amount: number };

// Готовые бонусы мотивации: счёт «Зарплата», приход по контрагенту.
export async function fetchSalaryBonuses(
  from: string,
  to: string,
): Promise<{ byEmployee: CounteragentSum[]; unassigned: number }> {
  const rows = await runAndParse({
    reportType: "TRANSACTIONS",
    buildSummary: "false",
    groupByRowFields: ["Counteragent.Name"],
    aggregateFields: ["Sum.Incoming"],
    filters: {
      ...dateFilter("DateTime.DateTyped", from, to),
      "Account.Name": { filterType: "IncludeValues", values: ["Зарплата"] },
    },
  });

  const byEmployee: CounteragentSum[] = [];
  let unassigned = 0;

  for (const row of rows) {
    const name = String(row["Counteragent.Name"] ?? "").trim();
    const amount = Math.round(Number(row["Sum.Incoming"] ?? 0) * 100) / 100;
    if (amount === 0) continue;
    if (!name) {
      unassigned += amount;
    } else {
      byEmployee.push({ name, amount });
    }
  }

  return { byEmployee, unassigned: Math.round(unassigned * 100) / 100 };
}

// Покупки в зарплату: счёт «Текущие расчеты с сотрудниками», приход по контрагенту.
export async function fetchEmployeePurchases(
  from: string,
  to: string,
): Promise<CounteragentSum[]> {
  const rows = await runAndParse({
    reportType: "TRANSACTIONS",
    buildSummary: "false",
    groupByRowFields: ["Counteragent.Name"],
    aggregateFields: ["Sum.Incoming"],
    filters: {
      ...dateFilter("DateTime.DateTyped", from, to),
      "Account.Name": {
        filterType: "IncludeValues",
        values: ["Текущие расчеты с сотрудниками"],
      },
    },
  });

  return rows
    .map((row) => ({
      name: String(row["Counteragent.Name"] ?? "").trim(),
      amount: Math.round(Number(row["Sum.Incoming"] ?? 0) * 100) / 100,
    }))
    .filter((row) => row.name && row.amount > 0);
}

export type ServiceChargeSum = { departmentName: string; amount: number };

// Сервисный сбор: надбавка «Сервисное обслуживание…» из чеков, по ресторанам.
export async function fetchServiceCharges(
  from: string,
  to: string,
): Promise<ServiceChargeSum[]> {
  const rows = await runAndParse({
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["Department", "ItemSaleEventDiscountType"],
    aggregateFields: ["IncreaseSum"],
    filters: dateFilter("OpenDate.Typed", from, to),
  });

  const byDepartment = new Map<string, number>();

  for (const row of rows) {
    const type = String(row["ItemSaleEventDiscountType"] ?? "");
    if (!type.toLowerCase().includes("сервисное обслуживание")) continue;

    const department = String(row["Department"] ?? "").trim();
    const amount = Number(row["IncreaseSum"] ?? 0);
    if (!department || amount <= 0) continue;

    byDepartment.set(department, (byDepartment.get(department) ?? 0) + amount);
  }

  return Array.from(byDepartment.entries()).map(([departmentName, amount]) => ({
    departmentName,
    amount: Math.round(amount * 100) / 100,
  }));
}

// Продажи по официантам (для KPI/аналитики и сверки).
export async function fetchSalesByWaiter(
  from: string,
  to: string,
): Promise<Array<{ departmentName: string; waiterName: string; amount: number }>> {
  const rows = await runAndParse({
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["Department", "WaiterName"],
    aggregateFields: ["DishDiscountSumInt"],
    filters: dateFilter("OpenDate.Typed", from, to),
  });

  return rows
    .map((row) => ({
      departmentName: String(row["Department"] ?? "").trim(),
      waiterName: String(row["WaiterName"] ?? "").trim(),
      amount: Math.round(Number(row["DishDiscountSumInt"] ?? 0) * 100) / 100,
    }))
    .filter((row) => row.departmentName && row.waiterName && row.amount > 0);
}
