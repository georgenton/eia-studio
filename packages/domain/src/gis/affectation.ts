import { z } from "zod";

import type { ProvenanceFacets } from "../provenance/facets";

/**
 * Affectation: how much of a parcel the right of way takes (design v0.2 §4 "Afectaciones").
 *
 * Slice 2 models only what the geometry can answer — an area and its share of the parcel — plus a
 * coarse category. It deliberately holds **no** owner, no valuation, no compensation and no
 * settlement workflow: those are legal and social concerns, they carry personal data, and they
 * are not this slice's to design.
 */
export const AFFECTATION_CATEGORIES = [
  "right_of_way",
  "access",
  "infrastructure",
  "crops",
  "other",
] as const;
export const affectationCategorySchema = z.enum(AFFECTATION_CATEGORIES);
export type AffectationCategory = z.infer<typeof affectationCategorySchema>;

export const AFFECTATION_CATEGORY_LABEL: Readonly<Record<AffectationCategory, string>> = {
  right_of_way: "Franja de derecho de vía",
  access: "Acceso",
  infrastructure: "Infraestructura",
  crops: "Cultivos",
  other: "Otra",
};

export interface Affectation {
  readonly id: string;
  readonly parcelId: string;
  readonly category: AffectationCategory;
  /** Square metres, measured by PostGIS in the dataset's analysis CRS. */
  readonly affectedAreaM2: number;
  /** Share of the parcel's own area, 0–1. Derived from the two geometries, never entered. */
  readonly ratioOfParcel: number;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/**
 * The affected share of a parcel (IG2-004).
 *
 * **Both areas are square metres**, measured in the dataset's analysis CRS. The result is a
 * fraction in `[0, 1]`; presentation converts to a percentage, and areas to hectares.
 *
 * It is deliberately **not stored**. A persisted percentage is a third fact beside two areas, and
 * the moment geometry is replaced by an official import it is wrong while still looking right.
 * Deriving it means it cannot disagree with the polygons the map shows.
 *
 * Invalid input **throws** rather than clamping. The database already forbids each case —
 * `parcel_geometry_area_positive`, `affectation_area_non_negative`, and the
 * `affectation_within_parcel` constraint trigger — so reaching this function with a violation is
 * a bug, and silently returning `1` or `0` would hide it behind a plausible number.
 */
export function affectationRatio(affectedAreaM2: number, parcelAreaM2: number): number {
  if (!Number.isFinite(parcelAreaM2) || parcelAreaM2 <= 0) {
    throw new RangeError(`a parcel area must be a positive number of m², got ${parcelAreaM2}`);
  }
  if (!Number.isFinite(affectedAreaM2) || affectedAreaM2 < 0) {
    throw new RangeError(
      `an affected area must be a non-negative number of m², got ${affectedAreaM2}`,
    );
  }
  if (affectedAreaM2 > parcelAreaM2) {
    throw new RangeError(
      `an affectation cannot exceed its parcel: ${affectedAreaM2} m² of ${parcelAreaM2} m²`,
    );
  }
  return affectedAreaM2 / parcelAreaM2;
}
