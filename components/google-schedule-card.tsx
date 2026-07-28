"use client";

import { useState } from "react";

type UnmatchedEmployee = {
  employee_name: string;
  shift_count: number;
};

type ScheduleResult = {
  ok: boolean;
  error?: string;

  year?: number;
  month?: number;
  source_sheet?: string;

  count?: number;
  leader_count?: number;
  unique_employee_count?: number;
  matched_shift_count?: number;
  unmatched_shift_count?: number;
  unmatched_employee_count?: number;
  unmatched_employees?: UnmatchedEmployee[];

  source_shift_count?: number;
  imported_shift_count?: number;
  imported_leader_count?: number;
  invalid_time_count?: number;
  missing_department_count?: number;
};

type GoogleScheduleCardProps = {
  initialYear: number;
  initialMonth: number;
};

async function requestSchedule(
  method: "GET" | "POST",
  year: number,
  month: number,
): Promise<ScheduleResult> {
  const response = await fetch(
    `/api/google-schedule?year=${year}&month=${month}`,
    {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    },
  );

  const result =
    (await response.json()) as ScheduleResult;

  if (!response.ok) {
    return {
      ok: false,
      error:
        result.error ??
        `Ошибка сервера: HTTP ${response.status}`,
    };
  }

  return result;
}

