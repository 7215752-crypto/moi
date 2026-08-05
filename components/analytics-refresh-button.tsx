"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatShortDate } from "@/lib/format";

type Props = {
  from: string;
  to: string;
};

type RefreshResult = {
  ok: boolean;
  error?: string;
  imported_row_count?: number;
  product_warning?: string | null;
  unmatched_departments?: string[];
};

export function AnalyticsRefreshButton({ from, to }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const run = async () => {
    const confirmed = window.confirm(
      [
        `Обновить продажи из iiko за ${formatShortDate(from)} — ${formatShortDate(to)}?`,
        "",
        "Портал заберёт продажи по блюдам и модификаторам и пересоберёт отчёт.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch(`/api/dish-sales?from=${from}&to=${to}`, {
        method: "POST",
        cache: "no-store",
      });
      const result = (await response.json()) as RefreshResult;

      if (!response.ok || !result.ok) {
        setIsError(true);
        setMessage(result.error ?? `Ошибка сервера: HTTP ${response.status}`);
        return;
      }

      const parts = [`Продажи обновлены: ${result.imported_row_count ?? 0} строк`];
      if (result.unmatched_departments?.length) {
        parts.push(
          `нераспознанные точки iiko: ${result.unmatched_departments.join(", ")}`,
        );
      }
      if (result.product_warning) {
        parts.push(result.product_warning);
      }
      setMessage(parts.join(" · "));
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error ? error.message : "Не удалось обновить продажи.",
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
        {busy ? "Обновляем…" : "Обновить из iiko"}
      </button>
      {!message && (
        <p className="recalc-hint">заберёт продажи за выбранный период</p>
      )}
      {message && (
        <p className={`recalc-message ${isError ? "error" : ""}`}>{message}</p>
      )}
    </div>
  );
}
