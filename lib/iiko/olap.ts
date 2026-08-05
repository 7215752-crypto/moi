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

export type ServiceChargeReceipt = {
  departmentName: string;
  date: string;
  sessionNum: number | null;
  orderNum: number | null;
  waiterName: string;
  amount: number;
};

// Расшифровка сервисного сбора по чекам (дата, смена, № чека, официант, сумма).
export async function fetchServiceChargeReceipts(
  from: string,
  to: string,
): Promise<ServiceChargeReceipt[]> {
  // Сначала выясняем точные названия надбавок «Сервисное обслуживание…»
  const types = await runAndParse({
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["ItemSaleEventDiscountType"],
    aggregateFields: ["IncreaseSum"],
    filters: dateFilter("OpenDate.Typed", from, to),
  });

  const serviceTypes = types
    .map((row) => String(row["ItemSaleEventDiscountType"] ?? ""))
    .filter((type) => type.toLowerCase().includes("сервисное обслуживание"));

  if (serviceTypes.length === 0) return [];

  const rows = await runAndParse({
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: [
      "Department",
      "OpenDate.Typed",
      "SessionNum",
      "OrderNum",
      "OrderWaiter.Name",
    ],
    aggregateFields: ["IncreaseSum"],
    filters: {
      ...dateFilter("OpenDate.Typed", from, to),
      ItemSaleEventDiscountType: {
        filterType: "IncludeValues",
        values: serviceTypes,
      },
    },
  });

  return rows
    .map((row) => ({
      departmentName: String(row["Department"] ?? "").trim(),
      date: String(row["OpenDate.Typed"] ?? "").substring(0, 10),
      sessionNum:
        row["SessionNum"] === null || row["SessionNum"] === undefined
          ? null
          : Number(row["SessionNum"]),
      orderNum:
        row["OrderNum"] === null || row["OrderNum"] === undefined
          ? null
          : Number(row["OrderNum"]),
      waiterName: String(row["OrderWaiter.Name"] ?? "").trim(),
      amount: Math.round(Number(row["IncreaseSum"] ?? 0) * 100) / 100,
    }))
    .filter((row) => row.departmentName && row.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.orderNum ?? 0) - (b.orderNum ?? 0));
}

// Личные продажи по официантам с разбивкой по ресторану и дню
// (день нужен, чтобы отделять барные смены от зальных по графику).
export async function fetchSalesByWaiter(
  from: string,
  to: string,
): Promise<
  Array<{ departmentName: string; waiterName: string; date: string; amount: number }>
> {
  const rows = await runAndParse({
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["Department", "WaiterName", "OpenDate.Typed"],
    aggregateFields: ["DishDiscountSumInt"],
    filters: dateFilter("OpenDate.Typed", from, to),
  });

  return rows
    .map((row) => ({
      departmentName: String(row["Department"] ?? "").trim(),
      waiterName: String(row["WaiterName"] ?? "").trim(),
      date: String(row["OpenDate.Typed"] ?? "").substring(0, 10),
      amount: Math.round(Number(row["DishDiscountSumInt"] ?? 0) * 100) / 100,
    }))
    .filter((row) => row.departmentName && row.waiterName && row.amount !== 0);
}
