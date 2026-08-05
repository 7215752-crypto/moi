"use client";

import { useRouter } from "next/navigation";

type Option = {
  value: string;
  label: string;
};

type Props = {
  // Имя query-параметра, которым управляет этот фильтр (cat, abc…).
  name: string;
  value: string;
  options: Option[];
  // Остальные параметры страницы — сохраняются при смене фильтра.
  baseParams: Record<string, string>;
};

// Выпадающий фильтр в шапке колонки таблицы: смена значения сразу
// перезагружает отчёт с новым параметром.
export function ColumnFilter({ name, value, options, baseParams }: Props) {
  const router = useRouter();

  return (
    <select
      className="th-filter"
      value={value}
      onChange={(event) => {
        const params = new URLSearchParams(baseParams);
        if (event.target.value) {
          params.set(name, event.target.value);
        } else {
          params.delete(name);
        }
        const queryString = params.toString();
        router.push(queryString ? `/analytics?${queryString}` : "/analytics");
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
