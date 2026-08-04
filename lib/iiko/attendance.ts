export type IikoEmployee = {
  id: string;
  name: string;
};

export type IikoAttendance = {
  id: string;
  employeeId: string;
  dateFrom: string;
  dateTo: string;
  attendanceType: string;
  departmentName: string;
};

// XML экранирует спецсимволы: «&» приходит как «&amp;» и т.п.
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function extractBlocks(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g")) ?? [];
}

export function parseEmployeesXml(xml: string): IikoEmployee[] {
  const employees: IikoEmployee[] = [];

  for (const block of extractBlocks(xml, "employee")) {
    const id = extractTag(block, "id");
    const name =
      extractTag(block, "name") ||
      [extractTag(block, "lastName"), extractTag(block, "firstName")]
        .filter(Boolean)
        .join(" ");

    if (id && name) {
      employees.push({ id, name });
    }
  }

  return employees;
}

export function parseAttendanceXml(xml: string): IikoAttendance[] {
  const attendances: IikoAttendance[] = [];

  for (const block of extractBlocks(xml, "attendance")) {
    const id = extractTag(block, "id");
    const employeeId = extractTag(block, "employeeId");
    const dateFrom = extractTag(block, "dateFrom");
    const dateTo = extractTag(block, "dateTo");

    if (!id || !employeeId || !dateFrom || !dateTo) {
      continue;
    }

    attendances.push({
      id,
      employeeId,
      dateFrom,
      dateTo,
      attendanceType: extractTag(block, "attendanceType"),
      departmentName: extractTag(block, "departmentName"),
    });
  }

  return attendances;
}

export function normalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

// Ключ, не зависящий от порядка слов: «Сафронов Максим» = «Максим Сафронов».
export function nameMatchKey(value: string | null | undefined): string {
  return normalizeName(value).split(" ").sort().join(" ");
}

export function attendanceHours(record: IikoAttendance): number {
  const from = new Date(record.dateFrom).getTime();
  const to = new Date(record.dateTo).getTime();

  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return 0;
  }

  return Math.round(((to - from) / 3_600_000) * 10000) / 10000;
}

// Дата смены = локальная дата начала явки (ночная смена относится ко дню начала).
export function attendanceWorkDate(record: IikoAttendance): string {
  return record.dateFrom.substring(0, 10);
}
