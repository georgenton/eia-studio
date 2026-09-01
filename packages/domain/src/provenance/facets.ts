import { z } from "zod";

/**
 * Faceted provenance primitives (ADR-005, Gate 1 D-013). No provenance-bearing table exists in
 * Slice 0; these types fix the vocabulary so later slices cannot introduce a single-enum
 * "source type". The v0.2 SOURCE TYPE badges are derived in `@eia/ui`, never stored.
 */
export const REGIMES = ["HISTORICAL_OBSERVED", "LIVE_OPERATIONAL", "DEMO_SIMULATION"] as const;
export const ORIGINS = [
  "FIELD_CAPTURE",
  "IMPORTED_DOCUMENT",
  "IMPORTED_DATASET",
  "SYSTEM_GENERATED",
] as const;
export const TRANSFORMATIONS = ["ORIGINAL", "RECONSTRUCTED", "DERIVED", "ANONYMIZED"] as const;
export const GRANULARITIES = ["INDIVIDUAL", "AGGREGATE"] as const;

export const regimeSchema = z.enum(REGIMES);
export const originSchema = z.enum(ORIGINS);
export const transformationSchema = z.enum(TRANSFORMATIONS);
export const granularitySchema = z.enum(GRANULARITIES);

export const provenanceFacetsSchema = z
  .object({
    regime: regimeSchema,
    origin: originSchema,
    /** Ordered list; the last element is the current transformation. */
    transformations: z.array(transformationSchema).min(1),
    granularity: granularitySchema.nullable(),
  })
  .strict();

export type Regime = z.infer<typeof regimeSchema>;
export type Origin = z.infer<typeof originSchema>;
export type Transformation = z.infer<typeof transformationSchema>;
export type Granularity = z.infer<typeof granularitySchema>;
export type ProvenanceFacets = z.infer<typeof provenanceFacetsSchema>;

/** Read-model wrapper: a value that can always answer where it comes from (PROVENANCE.md §4). */
export interface Sourced<T> {
  readonly value: T;
  readonly provenance: ProvenanceFacets;
  readonly provenanceId: string;
}

export function isDemo(facets: ProvenanceFacets): boolean {
  return facets.regime === "DEMO_SIMULATION";
}
