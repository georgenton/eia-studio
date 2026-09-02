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

/** Spanish labels for the drawer; copy is a product asset (PRODUCT.md §8). */
export const VALIDATION_STATE_LABEL: Readonly<Record<ValidationState, string>> = {
  VALIDATED: "VALIDADO",
  PARTIAL: "PARCIAL",
  PENDING: "PENDIENTE",
  NOT_REQUIRED: "NO REQUIERE",
  SPECIALIST_REQUIRED: "REQUIERE ESPECIALISTA",
};

export const REGIME_LABEL = {
  HISTORICAL_OBSERVED: "Histórico observado",
  LIVE_OPERATIONAL: "Operacional en vivo",
  DEMO_SIMULATION: "Simulación de demostración",
} as const;

export const ORIGIN_LABEL = {
  FIELD_CAPTURE: "Captura en campo",
  IMPORTED_DOCUMENT: "Documento importado",
  IMPORTED_DATASET: "Dataset importado",
  SYSTEM_GENERATED: "Generado por el sistema",
} as const;

export const TRANSFORMATION_LABEL = {
  ORIGINAL: "Original",
  RECONSTRUCTED: "Reconstruido",
  DERIVED: "Derivado",
  ANONYMIZED: "Anonimizado",
} as const;

export const GRANULARITY_LABEL = {
  INDIVIDUAL: "Individual",
  AGGREGATE: "Agregado",
} as const;
