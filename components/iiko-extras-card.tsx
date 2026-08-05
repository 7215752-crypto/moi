"use client";

import { useState } from "react";

type MatchedSum = {
  employee_name: string;
  business_unit_name: string | null;
  amount: number;
};

type ExtrasResult = {
  ok: boolean;
  error?: string;

  sales_percent?: Array<
    MatchedSum & {
      role: "waiter" | "bartender";
      sales_amount: number;
      bar_sales: number;
    }
  >;
  sales_percent_total?: number;
  sales_unmatched?: Array<{ name: string; amount: number }>;
  sales_skipped_role?: Array<{ name: string; amount: number }>;
  bonuses?: MatchedSum[];
  bonuses_total?: number;
  bonuses_unmatched?: Array<{ name: string; amount: number }>;
  bonuses_unassigned?: number;
  purchases?: MatchedSum[];
  purchases_total?: number;
  purchases_unmatched?: Array<{ name: string; amount: number }>;
  service_charges?: Array<{ business_unit_name: string; amount: number }>;
  service_charges_total?: number;

  imported_sales_percent_count?: number;
  imported_bonus_count?: number;
  imported_purchase_count?: number;
  imported_service_charge_count?: number;
  skipped_no_business_unit?: string[];
};

type IikoExtrasCardProps = {
  initialFrom: string;
  initialTo: string;
};

