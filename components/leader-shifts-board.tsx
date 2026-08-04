"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ShiftRow = {
  id: string;
  date: string;
  employee_name: string;
  business_unit_name: string;
  role: string;
  maximum_bonus: number;
  approved: boolean;
  approved_amount: number | null;
};

type BoardData = {
  ok: boolean;
  error?: string;
  shifts?: ShiftRow[];
};

type Decision = { approved: boolean; amount: string };

const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(
    new Date(`${value}T00:00:00`),
  );

export function LeaderShiftsBoard({ periodId }: { periodId: string }) {
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/leader-shifts?period=${periodId}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as BoardData;
      if (!response.ok || !result.ok) {
        setError(result.error ?? `Ошибка сервера: HTTP ${response.status}`);
      } else {
        const rows = result.shifts ?? [];
        setShifts(rows);
        const initial: Record<string, Decision> = {};
        for (const row of rows) {
          initial[row.id] = {
            approved: row.approved,
            amount: String(row.approved_amount ?? row.maximum_bonus),
          };
        }
        setDecisions(initial);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить смены.",
      );
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    let approvedCount = 0;
    let approvedSum = 0;
    for (const row of shifts) {
      const decision = decisions[row.id];
      if (decision?.approved) {
        approvedCount += 1;
        const amount = Math.min(
          Number(decision.amount.replace(",", ".")) || 0,
          row.maximum_bonus,
        );
        approvedSum += amount;
      }
    }
    return { approvedCount, approvedSum: Math.round(approvedSum) };
  }, [shifts, decisions]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const payload = shifts.map((row) => {
        const decision = decisions[row.id];
        return {
          leader_shift_id: row.id,
          approved: decision?.approved ?? false,
          amount: Number((decision?.amount ?? "").replace(",", ".")) || 0,
        };
      });

      const response = await fetch("/api/leader-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: payload }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        approved?: number;
      };

      if (!response.ok || !result.ok) {
        setError(result.error ?? `Ошибка сервера: HTTP ${response.status}`);
      } else {
        setMessage(
          `Сохранено: подтверждено смен — ${result.approved}. Пересчитайте зарплату, чтобы суммы попали в расчёт.`,
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
    return <div className="empty-state">Загружаем смены лидеров…</div>;
  }

  if (error && shifts.length === 0) {
    return (
      <div className="notice error" style={{ marginTop: 0 }}>
        <strong>Ошибка:</strong> {error}
      </div>
    );
  }

  if (shifts.length === 0) {
    return (
      <div className="empty-state">
        В этом периоде нет шифт-лидерских смен (они приходят из графика
        Google при импорте смен).
      </div>
    );
  }

  const units = Array.from(new Set(shifts.map((row) => row.business_unit_name)));

  return (
    <>
      <section className="metric-grid" style={{ marginBottom: "22px" }}>
        <article className="metric-card">
          <span>Смен в периоде</span>
          <strong>{shifts.length}</strong>
          <small>зал — до 1 500 ₽, бар и кухня — до 1 000 ₽</small>
        </article>
        <article className="metric-card accent">
          <span>Подтверждено</span>
          <strong>
            {stats.approvedCount} из {shifts.length}
          </strong>
          <small>неподтверждённые не оплачиваются</small>
        </article>
        <article className="metric-card">
          <span>К начислению</span>
          <strong className="metric-money">{money(stats.approvedSum)}</strong>
          <small>по подтверждённым сменам</small>
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

      {units.map((unitName) => (
        <section
          className="content-card"
          key={unitName}
          style={{ marginBottom: "22px" }}
        >
          <div className="section-heading">
            <div>
              <h2>{unitName}</h2>
              <p>
                Галочка — смена подтверждена (по умолчанию на максимум,
                сумму можно уменьшить).
              </p>
            </div>
          </div>

          <div className="payroll-table-wrap" style={{ marginTop: "12px" }}>
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Подтв.</th>
                  <th>Дата</th>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th className="numeric">Максимум</th>
                  <th className="numeric">Сумма, ₽</th>
                </tr>
              </thead>
              <tbody>
                {shifts
                  .filter((row) => row.business_unit_name === unitName)
                  .map((row) => {
                    const decision = decisions[row.id] ?? {
                      approved: false,
                      amount: String(row.maximum_bonus),
                    };
                    return (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={decision.approved}
                            disabled={saving}
                            onChange={(event) =>
                              setDecisions((previous) => ({
                                ...previous,
                                [row.id]: {
                                  ...decision,
                                  approved: event.target.checked,
                                },
                              }))
                            }
                            style={{ width: "18px", height: "18px" }}
                          />
                        </td>
                        <td>{dateLabel(row.date)}</td>
                        <td>
                          <strong>{row.employee_name}</strong>
                        </td>
                        <td>{row.role}</td>
                        <td className="numeric">{row.maximum_bonus}</td>
                        <td className="numeric" style={{ width: "130px" }}>
                          <input
                            type="number"
                            min={0}
                            max={row.maximum_bonus}
                            step="50"
                            value={decision.amount}
                            disabled={saving || !decision.approved}
                            onChange={(event) =>
                              setDecisions((previous) => ({
                                ...previous,
                                [row.id]: {
                                  ...decision,
                                  amount: event.target.value,
                                },
                              }))
                            }
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              border: "1px solid var(--line, #d7dce2)",
                              borderRadius: "9px",
                              background: "inherit",
                              color: "inherit",
                              font: "inherit",
                              textAlign: "right",
                              opacity: decision.approved ? 1 : 0.5,
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <button
        type="button"
        className="action-button primary"
        onClick={save}
        disabled={saving}
        style={{ padding: "12px 22px" }}
      >
        {saving ? "Сохраняем…" : "Сохранить подтверждения"}
      </button>
    </>
  );
}
