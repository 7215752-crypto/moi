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

function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().substring(0, 10);
}

// Фильтр DateRange по DateTime режет по физическому времени проводки, а не по
// учётному дню: ночные проводки учётного дня «to» (после полуночи) выпадают.
// Берём диапазон на день шире и отсекаем по учётному дню уже в коде.
function accountingDay(row: OlapRow): string {
  return String(row["DateTime.DateTyped"] ?? "").substring(0, 10);
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
    groupByRowFields: ["Counteragent.Name", "DateTime.DateTyped"],
    aggregateFields: ["Sum.Incoming"],
    filters: {
      ...dateFilter("DateTime.DateTyped", from, nextDay(to)),
      "Account.Name": { filterType: "IncludeValues", values: ["Зарплата"] },
    },
  });

  const byName = new Map<string, number>();
  let unassigned = 0;

  for (const row of rows) {
    const day = accountingDay(row);
    if (day < from || day > to) continue;
    const name = String(row["Counteragent.Name"] ?? "").trim();
    const amount = Number(row["Sum.Incoming"] ?? 0);
    if (amount === 0) continue;
    if (!name) unassigned += amount;
    else byName.set(name, (byName.get(name) ?? 0) + amount);
  }

  const byEmployee: CounteragentSum[] = Array.from(byName.entries()).map(
    ([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }),
  );

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
    groupByRowFields: ["Counteragent.Name", "DateTime.DateTyped"],
    aggregateFields: ["Sum.Incoming"],
    filters: {
      ...dateFilter("DateTime.DateTyped", from, nextDay(to)),
      "Account.Name": {
        filterType: "IncludeValues",
        values: ["Текущие расчеты с сотрудниками"],
      },
    },
  });

  const byName = new Map<string, number>();
  for (const row of rows) {
    const day = accountingDay(row);
    if (day < from || day > to) continue;
    const name = String(row["Counteragent.Name"] ?? "").trim();
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? 0) + Number(row["Sum.Incoming"] ?? 0));
  }

  return Array.from(byName.entries())
    .map(([name, amount]) => ({
      name,
      amount: Math.round(amount * 100) / 100,
    }))
    .filter((row) => row.amount > 0);
}

export type EmployeePurchaseDetail = {
  date: string;
  document: string | null;
  product: string | null;
  amount: number;
};

// Расшифровка покупок сотрудника: накладные и продукты
// (проводки счёта «Текущие расчеты с сотрудниками»; продукт берётся с
// контр-стороны проводки — списания со склада).
export async function fetchEmployeePurchaseDetails(
  from: string,
  to: string,
  counteragentNames: string[],
): Promise<EmployeePurchaseDetail[]> {
  if (counteragentNames.length === 0) return [];

  const rows = await runAndParse({
    reportType: "TRANSACTIONS",
    buildSummary: "false",
    groupByRowFields: [
      "DateTime.DateTyped",
      "Document",
      "Contr-Product.Name",
    ],
    aggregateFields: ["Sum.Incoming"],
    filters: {
      ...dateFilter("DateTime.DateTyped", from, nextDay(to)),
      "Account.Name": {
        filterType: "IncludeValues",
        values: ["Текущие расчеты с сотрудниками"],
      },
      "Counteragent.Name": {
        filterType: "IncludeValues",
        values: counteragentNames,
      },
    },
  });

  return rows
    .map((row) => ({
      date: accountingDay(row),
      document:
        row["Document"] === null || row["Document"] === undefined
          ? null
          : String(row["Document"]).trim() || null,
      product:
        row["Contr-Product.Name"] === null ||
        row["Contr-Product.Name"] === undefined
          ? null
          : String(row["Contr-Product.Name"]).trim() || null,
      amount: Math.round(Number(row["Sum.Incoming"] ?? 0) * 100) / 100,
    }))
    .filter(
      (row) => row.amount !== 0 && row.date >= from && row.date <= to,
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.document ?? "").localeCompare(b.document ?? ""),
    );
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

export type DepartmentRevenue = {
  departmentName: string;
  grossRevenue: number; // без скидок (DishSumInt)
  netRevenue: number; // со скидками (DishDiscountSumInt)
};

// Выручка по ресторанам за период: без скидок и со скидками,
// удалённые и сторнированные заказы исключены.
export async function fetchRevenueByDepartment(
  from: string,
  to: string,
): Promise<DepartmentRevenue[]> {
  const rows = await runAndParse({
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["Department"],
    aggregateFields: ["DishSumInt", "DishDiscountSumInt"],
    filters: {
      ...dateFilter("OpenDate.Typed", from, to),
      OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
      DeletedWithWriteoff: {
        filterType: "IncludeValues",
        values: ["NOT_DELETED"],
      },
      Storned: { filterType: "IncludeValues", values: ["FALSE"] },
    },
  });

  return rows
    .map((row) => ({
      departmentName: String(row["Department"] ?? "").trim(),
      grossRevenue: Math.round(Number(row["DishSumInt"] ?? 0) * 100) / 100,
      netRevenue:
        Math.round(Number(row["DishDiscountSumInt"] ?? 0) * 100) / 100,
    }))
    .filter((row) => row.departmentName);
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
