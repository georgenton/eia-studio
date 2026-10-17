import type { ProvenanceFacets } from "@eia/domain";

/**
 * Presentation mapping from faceted provenance to the four SOURCE TYPE badges approved in
 * design v0.2 (PROVENANCE.md §2.6, ADR-005). Pure data → label; never stored.
 *
 * `REAL_AGGREGATE` reads *Dato histórico* on screen, so it requires the regime to say so.
 * Without that condition any `[ORIGINAL]` aggregate earned the badge, and an operational
 * figure computed minutes ago — a live campaign's progress, for instance — was presented to
 * a reader as a historical fact of the study. The demonstration project hid it, because
 * there the aggregates genuinely are historical; it appears the moment a project is new.
 * A regime this function does not recognise earns no badge, which is the honest default:
 * invariant 13 is about saying what a value is, not about labelling everything.
 */
export type SourceTypeLabel =
  "REAL_AGGREGATE" | "RECONSTRUCTED" | "ANONYMIZED" | "SYNTHETIC" | null;

export function deriveSourceTypeLabel(facets: ProvenanceFacets): SourceTypeLabel {
  if (facets.regime === "DEMO_SIMULATION") return "SYNTHETIC";
  if (facets.transformations.includes("ANONYMIZED")) return "ANONYMIZED";
  const last = facets.transformations[facets.transformations.length - 1];
  if (last === "RECONSTRUCTED" || last === "DERIVED") return "RECONSTRUCTED";
  if (
    facets.regime === "HISTORICAL_OBSERVED" &&
    facets.transformations.length === 1 &&
    last === "ORIGINAL" &&
    facets.granularity === "AGGREGATE"
  ) {
    return "REAL_AGGREGATE";
  }
  return null;
}

/** Block-level DEMO badge: shown when any composing value is DEMO_SIMULATION. */
export function needsDemoBadge(facets: ReadonlyArray<ProvenanceFacets>): boolean {
  return facets.some((f) => f.regime === "DEMO_SIMULATION");
}
