"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PayoutCheckbox } from "@/components/payout-checkbox";
import { formatAmountCell, formatMoneyWhole } from "@/lib/format";

export type PivotColumn = {
  key: string;
  label: string;
  source: string;
  hint: string;
};

export type PivotPayout = {
  amount_paid: number | string;
  paid_by_name: string | null;
  paid_at: string;
};

export type PivotRow = {
  employeeId: string;
  name: string;
  hours: number;
  leaderShifts: number;
  leaderMaxSum: number;
  components: Record<string, number>;
  total: number;
  payout: PivotPayout | null;
  rateLabel: string | null;
  hasRate: boolean;
};

export type PivotGroup = {
  id: string;
  name: string;
  version: number | null;
  rows: PivotRow[];
  columnTotals: Record<string, number>;
  hoursTotal: number;
  total: number;
  paidCount: number;
  paidSum: number;
  remaining: number;
  employeeCount: number;
};

type Props = {
  periodId: string;
  groups: PivotGroup[];
  columns: PivotColumn[];
  role: string;
};

type FilterMode = "all" | "unpaid" | "issues";
type SortState = { key: string; dir: 1 | -1 };

const COLUMNS_STORAGE_KEY = "moi-payroll-columns";

function formatHours(value: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function rowHasIssue(row: PivotRow): boolean {
  if (row.total < 0) return true;
  if (row.hours > 0 && !row.hasRate) return true;
  if (
    row.payout &&
    Math.round((row.total - Number(row.payout.amount_paid)) * 100) !== 0
  ) {
    return true;
  }
  return false;
}

export function PayrollTables({ periodId, groups, columns, role }: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<FilterMode>("all");
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: 1 });

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(COLUMNS_STORAGE_KEY) ?? "[]",
      );
      if (Array.isArray(saved)) {
        setHidden(saved.filter((key) => typeof key === "string"));
      }
    } catch {
      // повреждённое значение в localStorage просто игнорируем
    }
  }, []);

  const toggleColumn = (key: string) => {
    setHidden((previous) => {
      const next = previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key];
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const visibleColumns = columns.filter(
    (column) => !hidden.includes(column.key),
  );
  const showHours = !hidden.includes("hours");

  const handleSort = (key: string) => {
    setSort((previous) =>
      previous.key === key
        ? { key, dir: previous.dir === 1 ? -1 : 1 }
        : { key, dir: key === "name" ? 1 : -1 },
    );
  };

  const sortArrow = (key: string) =>
    sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  const isFiltering = query.trim() !== "" || mode !== "all";

  const preparedGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return groups
      .map((group) => {
        let rows = group.rows;
        if (normalizedQuery) {
          rows = rows.filter((row) =>
            row.name.toLowerCase().includes(normalizedQuery),
          );
        }
        if (mode === "unpaid") {
          rows = rows.filter((row) => !row.payout && row.total > 0);
        }
        if (mode === "issues") {
          rows = rows.filter(rowHasIssue);
        }

        const sorted = [...rows].sort((a, b) => {
          if (sort.key === "name") {
            return sort.dir * a.name.localeCompare(b.name, "ru");
          }
          const valueOf = (row: PivotRow) =>
            sort.key === "hours"
              ? row.hours
              : sort.key === "total"
                ? row.total
                : (row.components[sort.key] ?? 0);
          return sort.dir * (valueOf(a) - valueOf(b));
        });

        return { ...group, rows: sorted };
      })
      .filter((group) => group.rows.length > 0 || !isFiltering);
  }, [groups, query, mode, sort, isFiltering]);

  return (
    <>
      <div className="table-toolbar">
        <input
          type="search"
          className="form-input table-search"
          placeholder="Поиск по фамилии…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="chip-row" role="group" aria-label="Фильтр строк">
          <button
            type="button"
            className={`chip ${mode === "all" ? "active" : ""}`}
            onClick={() => setMode("all")}
          >
            Все
          </button>
          <button
            type="button"
            className={`chip ${mode === "unpaid" ? "active" : ""}`}
            onClick={() => setMode("unpaid")}
          >
            Не выплачено
          </button>
          <button
            type="button"
            className={`chip ${mode === "issues" ? "active" : ""}`}
            onClick={() => setMode("issues")}
          >
            Проблемы
          </button>
        </div>

        <details className="columns-picker">
          <summary>Колонки</summary>
          <div className="columns-menu">
            <label>
              <input
                type="checkbox"
                checked={showHours}
                onChange={() => toggleColumn("hours")}
              />
              Часы
            </label>
            {columns.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(column.key)}
                  onChange={() => toggleColumn(column.key)}
                />
                {column.label}
              </label>
            ))}
          </div>
        </details>
      </div>

      {preparedGroups.length === 0 ? (
        <div className="empty-state">
          Никого не нашли — поменяйте поиск или фильтр.
        </div>
      ) : (
        <div className="unit-groups">
          {preparedGroups.map((group) => (
            <section className="unit-section" key={group.id}>
              <div className="unit-heading">
                <div>
                  <h3>{group.name}</h3>
                  <span>
                    версия {group.version ?? "—"} · выплачено {group.paidCount}{" "}
                    из {group.employeeCount}
                    {group.remaining > 0 &&
                      ` · осталось ${formatMoneyWhole(group.remaining)}`}
                  </span>
                </div>
                <strong>{formatMoneyWhole(group.total)}</strong>
              </div>
              <div className="payroll-table-wrap scrollable">
                <table className="payroll-table pivot">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="th-sort"
                          onClick={() => handleSort("name")}
                          title="Сортировать по фамилии"
                        >
                          <span className="th-label">
                            Сотрудник{sortArrow("name")}
                          </span>
                          <span className="th-source">и его ставка</span>
                        </button>
                      </th>
                      {showHours && (
                        <th className="numeric">
                          <button
                            type="button"
                            className="th-sort"
                            onClick={() => handleSort("hours")}
                            title="Фактически отработанные часы из явок iiko"
                          >
                            <span className="th-label">
                              Часы{sortArrow("hours")}
                            </span>
                            <span className="th-source">явки iiko</span>
                          </button>
                        </th>
                      )}
                      {visibleColumns.map((column) => (
                        <th className="numeric" key={column.key}>
                          <button
                            type="button"
                            className="th-sort"
                            onClick={() => handleSort(column.key)}
                            title={column.hint}
                          >
                            <span className="th-label">
                              {column.label}
                              {sortArrow(column.key)}
                            </span>
                            <span className="th-source">{column.source}</span>
                          </button>
                        </th>
                      ))}
                      <th className="numeric">
                        <button
                          type="button"
                          className="th-sort"
                          onClick={() => handleSort("total")}
                          title="Сумма всех начислений и удержаний"
                        >
                          <span className="th-label">
                            К выдаче{sortArrow("total")}
                          </span>
                          <span className="th-source">итог, ₽</span>
                        </button>
                      </th>
                      <th title="Отметка о выдаче денег — защита от двойной выплаты">
                        <span className="th-label">Выплата</span>
                        <span className="th-source">отметка</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr
                        key={row.employeeId}
                        className={row.total < 0 ? "problem-row" : undefined}
                      >
                        <td>
                          {group.version ? (
                            <Link
                              className="employee-link"
                              href={`/payroll/${periodId}/employee/${row.employeeId}?unit=${group.id}&version=${group.version}`}
                            >
                              <strong>{row.name}</strong>
                            </Link>
                          ) : (
                            <strong>{row.name}</strong>
                          )}
                          {row.rateLabel && (
                            <small className="rate-hint">{row.rateLabel}</small>
                          )}
                        </td>
                        {showHours && (
                          <td className="numeric">
                            {row.hours > 0 ? formatHours(row.hours) : ""}
                          </td>
                        )}
                        {visibleColumns.map((column) => {
                          const value = Math.round(
                            row.components[column.key] ?? 0,
                          );
                          const isBase = column.key === "base";
                          const isLeader = column.key === "leader";
                          return (
                            <td
                              className={`numeric ${value < 0 ? "neg" : ""}`}
                              key={column.key}
                            >
                              {value !== 0
                                ? formatAmountCell(value)
                                : isBase && row.hours > 0 && !row.hasRate
                                  ? (
                                      <span className="warn-badge">
                                        нет ставки
                                      </span>
                                    )
                                  : isLeader && row.leaderShifts > 0
                                    ? (
                                        <span
                                          className="dim"
                                          title="Смены шифт-лидера по графику и максимум бонуса (без начислений)"
                                        >
                                          {row.leaderShifts}{" "}
                                          {row.leaderShifts === 1
                                            ? "смена"
                                            : row.leaderShifts < 5
                                              ? "смены"
                                              : "смен"}
                                          {row.leaderMaxSum > 0
                                            ? ` · ${formatMoneyWhole(row.leaderMaxSum)}`
                                            : ""}
                                        </span>
                                      )
                                    : ""}
                            </td>
                          );
                        })}
                        <td
                          className={`numeric total-cell ${row.total < 0 ? "neg" : ""}`}
                        >
                          {formatAmountCell(Math.round(row.total))}
                        </td>
                        <td className="payout-cell">
                          <PayoutCheckbox
                            periodId={periodId}
                            businessUnitId={group.id}
                            employeeId={row.employeeId}
                            employeeName={row.name}
                            currentAmount={row.total}
                            payout={row.payout}
                            role={role}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {!isFiltering && (
                    <tfoot>
                      <tr>
                        <td>Итого</td>
                        {showHours && (
                          <td className="numeric">
                            {formatHours(group.hoursTotal)}
                          </td>
                        )}
                        {visibleColumns.map((column) => {
                          const value = Math.round(
                            group.columnTotals[column.key] ?? 0,
                          );
                          return (
                            <td
                              className={`numeric ${value < 0 ? "neg" : ""}`}
                              key={column.key}
                            >
                              {value !== 0 ? formatAmountCell(value) : ""}
                            </td>
                          );
                        })}
                        <td className="numeric total-cell">
                          {formatAmountCell(Math.round(group.total))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