async function requestExtras(
  method: "GET" | "POST",
  from: string,
  to: string,
): Promise<ExtrasResult> {
  const response = await fetch(`/api/iiko-payroll-extras?from=${from}&to=${to}`, {
    method,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const result = (await response.json()) as ExtrasResult;
  if (!response.ok) {
    return {
      ok: false,
      error: result.error ?? `Ошибка сервера: HTTP ${response.status}`,
    };
  }
  return result;
}

const money = (value: number | undefined) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value ?? 0);

export function IikoExtrasCard({ initialFrom, initialTo }: IikoExtrasCardProps) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [result, setResult] = useState<ExtrasResult | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [action, setAction] = useState<"check" | "import" | null>(null);

  const isLoading = action !== null;

  const run = async (method: "GET" | "POST") => {
    if (method === "POST") {
      const confirmed = window.confirm(
        [
          `Импортировать бонусы, покупки и сервисный сбор за ${from} — ${to}?`,
          "",
          "Повторный импорт заменит ранее загруженные данные iiko этих видов за период.",
        ].join("\n"),
      );
      if (!confirmed) return;
    }

    setAction(method === "GET" ? "check" : "import");
    setResult(null);
    try {
      const response = await requestExtras(method, from, to);
      setResult(response);
      if (method === "GET") setHasChecked(response.ok);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Не удалось выполнить запрос.",
      });
      if (method === "GET") setHasChecked(false);
    } finally {
      setAction(null);
    }
  };

  const isImportResult = typeof result?.imported_bonus_count === "number";
  const unmatched = [
    ...(result?.sales_unmatched ?? []).map((row) => ({
      ...row,
      kind: "продажи",
    })),
    ...(result?.bonuses_unmatched ?? []).map((row) => ({
      ...row,
      kind: "фикс",
    })),
    ...(result?.purchases_unmatched ?? []).map((row) => ({
      ...row,
      kind: "покупки",
    })),
  ];

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <h2>Мотивация, покупки и сервисный сбор из iiko</h2>
          <p>
            Процент от личных продаж по шкале мотивации (официанты 4/5/6%,
            бармены 2%), фиксы за блюда (счёт «Зарплата»), покупки в счёт
            зарплаты и сервисный сбор из чеков. Проверка ничего не записывает.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "end",
          gap: "12px",
          marginTop: "20px",
        }}
      >
        <label style={{ display: "grid", gap: "6px" }}>
          <span className="muted">С даты</span>
          <input
            type="date"
            value={from}
            disabled={isLoading}
            onChange={(event) => {
              setFrom(event.target.value);
              setHasChecked(false);
              setResult(null);
            }}
            className="form-input"
          />
        </label>

        <label style={{ display: "grid", gap: "6px" }}>
          <span className="muted">По дату</span>
          <input
            type="date"
            value={to}
            disabled={isLoading}
            onChange={(event) => {
              setTo(event.target.value);
              setHasChecked(false);
              setResult(null);
            }}
            className="form-input"
          />
        </label>

        <button
          type="button"
          className="action-button"
          onClick={() => run("GET")}
          disabled={isLoading}
        >
          {action === "check" ? "Проверяем…" : "Проверить"}
        </button>

        <button
          type="button"
          className="action-button primary"
          onClick={() => run("POST")}
          disabled={isLoading || !hasChecked}
        >
          {action === "import" ? "Импортируем…" : "Импортировать"}
        </button>
      </div>

      {!hasChecked && !result && (
        <p className="muted" style={{ marginTop: "14px" }}>
          Сначала нажмите «Проверить».
        </p>
      )}

      {result && !result.ok && (
        <div className="notice error">
          <strong>Ошибка:</strong> {result.error ?? "Неизвестная ошибка"}
        </div>
      )}

      {result?.ok && (
        <>
          <div className="metric-grid" style={{ marginTop: "22px" }}>
            <article className="metric-card accent">
              <span>% от продаж</span>
              <strong>{money(result.sales_percent_total)}</strong>
              <small>
                {result.sales_percent?.length ?? 0} сотрудников (шкала
                мотивации)
              </small>
            </article>
            <article className="metric-card">
              <span>Фикс за блюда</span>
              <strong>{money(result.bonuses_total)}</strong>
              <small>{result.bonuses?.length ?? 0} сотрудников</small>
            </article>
            <article className="metric-card">
              <span>Покупки в зарплату</span>
              <strong>{money(result.purchases_total)}</strong>
              <small>
                {result.purchases?.length ?? 0} сотрудников (удержания)
              </small>
            </article>
            <article className="metric-card">
              <span>Сервисный сбор</span>
              <strong>{money(result.service_charges_total)}</strong>
              <small>
                {(result.service_charges ?? [])
                  .map(
                    (row) =>
                      `${row.business_unit_name}: ${money(row.amount)}`,
                  )
                  .join(" · ") || "нет данных"}
              </small>
            </article>
          </div>

          {(result.sales_percent?.length ?? 0) > 0 && (
            <div style={{ marginTop: "18px" }}>
              <h3>Процент от продаж — расшифровка</h3>
              <div style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
                {result.sales_percent?.map((row) => (
                  <div
                    key={`${row.employee_name}:${row.business_unit_name}`}
                    className="plain-row"
                  >
                    <span>
                      {row.employee_name}{" "}
                      <span className="muted">
                        ({row.business_unit_name},{" "}
                        {row.role === "bartender" ? "бармен 2%" : "официант"},
                        выручка {money(row.sales_amount)}
                        {row.bar_sales > 0
                          ? `, из них бар ${money(row.bar_sales)}`
                          : ""}
                        )
                      </span>
                    </span>
                    <strong>{money(row.amount)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isImportResult && (
            <div className="notice success">
              <strong>Импорт завершён.</strong> % от продаж:{" "}
              {result.imported_sales_percent_count}, фиксы:{" "}
              {result.imported_bonus_count}, покупки:{" "}
              {result.imported_purchase_count}, сервисный сбор:{" "}
              {result.imported_service_charge_count} строк. Пересчитайте
              период, чтобы суммы попали в расчёт.
              {(result.skipped_no_business_unit?.length ?? 0) > 0 && (
                <>
                  {" "}
                  Пропущены (не определён ресторан):{" "}
                  {result.skipped_no_business_unit?.join(", ")}.
                </>
              )}
            </div>
          )}

          {(result.sales_skipped_role?.length ?? 0) > 0 && (
            <div className="notice warn">
              Есть личные продажи, но роль (официант/бармен) не определена —
              процент не начислен:{" "}
              {result.sales_skipped_role
                ?.map((row) => `${row.name} (${money(row.amount)})`)
                .join(", ")}
              . Укажите должность сотрудника, если процент положен.
            </div>
          )}

          {(result.bonuses_unassigned ?? 0) > 0 && (
            <div className="notice warn">
              На счёте «Зарплата» есть {money(result.bonuses_unassigned)} без
              привязки к сотруднику — эта сумма в импорт не входит, проверьте
              документ в iiko.
            </div>
          )}

          {unmatched.length > 0 && (
            <div style={{ marginTop: "18px" }}>
              <h3>Не сопоставлены с сотрудниками портала</h3>
              <div style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
                {unmatched.map((row) => (
                  <div key={`${row.kind}:${row.name}`} className="plain-row">
                    <span>
                      {row.name} <span className="muted">({row.kind})</span>
                    </span>
                    <strong>{money(row.amount)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