export function GoogleScheduleCard({
  initialYear,
  initialMonth,
}: GoogleScheduleCardProps) {
  const [year, setYear] =
    useState(initialYear);

  const [month, setMonth] =
    useState(initialMonth);

  const [result, setResult] =
    useState<ScheduleResult | null>(null);

  const [hasChecked, setHasChecked] =
    useState(false);

  const [action, setAction] =
    useState<"check" | "import" | null>(null);

  const isLoading = action !== null;

  const changeYear = (
    value: number,
  ) => {
    setYear(value);
    setHasChecked(false);
    setResult(null);
  };

  const changeMonth = (
    value: number,
  ) => {
    setMonth(value);
    setHasChecked(false);
    setResult(null);
  };

  const checkSchedule = async () => {
    setAction("check");
    setResult(null);

    try {
      const response = await requestSchedule(
        "GET",
        year,
        month,
      );

      setResult(response);
      setHasChecked(response.ok);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не удалось проверить график.",
      });

      setHasChecked(false);
    } finally {
      setAction(null);
    }
  };

  const importSchedule = async () => {
    const confirmed = window.confirm(
      [
        "Импортировать сопоставленные смены?",
        "",
        "Несопоставленные сотрудники будут пропущены.",
        "Повторный импорт обновит существующие смены и не создаст дубли.",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setAction("import");
    setResult(null);

    try {
      const response = await requestSchedule(
        "POST",
        year,
        month,
      );

      setResult(response);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не удалось импортировать график.",
      });
    } finally {
      setAction(null);
    }
  };

  const unmatchedEmployees =
    result?.unmatched_employees ?? [];

  const isImportResult =
    typeof result?.imported_shift_count ===
    "number";

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <h2>График Google</h2>
          <p>
            Проверка сопоставляет сотрудников,
            но ничего не записывает. Импорт
            сохраняет только найденных сотрудников.
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
        <label
          style={{
            display: "grid",
            gap: "6px",
          }}
        >
          <span className="muted">
            Месяц
          </span>

          <select
            value={month}
            disabled={isLoading}
            onChange={(event) =>
              changeMonth(
                Number(event.target.value),
              )
            }
            style={{
              minWidth: "170px",
              padding: "11px 12px",
              border: "1px solid #d7dce2",
              borderRadius: "10px",
              background: "white",
              font: "inherit",
            }}
          >
            <option value={1}>Январь</option>
            <option value={2}>Февраль</option>
            <option value={3}>Март</option>
            <option value={4}>Апрель</option>
            <option value={5}>Май</option>
            <option value={6}>Июнь</option>
            <option value={7}>Июль</option>
            <option value={8}>Август</option>
            <option value={9}>Сентябрь</option>
            <option value={10}>Октябрь</option>
            <option value={11}>Ноябрь</option>
            <option value={12}>Декабрь</option>
          </select>
        </label>

        <label
          style={{
            display: "grid",
            gap: "6px",
          }}
        >
          <span className="muted">
            Год
          </span>

          <input
            type="number"
            min={2020}
            max={2100}
            value={year}
            disabled={isLoading}
            onChange={(event) =>
              changeYear(
                Number(event.target.value),
              )
            }
            style={{
              width: "120px",
              padding: "11px 12px",
              border: "1px solid #d7dce2",
              borderRadius: "10px",
              background: "white",
              font: "inherit",
            }}
          />
        </label>

        <button
          type="button"
          onClick={checkSchedule}
          disabled={isLoading}
          style={{
            padding: "12px 18px",
            border: "1px solid #cfd5dc",
            borderRadius: "10px",
            background: "white",
            color: "#17202a",
            font: "inherit",
            fontWeight: 700,
            cursor: isLoading
              ? "not-allowed"
              : "pointer",
            opacity: isLoading ? 0.65 : 1,
          }}
        >
          {action === "check"
            ? "Проверяем…"
            : "Проверить график"}
        </button>

        <button
          type="button"
          onClick={importSchedule}
          disabled={
            isLoading ||
            !hasChecked
          }
          style={{
            padding: "12px 18px",
            border: 0,
            borderRadius: "10px",
            background:
              hasChecked && !isLoading
                ? "#1f6feb"
                : "#aeb8c4",
            color: "white",
            font: "inherit",
            fontWeight: 700,
            cursor:
              hasChecked && !isLoading
                ? "pointer"
                : "not-allowed",
          }}
        >
          {action === "import"
            ? "Импортируем…"
            : "Импортировать смены"}
        </button>
      </div>

      {!hasChecked && !result && (
        <p
          className="muted"
          style={{ marginTop: "14px" }}
        >
          Сначала нажмите «Проверить график».
        </p>
      )}

      {result && !result.ok && (
        <div
          style={{
            marginTop: "20px",
            padding: "14px 16px",
            borderRadius: "10px",
            background: "#fff1f0",
            color: "#a8071a",
          }}
        >
          <strong>Ошибка:</strong>{" "}
          {result.error ??
            "Неизвестная ошибка"}
        </div>
      )}

      {result?.ok && (
        <>
          <div
            className="metric-grid"
            style={{ marginTop: "22px" }}
          >
            <article className="metric-card">
              <span>
                {isImportResult
                  ? "Импортировано смен"
                  : "Смен в графике"}
              </span>

              <strong>
                {isImportResult
                  ? result.imported_shift_count
                  : result.count}
              </strong>

              <small>
                Вкладка:{" "}
                {result.source_sheet ??
                  "не указана"}
              </small>
            </article>

            <article className="metric-card">
              <span>
                {isImportResult
                  ? "Смен лидеров записано"
                  : "Смен лидеров"}
              </span>

              <strong>
                {isImportResult
                  ? result.imported_leader_count
                  : result.leader_count}
              </strong>

              <small>
                Зал — до 1 500 ₽, бар и
                кухня — до 1 000 ₽
              </small>
            </article>

            <article className="metric-card">
              <span>
                Несопоставленных смен
              </span>

              <strong>
                {result.unmatched_shift_count ??
                  0}
              </strong>

              <small>
                Сотрудников:{" "}
                {result.unmatched_employee_count ??
                  0}
              </small>
            </article>
          </div>

          {isImportResult && (
            <div
              style={{
                marginTop: "18px",
                padding: "14px 16px",
                borderRadius: "10px",
                background: "#edf8f0",
                color: "#176b35",
              }}
            >
              <strong>
                Импорт завершён.
              </strong>{" "}
              Записано смен:{" "}
              {result.imported_shift_count ??
                0}
              . Пропущено из-за времени:{" "}
              {result.invalid_time_count ??
                0}
              . Пропущено из-за
              подразделения:{" "}
              {result.missing_department_count ??
                0}
              .
            </div>
          )}

          {unmatchedEmployees.length >
            0 && (
            <div
              style={{
                marginTop: "22px",
              }}
            >
              <h3>
                Не найдены в базе
              </h3>

              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  marginTop: "10px",
                }}
              >
                {unmatchedEmployees.map(
                  (employee) => (
                    <div
                      key={
                        employee.employee_name
                      }
                      style={{
                        display: "flex",
                        justifyContent:
                          "space-between",
                        gap: "16px",
                        padding: "10px 12px",
                        border:
                          "1px solid #e2e6eb",
                        borderRadius: "9px",
                      }}
                    >
                      <span>
                        {
                          employee.employee_name
                        }
                      </span>

                      <strong>
                        {
                          employee.shift_count
                        }{" "}
                        смен
                      </strong>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}