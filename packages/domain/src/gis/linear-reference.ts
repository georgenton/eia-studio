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
 * One method is used consistently and is recorded on every value so a reader knows what was
 * measured. Slice 2 uses `frontage_midpoint`: the alignment station of the midpoint of the
 * parcel's frontage on the corridor, computed in the projected storage CRS. The alternatives are
 * declared here rather than left implicit, because the field sheet may later declare a different
 * one and the two must be distinguishable.
 */
export const CHAINAGE_METHODS = [
  /** Station of the midpoint of the parcel's frontage on the corridor. Slice 2 default. */
  "frontage_midpoint",
  /** Station of the perpendicular projection of the parcel centroid. */
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
  centroid_projection: "Proyección perpendicular del centroide",
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
