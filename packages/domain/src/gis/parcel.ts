import { z } from "zod";

import type { ProvenanceFacets } from "../provenance/facets";

/**
 * Parcel — the master territorial unit of analysis (invariant 7, DATA_MODEL.md §3.3).
 *
 * ## Identity
 *
 * `id` is a UUID and the only technical identity. `parcelCode` is the **business** identifier the
 * cartographer and the field sheet use; it is not the primary key, it is not derived from
 * chainage, and it is never an owner's name. It is unique per project, which is what lets an
 * official cadastre later arrive with the same codes and match our rows.
 *
 * Identity survives geometry: replacing the synthetic dataset with an official one creates new
 * `ParcelGeometry` rows, never new parcels.
 */
/**
 * A single leading letter is allowed because `project.parcel_code_pattern` defaults to
 * `P-{seq:04}` (FEATURES.md §4): a project that never renamed its pattern would otherwise
 * generate codes its own validator rejects.
 */
export const PARCEL_CODE_PATTERN = /^[A-Z][A-Z0-9]{0,9}(-[A-Z0-9]{1,10}){1,3}$/;

export const parcelCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(
    PARCEL_CODE_PATTERN,
    "a parcel code is uppercase alphanumeric groups separated by hyphens, e.g. P-0042",
  );

export function isParcelCode(value: string): boolean {
  return parcelCodeSchema.safeParse(value).success;
}

/** Which side of the corridor the parcel fronts onto. */
export const PARCEL_SIDES = ["left", "right", "both"] as const;
export const parcelSideSchema = z.enum(PARCEL_SIDES);
export type ParcelSide = z.infer<typeof parcelSideSchema>;

export const PARCEL_SIDE_LABEL: Readonly<Record<ParcelSide, string>> = {
  left: "Izquierdo",
  right: "Derecho",
  both: "Ambos",
};

/**
 * What GIS itself can say about a parcel. It is deliberately **not** the survey state of the
 * approved design (Completo · Visitado · Requiere revisita · Inconsistencia): those are derived
 * from instrument states, visits and findings, which belong to Field and Quality and do not exist
 * yet. Storing them here would be a column that drifts and a claim we cannot support.
 */
export const PARCEL_STATUSES = ["confirmed", "estimated", "not_located", "excluded"] as const;
export const parcelStatusSchema = z.enum(PARCEL_STATUSES);
export type ParcelStatus = z.infer<typeof parcelStatusSchema>;

export interface ParcelStatusPresentation {
  readonly label: string;
  /** Shown next to the colour: state is never communicated by colour alone. */
  readonly glyph: string;
  readonly note: string;
}

export const PARCEL_STATUS_PRESENTATION: Readonly<Record<ParcelStatus, ParcelStatusPresentation>> =
  {
    confirmed: {
      label: "Confirmado",
      glyph: "✓",
      note: "Predio frentista confirmado en el universo del estudio",
    },
    estimated: {
      label: "En verificación",
      glyph: "○",
      note: "Geometría estimada; el predio aún no se confirma",
    },
    not_located: {
      label: "No localizado",
      glyph: "?",
      note: "No se pudo ubicar el predio en el corredor",
    },
    excluded: {
      label: "Excluido",
      glyph: "—",
      note: "Fuera del universo de análisis",
    },
  };

/**
 * The full survey-state vocabulary of design v0.2 §3, kept here as the target so the reduction is
 * explicit and reviewable rather than silently forgotten. Slice 2 renders only the statuses above;
 * the remaining states become derivable when Field (visits, instruments) and Quality (findings)
 * land, at which point this derivation grows rather than the schema.
 */
export const DESIGN_SURVEY_STATES_PENDING_FIELD = [
  "completo",
  "visitado",
  "requiere_revisita",
  "inconsistencia",
] as const;

export interface Parcel {
  readonly id: string;
  readonly parcelCode: string;
  /** Named sub-area of the project (a `ProjectUnit` once that module exists); free text for now. */
  readonly sectorLabel: string | null;
  readonly side: ParcelSide;
  readonly status: ParcelStatus;
  /** Distance along the alignment, in metres. A reference, never an identifier. */
  readonly chainageM: number | null;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}
