export const FY_START_MONTH = 4;

export type DateRange = { start: string; end: string };

export function dateKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.slice(0, 10);
}

export function financialYearLabel(dateStr: string, startMonth = FY_START_MONTH) {
  const key = dateKey(dateStr);
  if (!key) return "";
  const [year, month] = key.split("-").map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  const endSuffix = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endSuffix}`;
}

export function financialYearRange(label: string, startMonth = FY_START_MONTH): DateRange {
  const startYear = Number(label.split("-")[0]);
  const endYear = startYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYearActual = startMonth === 1 ? startYear : endYear;
  const lastDay = new Date(endYearActual, endMonth, 0).getDate();
  return {
    start: `${startYear}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${endYearActual}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function monthRange(yearMonth: string): DateRange {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function monthsBetween(start: string, end: string) {
  const items: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    items.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return items;
}

export function discoverFinancialYears(dates: string[], startMonth = FY_START_MONTH) {
  const labels = new Set<string>();
  for (const date of dates) {
    const label = financialYearLabel(date, startMonth);
    if (label) labels.add(label);
  }
  return Array.from(labels).sort((a, b) => b.localeCompare(a));
}

export function discoverMonths(dates: string[]) {
  const labels = new Set<string>();
  for (const date of dates) {
    const key = dateKey(date);
    if (key.length >= 7) labels.add(key.slice(0, 7));
  }
  return Array.from(labels).sort((a, b) => b.localeCompare(a));
}

export function resolvePeriodRange(financialYear: string, month: string, startMonth = FY_START_MONTH): DateRange | null {
  if (financialYear === "all" && month === "all") return null;
  if (financialYear !== "all" && month === "all") return financialYearRange(financialYear, startMonth);
  if (month !== "all") return monthRange(month);
  return null;
}

export function isDateInRange(dateValue: unknown, range: DateRange | null) {
  if (!range) return true;
  const key = dateKey(dateValue);
  if (!key) return false;
  return key >= range.start && key <= range.end;
}

export function formatMonthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function formatPeriodLabel(financialYear: string, month: string) {
  if (financialYear === "all" && month === "all") return "All periods";
  if (financialYear !== "all" && month === "all") return `FY ${financialYear}`;
  if (month !== "all") return formatMonthLabel(month);
  return "All periods";
}

export function exportFileStem(bookTitle: string, financialYear: string, month: string) {
  const safe = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const period = month !== "all" ? month : financialYear !== "all" ? `fy-${financialYear}` : "all-periods";
  return `${safe}-${period}`;
}
