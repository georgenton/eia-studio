import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { type ReportSection, type ReportSnapshot } from "./snapshot";

/**
 * The optional half: a paragraph per section, written from the snapshot and from nothing else.
 *
 * ## What the generator is given, and why that is the whole safeguard
 *
 * It receives the **snapshot** — the already-computed figures, their labels and their bases — not
 * the database, not the documents, not the responses. It cannot therefore introduce a number that
 * was not computed, because it never sees anything a number could be computed from. That is a
 * stronger guarantee than instructing it not to, and it is why the prompt can be short.
 *
 * ## What is validated on the way back
 *
 * **Every figure in the prose must appear in the section's facts.** A paragraph containing a number
 * the snapshot does not contain is refused, not corrected: correcting it would leave a sentence
 * whose other clauses nobody checked. This is the report-shaped version of ADR-021's rule that an
 * answer may cite only what was retrieved.
 */
export const REPORT_PROMPT_VERSION = "social-chapter@1";

export const narrativeOutputSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            key: z.string().min(1).max(60),
            /** One paragraph. A chapter section, not an essay. */
            narrative: z.string().trim().min(1).max(1800),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type NarrativeOutput = z.infer<typeof narrativeOutputSchema>;

export interface NarrativeGenerator {
  readonly kind: string;
  generate(input: {
    readonly snapshot: ReportSnapshot;
    readonly model: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<NarrativeOutput>;
}

/** Digits as a reader sees them: `1.234`, `70`, `12,5`, `100 %`. */
const NUMBER = /\d[\d.,]*/g;

function numbersIn(text: string): ReadonlySet<string> {
  // Normalised to bare digits so `70` matches `70` however it was punctuated around.
  return new Set(
    (text.match(NUMBER) ?? []).map((token) => token.replace(/[.,](?=\D|$)/g, "")).filter(Boolean),
  );
}

/**
 * Refuse a paragraph that states a figure the section did not compute.
 *
 * The comparison is over digit sequences rather than semantics, which is crude and deliberately so:
 * it cannot judge whether a sentence is *right*, only whether every number in it came from
 * somewhere. That is the check worth having, because an invented number in a chapter is the failure
 * that survives review.
 */
export function assertNarrativeGrounded(section: ReportSection, narrative: string): void {
  const allowed = new Set<string>();
  for (const fact of section.facts) {
    for (const token of numbersIn(fact.value)) allowed.add(token);
    if (fact.basis) for (const token of numbersIn(fact.basis)) allowed.add(token);
    for (const token of numbersIn(fact.label)) allowed.add(token);
  }
  // The section's own summary is product copy, so its numbers are ours too.
  for (const token of numbersIn(section.summary)) allowed.add(token);

  for (const token of numbersIn(narrative)) {
    if (!allowed.has(token)) {
      throw new InvalidInput(
        `report_narrative_ungrounded: the paragraph for "${section.key}" states ${token}, which ` +
          "this section did not compute. A figure that is not in the snapshot is refused rather " +
          "than corrected: correcting it would leave the rest of the sentence unchecked.",
      );
    }
  }
}

/** Attach validated narratives to a snapshot's sections, refusing anything ungrounded. */
export function applyNarratives(
  snapshot: ReportSnapshot,
  raw: unknown,
): ReadonlyMap<string, string> {
  const parsed = narrativeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidInput(
      `the narrative generator returned something the schema refuses: ${parsed.error.issues
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", ")}`,
    );
  }
  const byKey = new Map(snapshot.sections.map((section) => [section.key, section]));
  const narratives = new Map<string, string>();
  for (const entry of parsed.data.sections) {
    const section = byKey.get(entry.key);
    if (!section) {
      throw new InvalidInput(
        `report_narrative_unknown_section: the generator wrote a paragraph for "${entry.key}", ` +
          "which is not a section of this report.",
      );
    }
    assertNarrativeGrounded(section, entry.narrative);
    narratives.set(entry.key, entry.narrative);
  }
  return narratives;
}
