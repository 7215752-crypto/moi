"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatShortDate } from "@/lib/format";

type Props = {
  from: string;
  to: string;
};

type RecalcResult = {
  ok: boolean;
  error?: string;
  imported_row_count?: number;
  created_employees?: string[];
  unmatched_employees?: Array<{ employee_name: string }>;
  unmatched_business_units?: string[];
};

export function RecalcButton({ from, to }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const run = async () => {
    const confirmed = window.confirm(
      [
        `Рассчитать зарплату за ${formatShortDate(from)} — ${formatShortDate(to)}?`,
        "",
        "Портал заберёт из iiko фактические явки и обновит часы за период.",
        "Отметки «выплачено» при этом не трогаются.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch(
        `/api/iiko-attendance?from=${from}&to=${to}`,
        { method: "POST", cache: "no-store" },
      );
      const result = (await response.json()) as RecalcResult;

      if (!response.ok || !result.ok) {
        setIsError(true);
        setMessage(result.error ?? `Ошибка сервера: HTTP ${response.status}`);
        return;
      }

      const parts = [`Явки из iiko обновлены: ${result.imported_row_count ?? 0} строк`];
      if (result.created_employees?.length) {
        parts.push(`создано сотрудников: ${result.created_employees.length}`);
      }
      if (result.unmatched_employees?.length) {
        parts.push(`не сопоставлено: ${result.unmatched_employees.length}`);
      }
      if (result.unmatched_business_units?.length) {
        parts.push(`нераспознанные рестораны: ${result.unmatched_business_units.join(", ")}`);
      }
      setMessage(parts.join(" · "));
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error ? error.message : "Не удалось выполнить расчёт.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="recalc-block">
      <button
        type="button"
        className="recalc-button"
        disabled={busy}
        onClick={run}
      >
        {busy ? "Считаем…" : "Рассчитать зарплату"}
      </button>
      {!message && (
        <p className="recalc-hint">обновит данные из iiko за период</p>
      )}
      {message && (
        <p className={`recalc-message ${isError ? "error" : ""}`}>{message}</p>
      )}
    </div>
  );
}
