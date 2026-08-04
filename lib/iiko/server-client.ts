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

  const passHash = sha1(password);

  const authBody = new URLSearchParams({ login, pass: passHash });

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

export async function getAttendanceXml(
  dateFrom: string,
  dateTo: string,
): Promise<string> {
  return withIikoServerSession(async (token) => {
    const url =
      `${IIKO_SERVER_BASE}/employees/attendance` +
      `?from=${dateFrom}&to=${dateTo}&withPaymentDetails=true&key=${token}`;

    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Ошибка получения явок (HTTP ${response.status}): ${text.substring(0, 500)}`,
      );
    }

    return text;
  });
}
