import { z } from "zod";

/**
 * The management plan the study proposes (ADR-024).
 *
 * Everything here describes a **document**, not an execution. There is no compliance state, no
 * evidence and no obligation: this chapter proposes measures for a road that has not been built,
 * and a type that could hold "cumplida" would invite the claim.
 *
 * The nine fields are the nine columns of the delivered matrix. They are all optional strings
 * because the point of reading them is to find out which are missing.
 */
export const pgasMeasureSchema = z
  .object({
    /** The document's own `N°`, verbatim. Not a key: it repeats, skips, and is sometimes blank. */
    statedNumber: z.string(),
    programmeTitle: z.string().nullable(),
    programmeOrdinal: z.number().int().min(0),
    aspect: z.string(),
    impact: z.string(),
    measure: z.string(),
    indicator: z.string(),
    verification: z.string(),
    responsible: z.string(),
    frequency: z.string(),
    deadline: z.string(),
  })
  .strict();
export type PgasMeasure = z.infer<typeof pgasMeasureSchema>;

export const pgasPlanSchema = z
  .object({
    title: z.string().min(1),
    /** Null where the document gives none — one of the nine plans has no code. */
    code: z.string().nullable(),
    objective: z.string().nullable(),
    place: z.string().nullable(),
    /** The column names *this* plan used, so a naming inconsistency can name both sides. */
    columns: z.array(z.string().min(1)).min(8),
    measures: z.array(pgasMeasureSchema),
  })
  .strict();
export type PgasPlan = z.infer<typeof pgasPlanSchema>;

export const pgasChapterSchema = z
  .object({
    /** A note for whoever opens the fixture; the importer ignores it. */
    $comment: z.string().optional(),
    source: z
      .object({
        file: z.string().min(1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        bytes: z.number().int().positive(),
        receivedAt: z.string().min(1),
      })
      .strict(),
    plans: z.array(pgasPlanSchema).min(1),
  })
  .strict();
export type PgasChapter = z.infer<typeof pgasChapterSchema>;

/**
 * A slug for a plan that has no code, so the minted measure code still reads as something.
 *
 * `PLAN DE SEGURIDAD INDUSTRIAL Y SALUD OCUPACIONAL` → `PSISO`: the initials of the words that
 * carry meaning. It is stable for a given title, which is all a derived identifier needs to be.
 */
export function planSlug(title: string): string {
  const skip = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "E", "EN", "AL", "A"]);
  const initials = title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !skip.has(word) && !/^\d+$/.test(word))
    .map((word) => word[0])
    .join("");
  return initials.slice(0, 8) || "PLAN";
}

/**
 * The identifier this product mints, because the document has none (ADR-024 §3).
 *
 * Plan code (or slug) · programme ordinal · row ordinal — `PPMI-01.02.04`. Deterministic, so a
 * re-import of the same chapter produces the same codes and a link made last month still resolves.
 *
 * It is **ours**, not the consultancy's, and the surface says so. The document's own `N°` is shown
 * beside it, unchanged, including where two measures state the same one.
 */
export function measureCode(input: {
  readonly planCode: string | null;
  readonly planTitle: string;
  readonly programmeOrdinal: number;
  readonly ordinal: number;
}): string {
  const plan = input.planCode ?? planSlug(input.planTitle);
  const programme = String(input.programmeOrdinal).padStart(2, "0");
  const row = String(input.ordinal).padStart(2, "0");
  return `${plan}.${programme}.${row}`;
}

/** The five fields whose absence a reader would want counted. */
export const MEASURE_REQUIRED_FIELDS = [
  "indicator",
  "verification",
  "responsible",
  "frequency",
  "deadline",
] as const;
export type MeasureRequiredField = (typeof MEASURE_REQUIRED_FIELDS)[number];

export interface PlanCompleteness {
  readonly measures: number;
  /** How many measures leave each field empty. Absence is counted, never called a deficiency. */
  readonly missing: Readonly<Record<MeasureRequiredField, number>>;
  /** Measures missing at least one of the five. */
  readonly incompleteMeasures: number;
  readonly hasCode: boolean;
}

/**
 * What a plan states and what it leaves blank.
 *
 * Counting, not judging. The delivered chapter fills every one of these on all 86 measures, so the
 * honest result today is a row of zeros — and a panel that reports zeros truthfully is what makes
 * the same panel believable when a future revision does not.
 */
export function planCompleteness(plan: PgasPlan): PlanCompleteness {
  const missing = Object.fromEntries(MEASURE_REQUIRED_FIELDS.map((f) => [f, 0])) as Record<
    MeasureRequiredField,
    number
  >;
  let incomplete = 0;
  for (const measure of plan.measures) {
    let any = false;
    for (const field of MEASURE_REQUIRED_FIELDS) {
      if (measure[field].trim() === "") {
        missing[field] += 1;
        any = true;
      }
    }
    if (any) incomplete += 1;
  }
  return {
    measures: plan.measures.length,
    missing,
    incompleteMeasures: incomplete,
    hasCode: plan.code !== null && plan.code.trim() !== "",
  };
}

/**
 * Column headings, compared across plans.
 *
 * The delivered chapter names the same nine concepts four different ways — `FRENCUENCIA` in most
 * plans, `FRECUENCIA` in one, `RESPONSAB LE` where Word split a word, and a whole different set in
 * the ninth. Returned as the distinct spellings *per position*, so a finding can name both sides
 * rather than saying "the headings differ".
 */
export function headingVariants(
  plans: ReadonlyArray<PgasPlan>,
): ReadonlyArray<{ position: number; spellings: ReadonlyArray<string> }> {
  const width = Math.max(0, ...plans.map((p) => p.columns.length));
  const out: Array<{ position: number; spellings: string[] }> = [];
  for (let i = 0; i < width; i += 1) {
    const spellings = [...new Set(plans.map((p) => p.columns[i]).filter((c): c is string => !!c))];
    if (spellings.length > 1) out.push({ position: i, spellings });
  }
  return out;
}

/**
 * Numbers the document states more than once.
 *
 * `N°` runs 1–68 across the chapter, skips 11–33 and repeats 1–9 and 37 — because some plans
 * restart their numbering and others continue it. Two measures wearing one number is a real
 * inconsistency between two places in one document, which is exactly what a Quality Gate finding
 * is for.
 */
export function repeatedStatedNumbers(
  plans: ReadonlyArray<PgasPlan>,
): ReadonlyArray<{ statedNumber: string; occurrences: ReadonlyArray<string> }> {
  const seen = new Map<string, string[]>();
  for (const plan of plans) {
    for (const measure of plan.measures) {
      const n = measure.statedNumber.trim();
      if (n === "") continue;
      const where = plan.code ?? planSlug(plan.title);
      const list = seen.get(n) ?? [];
      list.push(where);
      seen.set(n, list);
    }
  }
  return [...seen.entries()]
    .filter(([, where]) => where.length > 1)
    .map(([statedNumber, occurrences]) => ({ statedNumber, occurrences }))
    .sort((a, b) => a.statedNumber.localeCompare(b.statedNumber, "es", { numeric: true }));
}
