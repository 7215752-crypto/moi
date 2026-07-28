export function formatMoney(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function humanizeComponent(type: string) {
  const names: Record<string, string> = {
    hourly_pay: "Почасовая оплата",
    shift_pay: "Сменная оплата",
    monthly_pay: "Оклад",
    iiko_motivation: "Мотивация iiko",
    iiko_fixed_bonus: "Фиксированный бонус iiko",
    service_charge: "Сервисный сбор",
    purchase: "Покупки в зарплату",
    fine: "Депремирование",
    tg_bonus: "Премия",
    leader_kpi: "Шифт-лидерские и KPI",
    official_inventory: "Официальная часть / инвентаризация",
  };
  return names[type] ?? type;
}
