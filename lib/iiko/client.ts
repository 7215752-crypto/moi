const IIKO_API_BASE = "https://api-ru.iiko.services/api/v2";

type IikoTokenResponse = {
  token?: string;
  correlationId?: string | null;
};

export async function getIikoAccessToken(): Promise<string> {
  const appId = process.env.IIKO_API_APP_ID;
  const clientSecret = process.env.IIKO_API_CLIENT_SECRET;

  if (!appId || !clientSecret) {
    throw new Error(
      "В Vercel не настроены переменные IIKO_API_APP_ID / IIKO_API_CLIENT_SECRET.",
    );
  }

  const response = await fetch(`${IIKO_API_BASE}/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, apiKey: clientSecret }),
    cache: "no-store",
  });

  const data = (await response.json()) as IikoTokenResponse;

  if (!response.ok || !data.token) {
    throw new Error(
      `Не удалось получить токен iiko (HTTP ${response.status}): ${JSON.stringify(data)}`,
    );
  }

  return data.token;
}

export async function iikoRequest<T = unknown>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const token = await getIikoAccessToken();

  const response = await fetch(`${IIKO_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(
      `Ошибка iiko API ${path} (HTTP ${response.status}): ${JSON.stringify(data)}`,
    );
  }

  return data;
}
