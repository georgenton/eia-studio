import { z } from "zod";

import { provenanceFacetsSchema, type ProvenanceFacets } from "./facets";

/**
 * Human validation state of a provenance-bearing value (design v0.2, drawer field
 * `HUMAN VALIDATION`). It describes the *record*, never a compliance judgement.
 */
export const VALIDATION_STATES = [
  "VALIDATED",
  "PARTIAL",
  "PENDING",
  "NOT_REQUIRED",
  "SPECIALIST_REQUIRED",
] as const;
export const validationStateSchema = z.enum(VALIDATION_STATES);
export type ValidationState = z.infer<typeof validationStateSchema>;

/**
 * A stored provenance record. Canonical provenance is faceted (ADR-005, D-013): there is no
 * single `source_type` column anywhere. The four v0.2 SOURCE TYPE badges are derived in
 * `@eia/ui` from these facets at render time.
 *
 * `sourceLabel` / `sourceReference` describe where the value came from in the real world. They
 * are deliberately free text rather than a foreign key: until the Documents module ingests the
 * project corpus there is no document row to point at, and inventing a locator would manufacture
 * traceability (PROVENANCE.md).
 */
export const provenanceRecordSchema = z
  .object({
    id: z.uuid(),
    facets: provenanceFacetsSchema,
    /** Short title shown in the drawer header. */
    title: z.string().min(1),
    /** Contextual note explaining what the facets mean for this value. */
    note: z.string().min(1),
    sourceLabel: z.string().min(1).nullable(),
    sourceReference: z.string().min(1).nullable(),
    sourceVersion: z.string().min(1).nullable(),
    /** Formula or criterion; only meaningful for derived values. */
    method: z.string().min(1).nullable(),
    capturedAt: z.date().nullable(),
    recordedAt: z.date(),
    validationState: validationStateSchema,
    validationNote: z.string().min(1).nullable(),
  })
  .strict();

export type ProvenanceRecord = z.infer<typeof provenanceRecordSchema>;

/** Read model handed to the drawer: the record plus the lineage it was derived from. */
export interface ProvenanceView extends ProvenanceRecord {
  readonly inputs: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly facets: ProvenanceFacets;
  }>;
}

/**
 * The drawer's words live in `@eia/i18n` under `vocabulary.*`, keyed by these same enum values.
 *
 * They used to be Spanish constants here. A domain that holds one language's copy can only ever
 * have one language, and the rule is older than the second one: *a stored value is never rendered;
 * a label for it is* (ADR-025, ADR-029). What is stored is `HISTORICAL_OBSERVED`; what a reader
 * sees is whatever the catalogue says in the locale they chose.
 *
 * The one exception is the Spanish report deliverable, which quotes the regime in the language the
 * document is written in and therefore keeps its own constant beside the generator.
 */

/**
 * The four SOURCE TYPE badges of invariant 13 are `vocabulary.sourceType.*` and their one-line
 * explanations `vocabulary.sourceTypeNote.*`. The **derivation** stays here, in
 * `deriveSourceTypeLabel`: which of the four a value is remains a fact about the data, and it does
 * not change with the reader's language.
 */
