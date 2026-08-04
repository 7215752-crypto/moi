"use client";

import { useState, useTransition } from "react";
import { markPaid, unmarkPaid } from "@/app/payroll/actions";
import { formatMoney, formatMoneyWhole } from "@/lib/format";

type PayoutInfo = {
  amount_paid: number | string;
  paid_by_name: string | null;
  paid_at: string;
};

type Props = {
  periodId: string;
  businessUnitId: string;
  employeeId: string;
  employeeName: string;
  currentAmount: number;
  payout: PayoutInfo | null;
  role: string;
};

export function PayoutCheckbox({
  periodId,
  businessUnitId,
  employeeId,
  employeeName,
  currentAmount,
  payout,
  role,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canMark = ["owner", "accountant", "manager"].includes(role);
  const canUnmark = role === "owner";

  if (payout) {
    const paidAmount = Number(payout.amount_paid);
    const diff = Math.round((currentAmount - paidAmount) * 100) / 100;
    const paidAt = new Date(payout.paid_at).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const unmark = () => {
      const confirmed = window.confirm(
        `Снять отметку «выплачено» — ${employeeName}?\n\nСтрока снова станет доступна для выплаты.`,
      );
      if (!confirmed) return;
      setError(null);
      startTransition(async () => {
        const result = await unmarkPaid({
          periodId,
          businessUnitId,
          employeeId,
        });
        if (!result.ok) setError(result.error ?? "Не получилось.");
      });
    };

    return (
      <div className="payout-state">
        <button
          type="button"
          className="payout-paid"
          disabled={isPending || !canUnmark}
          onClick={canUnmark ? unmark : undefined}
          title={
            `${formatMoney(paidAmount)} · отметил ${payout.paid_by_name ?? "—"} · ${paidAt}` +
            (canUnmark ? " · нажмите, чтобы откатить выплату" : "")
          }
        >
          {isPending ? "…" : "✓ Выплачено"}
        </button>
        {Math.round(diff) !== 0 && (
          <span
            className={`paid-diff ${diff > 0 ? "underpaid" : "overpaid"}`}
            title="После выплаты расчёт изменился"
          >
            {diff > 0
              ? `доплата ${formatMoneyWhole(diff)}`
              : `переплата ${formatMoneyWhole(-diff)}`}
          </span>
        )}
        {error && <span className="payout-error">{error}</span>}
      </div>
    );
  }

  if (!canMark || currentAmount <= 0) {
    return <span className="payout-empty">—</span>;
  }

  return (
    <div className="payout-state">
      <button
        type="button"
        className="payout-mark"
        disabled={isPending}
        onClick={() => {
          const confirmed = window.confirm(
            `Отметить выплату ${formatMoney(currentAmount)} — ${employeeName}?\n\nПосле отметки выдать этому сотруднику второй раз будет нельзя.`,
          );
          if (!confirmed) return;
          setError(null);
          startTransition(async () => {
            const result = await markPaid({
              periodId,
              businessUnitId,
              employeeId,
              amount: currentAmount,
            });
            if (!result.ok) setError(result.error ?? "Не получилось.");
          });
        }}
      >
        {isPending ? "…" : "Выплатить"}
      </button>
      {error && <span className="payout-error">{error}</span>}
    </div>
  );
}
