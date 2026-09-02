import { z } from "zod";

/**
 * Linear reference along a corridor — the *abscisa* of the approved design, rendered `2+840`
 * (design v0.2, PRODUCT.md §8).
 *
 * ## What the number means
 *
 * Chainage is a **reference**, never an identity: two parcels can share one, and an official
 * import may move it. `Parcel.parcelCode` is the identifier.
 *
 * ## How the number is obtained
 *
 * One method is used consistently and is recorded on every value, because "2+840" is unreadable
 * six months later without knowing what was measured. Slice 2 uses **`centroid_projection`**,
 * computed by PostGIS from the geometry that is actually stored:
 *
 * ```
 * parcel centroid
 *   → ST_LineLocatePoint onto the project's *active* alignment   (fraction along the line, 0–1)
 *   → × the alignment's length measured in the dataset's analysis CRS
 *   → chainage in metres
 * ```
 *
 * Two consequences follow, and both are asserted by tests:
 *
 * - **It is derived, not stored twice.** The generator knows where it put each parcel, but
 *   carrying that number alongside the geometry would be two facts that can disagree. Chainage is
 *   recomputed from the geometry, so it always describes the polygons the map shows.
 * - **It is bounded by the alignment.** A fraction in `[0, 1]` times the line's length cannot
 *   land outside `[0, alignmentLength]`.
 *
 * `frontage_midpoint` would be the better method once we know where each parcel meets the road.
 * For synthetic polygons we do not, and claiming a frontage we have not surveyed would be a
 * fabricated fact; the centroid is a property of the geometry we actually have.
 *
 * The alternatives are declared rather than left implicit, because a field sheet may later
 * declare a different one and the two must be distinguishable on the same screen.
 */
export const CHAINAGE_METHODS = [
  /** Station of the midpoint of the parcel's frontage on the corridor. Needs surveyed frontage. */
  "frontage_midpoint",
  /** Station of the parcel centroid projected onto the alignment. Slice 2 default. */
  "centroid_projection",
  /** Station of the access point declared in the field. */
  "access_point",
  /** Value transcribed from a field sheet without an independent computation. */
  "declared",
] as const;

export const chainageMethodSchema = z.enum(CHAINAGE_METHODS);
export type ChainageMethod = z.infer<typeof chainageMethodSchema>;

export const CHAINAGE_METHOD_LABEL: Readonly<Record<ChainageMethod, string>> = {
  frontage_midpoint: "Punto medio del frente sobre la vía",
  centroid_projection: "Proyección del centroide sobre el eje",
  access_point: "Punto de acceso declarado",
  declared: "Declarada en ficha de campo",
};

/** `2840` → `2+840`. Metres below the hectometre are not shown; the design uses whole metres. */
export function formatChainage(metres: number): string {
  const whole = Math.max(0, Math.round(metres));
  const km = Math.floor(whole / 1000);
  const rest = whole % 1000;
  return `${km}+${String(rest).padStart(3, "0")}`;
}

/** `2+840` → `2840`; returns null for anything that is not an abscissa. */
export function parseChainage(value: string): number | null {
  const match = /^(\d+)\+(\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 1000 + Number(match[2]);
}
