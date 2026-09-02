/**
 * es-EC formatting (PRODUCT.md §8): decimal comma, thousands without a separator for the small
 * counts this product shows, dates like `28 ago 2026`, abscissas like `2+840`.
 * Formatting is centralised so the approved copy is reproduced identically everywhere.
 */
const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

export function formatCount(value: number): string {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits: 0 }).format(value);
}

export function formatDecimal(value: number, digits = 1): string {
  return new Intl.NumberFormat("es-EC", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${formatDecimal(ratio * 100, digits)}%`;
}

/** `2026-09-20` → `20 sep 2026`. Parsed as UTC so a calendar date never shifts by timezone. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ES[m - 1]} ${y}`;
}

/** `2026-09-20` → `20 sep` (KPI cells and activity rows use the short form). */
export function formatIsoDateShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTHS_ES[m - 1]}`;
}

export function formatDateTime(date: Date): string {
  const iso = date.toISOString();
  const time = iso.slice(11, 16);
  return `${formatIsoDate(iso.slice(0, 10))} · ${time}`;
}

export function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

export function formatDayCount(days: number): string {
  return `${formatCount(Math.abs(days))} ${Math.abs(days) === 1 ? "día" : "días"}`;
}
