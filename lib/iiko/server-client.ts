import crypto from "crypto";

const IIKO_SERVER_BASE = "https://redman-co.iiko.it/resto/api";

function sha1(input: string): string {
  return crypto.createHash("sha1").update(input, "utf8").digest("hex");
}

async function withIikoServerSession<T>(
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const login = process.env.IIKO_SERVER_LOGIN;
  const password = process.env.IIKO_SERVER_PASSWORD;

  if (!login || !password) {
    throw new Error(
      "В Vercel не настроены переменные IIKO_SERVER_LOGIN / IIKO_SERVER_PASSWORD.",
    );
  }

  const authBody = new URLSearchParams({ login, pass: sha1(password) });

  const authResponse = await fetch(`${IIKO_SERVER_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: authBody.toString(),
    cache: "no-store",
  });

  const token = (await authResponse.text()).trim();

  if (!authResponse.ok || !token) {
    throw new Error(
      `Не удалось авторизоваться в iikoServer (HTTP ${authResponse.status}): ${token}`,
    );
  }

  try {
    return await fn(token);
  } finally {
    await fetch(`${IIKO_SERVER_BASE}/logout?key=${token}`, {
      cache: "no-store",
    }).catch(() => {});
  }
}

async function fetchXml(
  token: string,
  path: string,
  label: string,
): Promise<string> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `${IIKO_SERVER_BASE}${path}${separator}key=${token}`,
    { cache: "no-store" },
  );
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Ошибка iikoServer (${label}, HTTP ${response.status}): ${text.substring(0, 500)}`,
    );
  }

  return text;
}

export async function getAttendanceXml(
  dateFrom: string,
  dateTo: string,
): Promise<string> {
  return withIikoServerSession((token) =>
    fetchXml(
      token,
      `/employees/attendance?from=${dateFrom}&to=${dateTo}&withPaymentDetails=true`,
      "явки",
    ),
  );
}

export async function getEmployeesAndAttendance(
  dateFrom: string,
  dateTo: string,
): Promise<{ employeesXml: string; attendanceXml: string }> {
  return withIikoServerSession(async (token) => {
    const employeesXml = await fetchXml(
      token,
      "/employees?includeDeleted=false",
      "сотрудники",
    );
    const attendanceXml = await fetchXml(
      token,
      `/employees/attendance?from=${dateFrom}&to=${dateTo}&withPaymentDetails=true`,
      "явки",
    );
    return { employeesXml, attendanceXml };
  });
}

// Список доступных полей OLAP-отчёта (SALES / TRANSACTIONS / DELIVERIES).
export async function getOlapColumns(reportType: string): Promise<string> {
  return withIikoServerSession((token) =>
    fetchXml(
      token,
      `/v2/reports/olap/columns?reportType=${encodeURIComponent(reportType)}`,
      "поля OLAP",
    ),
  );
}

// Запрос OLAP-отчёта v2 (тело — по документации iikoServer).
export async function runOlapReport(
  body: Record<string, unknown>,
): Promise<string> {
  return withIikoServerSession(async (token) => {
    const response = await fetch(
      `${IIKO_SERVER_BASE}/v2/reports/olap?key=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Ошибка OLAP-отчёта (HTTP ${response.status}): ${text.substring(0, 800)}`,
      );
    }

    return text;
  });
}
