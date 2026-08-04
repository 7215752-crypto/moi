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
      <div
        style={{
          padding: "14px 16px",
          borderRadius: "10px",
          background: "#fff1f0",
          color: "#a8071a",
        }}
      >
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
            style={{ color: overLimit ? "#a8071a" : remainder < 0.01 ? "#176b35" : undefined }}
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
        <div
          style={{
            marginBottom: "16px",
            padding: "13px 16px",
            borderRadius: "10px",
            background: "#edf8f0",
            color: "#176b35",
          }}
        >
          {message}
        </div>
      )}
      {error && (
        <div
          style={{
            marginBottom: "16px",
            padding: "13px 16px",
            borderRadius: "10px",
            background: "#fff1f0",
            color: "#a8071a",
          }}
        >
          <strong>Ошибка:</strong> {error}
        </div>
      )}

      <section className="content-card" style={{ marginBottom: "22px" }}>
        <div className="section-heading">
          <div>
            <h2>Распределение между сотрудниками</h2>
            <p>
              Введите сумму каждому. Часы за период показаны для ориентира —
              деление полностью на ваше усмотрение.
            </p>
          </div>
        </div>

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
                      style={{
                        width: "100%",
                        padding: "9px 10px",
                        border: "1px solid #d7dce2",
                        borderRadius: "9px",
                        background: "white",
                        font: "inherit",
                        textAlign: "right",
                      }}
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
            className="primary-button"
            style={{
              padding: "12px 22px",
              background: overLimit ? "#aeb8c4" : "#1f6feb",
              color: "white",
              cursor: saving || overLimit ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Сохраняем…" : "Сохранить распределение"}
          </button>
          {overLimit && (
            <span style={{ color: "#a8071a", fontWeight: 600 }}>
              Уменьшите суммы: распределено больше, чем собрано.
            </span>
          )}
          {!overLimit && remainder > 0.005 && (
            <span style={{ color: "#874d00" }}>
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
