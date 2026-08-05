"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Receipt = {
  date: string;
  sessionNum: number | null;
  orderNum: number | null;
  waiterName: string;
  amount: number;
};

type EmployeeRow = {
  employee_id: string;
  full_name: string;
  hours: number;
  allocated: number;
};

type ChargeData = {
  ok: boolean;
  error?: string;
  period?: { id: string; date_from: string; date_to: string };
  unit?: { id: string; name: string };
  total?: number;
  distributed?: number;
  remainder?: number;
  receipts?: Receipt[];
  employees?: EmployeeRow[];
  by_receipts?: Record<string, number>;
  by_receipts_unmatched?: Array<{ name: string; amount: number }>;
};

const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(value);

export function ServiceChargeForm({
  periodId,
  unitId,
}: {
  periodId: string;
  unitId: string;
}) {
  const [data, setData] = useState<ChargeData | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/service-charge?period=${periodId}&unit=${unitId}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as ChargeData;
      if (!response.ok || !result.ok) {
        setError(result.error ?? `Ошибка сервера: HTTP ${response.status}`);
        setData(null);
      } else {
        setData(result);
        const initial: Record<string, string> = {};
        for (const employee of result.employees ?? []) {
          initial[employee.employee_id] =
            employee.allocated > 0 ? String(employee.allocated) : "";
        }
        setInputs(initial);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить данные.",
      );
    } finally {
      setLoading(false);
    }
  }, [periodId, unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = data?.total ?? 0;

  const distributed = useMemo(
    () =>
      Math.round(
        Object.values(inputs).reduce(
          (sum, value) => sum + (Number(value.replace(",", ".")) || 0),
          0,
        ) * 100,
      ) / 100,
    [inputs],
  );

  const remainder = Math.round((total - distributed) * 100) / 100;
  const overLimit = remainder < -0.005;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const allocations = Object.entries(inputs)
        .map(([employee_id, value]) => ({
          employee_id,
          amount: Number(value.replace(",", ".")) || 0,
        }))
        .filter((row) => row.amount > 0);

      const response = await fetch("/api/service-charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, unitId, allocations }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        remainder?: number;
      };

      if (!response.ok || !result.ok) {
        setError(result.error ?? `Ошибка сервера: HTTP ${response.status}`);
      } else {
        setMessage(
          (result.remainder ?? 0) > 0.005
            ? `Сохранено. Осталось нераспределённым: ${money(result.remainder ?? 0)}. Не забудьте пересчитать зарплату.`
            : "Сохранено, сбор распределён полностью. Не забудьте пересчитать зарплату.",
        );
        await load();
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Не удалось сохранить.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="empty-state">Загружаем сервисный сбор…</div>;
  }

  if (error && !data) {
    return (
      <div className="notice error" style={{ marginTop: 0 }}>
        <strong>Ошибка:</strong> {error}
      </div>
    );
  }

  if (!data) return null;

  const receipts = data.receipts ?? [];
  const employees = data.employees ?? [];

  return (
    <>
      <section className="metric-grid" style={{ marginBottom: "22px" }}>
        <article className="metric-card accent">
          <span>Собрано по чекам</span>
          <strong className="metric-money">{money(total)}</strong>
          <small>{receipts.length} чеков с сервисным сбором</small>
        </article>
        <article className="metric-card">
          <span>Распределено</span>
          <strong className="metric-money">{money(distributed)}</strong>
          <small>по введённым суммам ниже</small>
        </article>
        <article className="metric-card">
          <span>{overLimit ? "Превышение!" : "Осталось"}</span>
          <strong
            className="metric-money"
            style={{
              color: overLimit
                ? "var(--danger)"
                : remainder < 0.01
                  ? "var(--green)"
                  : undefined,
            }}
          >
            {money(Math.abs(remainder))}
          </strong>
          <small>
            {overLimit
              ? "распределено больше, чем собрано"
              : remainder < 0.01
                ? "сбор распределён полностью"
                : "ещё не распределено"}
          </small>
        </article>
      </section>

      {message && (
        <div className="notice success" style={{ margin: "0 0 16px" }}>
          {message}
        </div>
      )}
      {error && (
        <div className="notice error" style={{ margin: "0 0 16px" }}>
          <strong>Ошибка:</strong> {error}
        </div>
      )}

      <section className="content-card" style={{ marginBottom: "22px" }}>
        <div className="section-heading">
          <div>
            <h2>Распределение между сотрудниками</h2>
            <p>
              Введите сумму каждому — или заполните автоматически и
              поправьте руками.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            marginTop: "12px",
          }}
        >
          <button
            type="button"
            className="action-button"
            disabled={saving}
            title="Сбор каждого чека — официанту, который его пробил"
            onClick={() => {
              const suggestion = data.by_receipts ?? {};
              const next: Record<string, string> = {};
              for (const employee of employees) {
                const amount = suggestion[employee.employee_id] ?? 0;
                next[employee.employee_id] =
                  amount > 0 ? String(Math.round(amount)) : "";
              }
              setInputs(next);
              setMessage(null);
            }}
          >
            По чекам (кто пробил)
          </button>
          <button
            type="button"
            className="action-button"
            disabled={saving || employees.length === 0}
            title="Разделить весь сбор поровну между всеми в списке"
            onClick={() => {
              const share = Math.floor(total / employees.length);
              const next: Record<string, string> = {};
              employees.forEach((employee, index) => {
                // Остаток от округления — первому в списке.
                const amount =
                  index === 0
                    ? total - share * (employees.length - 1)
                    : share;
                next[employee.employee_id] = String(Math.round(amount));
              });
              setInputs(next);
              setMessage(null);
            }}
          >
            Поровну
          </button>
          <button
            type="button"
            className="action-button"
            disabled={saving}
            title="Очистить все суммы"
            onClick={() => {
              setInputs({});
              setMessage(null);
            }}
          >
            Очистить
          </button>
        </div>

        {(data.by_receipts_unmatched?.length ?? 0) > 0 && (
          <p className="muted" style={{ marginTop: "10px" }}>
            Не сопоставлены с сотрудниками списка:{" "}
            {data.by_receipts_unmatched
              ?.map((row) => `${row.name} (${money(row.amount)})`)
              .join(", ")}{" "}
            — их чеки при заполнении «по чекам» остаются нераспределёнными.
          </p>
        )}

        <div className="payroll-table-wrap" style={{ marginTop: "12px" }}>
          <table className="payroll-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th className="numeric">Часы за период</th>
                <th className="numeric">Сумма, ₽</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.employee_id}>
                  <td>
                    <strong>{employee.full_name}</strong>
                  </td>
                  <td className="numeric">{employee.hours}</td>
                  <td className="numeric" style={{ width: "160px" }}>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      inputMode="decimal"
                      value={inputs[employee.employee_id] ?? ""}
                      placeholder="0"
                      disabled={saving}
                      onChange={(event) =>
                        setInputs((previous) => ({
                          ...previous,
                          [employee.employee_id]: event.target.value,
                        }))
                      }
                      className="form-input"
                      style={{ width: "100%", textAlign: "right" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            marginTop: "18px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={save}
            disabled={saving || overLimit}
            className="action-button primary"
          >
            {saving ? "Сохраняем…" : "Сохранить распределение"}
          </button>
          {overLimit && (
            <span style={{ color: "var(--danger)", fontWeight: 600 }}>
              Уменьшите суммы: распределено больше, чем собрано.
            </span>
          )}
          {!overLimit && remainder > 0.005 && (
            <span style={{ color: "var(--amber)" }}>
              Осталось распределить {money(remainder)} — можно сохранить и
              вернуться позже.
            </span>
          )}
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <h2>Из чего состоит сумма</h2>
            <p>Каждый чек с сервисным сбором за период.</p>
          </div>
        </div>
        <div className="payroll-table-wrap" style={{ marginTop: "12px" }}>
          <table className="payroll-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th className="numeric">Смена</th>
                <th className="numeric">Чек №</th>
                <th>Официант</th>
                <th className="numeric">Сбор, ₽</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt, index) => (
                <tr key={`${receipt.date}-${receipt.orderNum}-${index}`}>
                  <td>{receipt.date}</td>
                  <td className="numeric">{receipt.sessionNum ?? "—"}</td>
                  <td className="numeric">{receipt.orderNum ?? "—"}</td>
                  <td>{receipt.waiterName || "—"}</td>
                  <td className="numeric money-cell">{money(receipt.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
