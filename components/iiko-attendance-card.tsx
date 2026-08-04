"use client";

import { useState } from "react";

type SummaryRow = {
  employee_name: string;
  business_unit_name: string;
  department_name: string | null;
  total_hours: number;
  has_rate: boolean;
};

type UnmatchedEmployee = {
  employee_name: string;
  total_hours: number;
};

type AttendanceResult = {
  ok: boolean;
  error?: string;

  source_record_count?: number;
  row_count?: number;
  imported_row_count?: number;
  created_employees?: string[];
  new_alias_count?: number;
  type_breakdown?: Record<string, number>;
  unmatched_business_units?: string[];
  unmatched_employees?: UnmatchedEmployee[];
  summary?: SummaryRow[];
};

type IikoAttendanceCardProps = {
  initialFrom: string;
  initialTo: string;
};

async function requestAttendance(
  method: "GET" | "POST",
  from: string,
  to: string,
): Promise<AttendanceResult> {
  const response = await fetch(
    `/api/iiko-attendance?from=${from}&to=${to}`,
    { method, cache: "no-store", headers: { Accept: "application/json" } },
  );

  const result = (await response.json()) as AttendanceResult;

  if (!response.ok) {
    return {
      ok: false,
      error: result.error ?? `Ошибка сервера: HTTP ${response.status}`,
    };
  }

  return result;
}

export function IikoAttendanceCard({
  initialFrom,
  initialTo,
}: IikoAttendanceCardProps) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [action, setAction] = useState<"check" | "import" | null>(null);

  const isLoading = action !== null;

  const changeFrom = (value: string) => {
    setFrom(value);
    setHasChecked(false);
    setResult(null);
  };

  const changeTo = (value: string) => {
    setTo(value);
    setHasChecked(false);
    setResult(null);
  };

  const checkAttendance = async () => {
    setAction("check");
    setResult(null);
    try {
      const response = await requestAttendance("GET", from, to);
      setResult(response);
      setHasChecked(response.ok);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не удалось проверить явки.",
      });
      setHasChecked(false);
    } finally {
      setAction(null);
    }
  };

  const importAttendance = async () => {
    const confirmed = window.confirm(
      [
        `Импортировать явки iiko за ${from} — ${to}?`,
        "",
        "Расчётный период будет создан автоматически, если его ещё нет.",
        "Сотрудники, которых нет в портале, будут созданы автоматически.",
        "Повторный импорт заменит ранее загруженные явки iiko за этот период.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setAction("import");
    setResult(null);
    try {
      const response = await requestAttendance("POST", from, to);
      setResult(response);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не удалось импортировать явки.",
      });
    } finally {
      setAction(null);
    }
  };

  const isImportResult = typeof result?.imported_row_count === "number";
  const summary = result?.summary ?? [];
  const unmatchedEmployees = result?.unmatched_employees ?? [];
  const withoutRate = summary.filter((row) => !row.has_rate);

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <h2>Явки из iiko</h2>
          <p>
            Фактически отработанные часы сотрудников с сервера iiko.
            Проверка ничего не записывает, импорт создаёт период и
            сохраняет часы для расчёта.
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
            className="form-input"
            value={from}
            disabled={isLoading}
            onChange={(event) => changeFrom(event.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: "6px" }}>
          <span className="muted">По дату</span>
          <input
            type="date"
            className="form-input"
            value={to}
            disabled={isLoading}
            onChange={(event) => changeTo(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="action-button"
          onClick={checkAttendance}
          disabled={isLoading}
        >
          {action === "check" ? "Проверяем…" : "Проверить явки"}
        </button>

        <button
          type="button"
          className="action-button primary"
          onClick={importAttendance}
          disabled={isLoading || !hasChecked}
        >
          {action === "import" ? "Импортируем…" : "Импортировать явки"}
        </button>
      </div>

      {!hasChecked && !result && (
        <p className="muted" style={{ marginTop: "14px" }}>
          Сначала нажмите «Проверить явки».
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
            <article className="metric-card">
              <span>
                {isImportResult ? "Импортировано строк" : "Строк к импорту"}
              </span>
              <strong>
                {isImportResult
                  ? result.imported_row_count
                  : result.row_count}
              </strong>
              <small>
                Записей в iiko: {result.source_record_count ?? "—"}
              </small>
            </article>

            <article className="metric-card">
              <span>Сотрудники без сопоставления</span>
              <strong>{unmatchedEmployees.length}</strong>
              <small>Будут созданы автоматически при импорте</small>
            </article>

            <article className="metric-card">
              <span>Без ставки</span>
              <strong>{withoutRate.length}</strong>
              <small>Есть часы, но нет ставки — начислений не будет</small>
            </article>
          </div>

          {isImportResult && (
            <div className="notice success">
              <strong>Импорт завершён.</strong> Часы записаны, можно
              переходить к расчёту периода.
              {(result.created_employees?.length ?? 0) > 0 && (
                <>
                  {" "}
                  Созданы сотрудники:{" "}
                  {result.created_employees?.join(", ")}. Не забудьте
                  указать им ставки.
                </>
              )}
            </div>
          )}

          {(result.unmatched_business_units?.length ?? 0) > 0 && (
            <div className="notice warn">
              <strong>Нераспознанные подразделения iiko:</strong>{" "}
              {result.unmatched_business_units?.join(", ")} — часы по ним
              пропущены, сообщите разработчику.
            </div>
          )}

          {summary.length > 0 && (
            <div style={{ marginTop: "22px" }}>
              <h3>Часы по сотрудникам</h3>
              <div className="payroll-table-wrap" style={{ marginTop: "10px" }}>
                <table className="payroll-table">
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Ресторан</th>
                      <th>Подразделение</th>
                      <th className="numeric">Часы</th>
                      <th>Ставка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => (
                      <tr
                        key={`${row.employee_name}-${row.business_unit_name}`}
                      >
                        <td>{row.employee_name}</td>
                        <td>{row.business_unit_name}</td>
                        <td>{row.department_name ?? "—"}</td>
                        <td className="numeric">{row.total_hours}</td>
                        <td>{row.has_rate ? "есть" : "НЕТ"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {unmatchedEmployees.length > 0 && (
            <div style={{ marginTop: "22px" }}>
              <h3>Не найдены в базе портала</h3>
              <div style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
                {unmatchedEmployees.map((employee) => (
                  <div key={employee.employee_name} className="plain-row">
                    <span>{employee.employee_name}</span>
                    <strong>{employee.total_hours} ч</strong>
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
