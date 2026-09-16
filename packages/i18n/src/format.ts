import { DEFAULT_LOCALE, LOCALE_TAG, type Locale } from "./locales";

/**
 * Locale-aware formatting, in one place, because a number that changes its separator halfway down
 * a page is a number a reader stops trusting.
 *
 * `packages/ui/src/format.ts` used to hold these with `es-EC` baked in; they now take a locale and
 * that module re-exports the Spanish forms so nothing outside had to change at once. What a reader
 * sees differs by locale in exactly the ways it should: `7,4` against `7.4`, `28 ago 2026` against
 * `28 Aug 2026`.
 *
 * ## What is deliberately not localised
 *
 * An **abscissa** (`2+840`) is a surveying notation, not a number: it is written the same way on a
 * Spanish drawing and an English one, and "translating" it would produce something no engineer
 * recognises. It therefore stays in `@eia/domain`, beside the arithmetic that produces it, rather
 * than being copied here. A **parcel code**, an **EPSG code** and a **document code** are
 * identifiers.
 */
const tag = (locale: Locale): string => LOCALE_TAG[locale] ?? LOCALE_TAG[DEFAULT_LOCALE];

export function formatCount(locale: Locale, value: number): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 0 }).format(value);
}

export function formatDecimal(locale: Locale, value: number, digits = 1): string {
  return new Intl.NumberFormat(tag(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(locale: Locale, ratio: number, digits = 1): string {
  return `${formatDecimal(locale, ratio * 100, digits)}%`;
}

/**
 * A calendar date, parsed as UTC so it never shifts a day by timezone.
 *
 * `2026-09-20` → `20 sep 2026` / `20 Sep 2026`. Month names come from `Intl`, so a locale added
 * later gets them without a table here.
 */
export function formatIsoDate(locale: Locale, iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(tag(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatIsoDateShort(locale: Locale, iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(tag(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * A date and a time, in the shape the approved design uses: `17 sept 2026 · 14:02`.
 *
 * Assembled from the two formatters rather than taken from one, because `Intl`'s combined form
 * puts a comma where the design puts a middle dot — and because the clock is **24-hour in both
 * languages**. A field operations table that said `02:02 p. m.` would be asking a reader to work
 * out which half of the day a visit started in.
 */
export function formatDateTime(locale: Locale, date: Date): string {
  return `${formatIsoDate(locale, date.toISOString().slice(0, 10))} · ${formatTime(locale, date)}`;
}

export function formatTime(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(tag(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
}

/**
 * A file size a person can read. Binary units, because that is what an operating system reports
 * and a mismatch between the two is a support conversation nobody needs.
 */
export function formatBytes(locale: Locale, bytes: number): string {
  if (bytes < 1024) return `${formatCount(locale, bytes)} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatDecimal(locale, value, value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** The formatters of one locale, bound once. */
export interface Format {
  readonly locale: Locale;
  count(value: number): string;
  decimal(value: number, digits?: number): string;
  percent(ratio: number, digits?: number): string;
  isoDate(iso: string): string;
  isoDateShort(iso: string): string;
  dateTime(date: Date): string;
  time(date: Date): string;
  bytes(bytes: number): string;
}

/**
 * Bind every formatter to one locale.
 *
 * A surface resolves the locale once and passes this object down, so no component decides for
 * itself how a number reads — which is the same reason the translator exists rather than a
 * `locale === "en" ? … : …` in each file.
 */
export function createFormat(locale: Locale): Format {
  return {
    locale,
    count: (value) => formatCount(locale, value),
    decimal: (value, digits) => formatDecimal(locale, value, digits),
    percent: (ratio, digits) => formatPercent(locale, ratio, digits),
    isoDate: (iso) => formatIsoDate(locale, iso),
    isoDateShort: (iso) => formatIsoDateShort(locale, iso),
    dateTime: (date) => formatDateTime(locale, date),
    time: (date) => formatTime(locale, date),
    bytes: (value) => formatBytes(locale, value),
  };
}
