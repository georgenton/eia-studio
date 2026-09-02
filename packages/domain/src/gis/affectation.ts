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
  readonly affectedAreaM2: number;
  /** Share of the parcel's own area, 0–1. Derived from the two geometries, never entered. */
  readonly ratioOfParcel: number;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/** Affectation share is a computation over two areas; it is never a typed-in percentage. */
export function affectationRatio(affectedAreaM2: number, parcelAreaM2: number): number {
  if (parcelAreaM2 <= 0) return 0;
  return Math.min(1, Math.max(0, affectedAreaM2 / parcelAreaM2));
}
