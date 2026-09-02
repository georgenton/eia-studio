import { z } from "zod";

import type { ProvenanceFacets } from "../provenance/facets";

/**
 * Spatial datasets and their versions (DATA_MODEL.md §3.3).
 *
 * A dataset is a named layer of a project — the corridor alignment, the parcel polygons. Its
 * **versions** are what hold geometry, so a later official import becomes a new version that
 * supersedes ours without disturbing any `Parcel` identity.
 */
export const SPATIAL_DATASET_KINDS = ["alignment", "parcels", "affectations"] as const;
export const spatialDatasetKindSchema = z.enum(SPATIAL_DATASET_KINDS);
export type SpatialDatasetKind = z.infer<typeof spatialDatasetKindSchema>;

/**
 * How a version's geometry came to exist. This is *not* a provenance vocabulary — provenance
 * stays faceted (ADR-005). It records the production route, which the importer will need.
 */
export const SPATIAL_DATASET_ORIGINS = ["generated", "imported", "field_captured"] as const;
export const spatialDatasetOriginSchema = z.enum(SPATIAL_DATASET_ORIGINS);
export type SpatialDatasetOrigin = z.infer<typeof spatialDatasetOriginSchema>;

export interface SpatialDatasetVersion {
  readonly id: string;
  readonly datasetKind: SpatialDatasetKind;
  readonly datasetLabel: string;
  /** Human version label of the dataset, e.g. `parcels_v1`. */
  readonly versionLabel: string;
  readonly origin: SpatialDatasetOrigin;
  /** CRS the geometry arrived in, as declared by its source or by our generator. */
  readonly sourceCrs: string;
  /** Algorithm identifier for generated data; null for an import. */
  readonly generatorVersion: string | null;
  readonly featureCount: number;
  readonly isActive: boolean;
  /** The version this one replaced, if any. Traceability survives replacement. */
  readonly supersedesVersionId: string | null;
  readonly producedAt: Date;
  readonly note: string | null;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/**
 * Legend key of the map's layer-provenance legend (design v0.2 §3, invariant 13).
 *
 * It is **derived**, never stored: dataset kind plus the facets of the version's provenance
 * record. A new canonical SOURCE_TYPE enum is exactly what ADR-005 forbids.
 */
export type LayerProvenanceLegend =
  | "REAL_BASE_MAP"
  | "RECONSTRUCTED_ALIGNMENT"
  | "SYNTHETIC_PARCELS"
  | "OFFICIAL_IMPORTED_ALIGNMENT"
  | "OFFICIAL_CADASTRE"
  | "FIELD_CAPTURED";

export function deriveLayerLegend(
  kind: SpatialDatasetKind,
  facets: ProvenanceFacets,
): LayerProvenanceLegend {
  const reconstructed = facets.transformations.includes("RECONSTRUCTED");
  if (kind === "alignment") {
    if (reconstructed) return "RECONSTRUCTED_ALIGNMENT";
    return facets.origin === "IMPORTED_DATASET" ? "OFFICIAL_IMPORTED_ALIGNMENT" : "REAL_BASE_MAP";
  }
  if (facets.regime === "DEMO_SIMULATION") return "SYNTHETIC_PARCELS";
  if (facets.origin === "FIELD_CAPTURE") return "FIELD_CAPTURED";
  return "OFFICIAL_CADASTRE";
}

/** Spanish copy of the legend, and the disclaimer each key carries (design v0.2 §3). */
export const LAYER_LEGEND_COPY: Readonly<
  Record<LayerProvenanceLegend, { label: string; note: string }>
> = {
  REAL_BASE_MAP: {
    label: "REAL BASE MAP",
    note: "hidrografía, poblados y localización general",
  },
  RECONSTRUCTED_ALIGNMENT: {
    label: "RECONSTRUCTED ALIGNMENT",
    note: "eje aproximado, dibujado hasta recibir el GIS oficial",
  },
  SYNTHETIC_PARCELS: {
    label: "SYNTHETIC PARCELS",
    note: "polígonos generados · no es catastro",
  },
  OFFICIAL_IMPORTED_ALIGNMENT: {
    label: "OFFICIAL IMPORTED ALIGNMENT",
    note: "eje vial del paquete GIS oficial",
  },
  OFFICIAL_CADASTRE: {
    label: "OFFICIAL CADASTRE",
    note: "capa catastral oficial importada",
  },
  FIELD_CAPTURED: {
    label: "FIELD CAPTURED",
    note: "geometría levantada en campo",
  },
};

/**
 * Only one version of a dataset may be active in a project at a time. Activation is the moment an
 * official import takes over: the new version becomes active, names the one it supersedes, and
 * the old one stays queryable.
 */
export function assertActivationIsValid(input: {
  readonly candidate: Pick<SpatialDatasetVersion, "id" | "datasetKind" | "supersedesVersionId">;
  readonly currentActive: Pick<SpatialDatasetVersion, "id" | "datasetKind"> | null;
}): void {
  const { candidate, currentActive } = input;
  if (!currentActive) return;
  if (currentActive.datasetKind !== candidate.datasetKind) {
    throw new Error("a dataset version can only supersede a version of the same kind");
  }
  if (candidate.id === currentActive.id) return;
  if (candidate.supersedesVersionId !== currentActive.id) {
    throw new Error(
      "activating a new version must name the active version it supersedes, so the replacement stays traceable",
    );
  }
}
