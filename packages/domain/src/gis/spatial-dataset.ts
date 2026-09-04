import { z } from "zod";

import type { ProvenanceFacets } from "../provenance/facets";

/**
 * Spatial datasets and their versions (DATA_MODEL.md §3.3).
 *
 * A dataset is a named layer of a project — the corridor alignment, the parcel polygons. Its
 * **versions** are what hold geometry, so a later official import becomes a new version that
 * supersedes ours without disturbing any `Parcel` identity.
 */
export const SPATIAL_DATASET_KINDS = [
  "alignment",
  "parcels",
  "affectations",
  "influence_areas",
] as const;
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
  | "FIELD_CAPTURED"
  | "IMPORTED_STUDY_LAYER"
  | "STUDY_DELIMITED_AREA";

export function deriveLayerLegend(
  kind: SpatialDatasetKind,
  facets: ProvenanceFacets,
): LayerProvenanceLegend {
  const reconstructed = facets.transformations.includes("RECONSTRUCTED");
  // An influence area is a boundary the study drew, not a cadastral fact and not a field capture.
  // Labelling it `OFFICIAL_CADASTRE` because it was imported would claim a registry said so.
  if (kind === "influence_areas") return "STUDY_DELIMITED_AREA";
  if (kind === "alignment") {
    if (reconstructed) return "RECONSTRUCTED_ALIGNMENT";
    return facets.origin === "IMPORTED_DATASET" ? "OFFICIAL_IMPORTED_ALIGNMENT" : "REAL_BASE_MAP";
  }
  if (facets.regime === "DEMO_SIMULATION") return "SYNTHETIC_PARCELS";
  if (facets.origin === "FIELD_CAPTURE") return "FIELD_CAPTURED";
  /*
   * Imported, but by whom and from what?
   *
   * A layer whose attributes had to be stripped before it could be stored is a consultancy's own
   * working survey — it carried owner names, deeds and field notes, which a registry extract does
   * not hand out. A cadastral layer arrives `ORIGINAL` and is labelled as cadastre. Calling the
   * first one "official cadastre" would put a registry's authority behind a surveyor's sketch,
   * which is precisely what invariant 13's vocabulary exists to prevent.
   */
  if (facets.transformations.includes("ANONYMIZED")) return "IMPORTED_STUDY_LAYER";
  return "OFFICIAL_CADASTRE";
}

/** Spanish copy of the legend, and the disclaimer each key carries (design v0.2 §3). */
export const LAYER_LEGEND_COPY: Readonly<
  Record<LayerProvenanceLegend, { label: string; note: string }>
> = {
  REAL_BASE_MAP: {
    label: "Cartografía base real",
    note: "hidrografía, poblados y localización general",
  },
  RECONSTRUCTED_ALIGNMENT: {
    label: "Eje reconstruido",
    note: "eje aproximado, dibujado hasta recibir el GIS oficial",
  },
  SYNTHETIC_PARCELS: {
    label: "Predios simulados",
    note: "polígonos generados · no es catastro",
  },
  OFFICIAL_IMPORTED_ALIGNMENT: {
    label: "Eje vial del estudio",
    note: "eje vial del paquete GIS oficial",
  },
  OFFICIAL_CADASTRE: {
    label: "Catastro oficial",
    note: "capa catastral oficial importada",
  },
  FIELD_CAPTURED: {
    label: "Levantado en campo",
    note: "geometría levantada en campo",
  },
  IMPORTED_STUDY_LAYER: {
    label: "Capa del estudio",
    note: "levantamiento predial del estudio · no es catastro oficial",
  },
  STUDY_DELIMITED_AREA: {
    label: "Área delimitada por el estudio",
    note: "área de influencia delimitada por el estudio",
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

/**
 * Pick the layer a surface is actually talking about, by kind (IG2-007).
 *
 * The regression this exists to prevent: the Command Center's territorial summary took
 * `layers[0]` and so captioned a count of **parcels** with the **alignment** layer's legend and
 * provenance link. It read correctly on one machine and wrongly in CI, because the query had no
 * `ORDER BY` and PostgreSQL's row order is incidental.
 *
 * Two rules, both enforced by the signature: a surface names the kind it means, and it gets
 * `null` rather than a plausible wrong layer when that kind is absent. Never index into the array.
 */
export function selectLayerByKind<T extends { readonly datasetKind: SpatialDatasetKind }>(
  layers: ReadonlyArray<T>,
  kind: SpatialDatasetKind,
): T | null {
  return layers.find((layer) => layer.datasetKind === kind) ?? null;
}

/**
 * Stable display order for the layer-provenance legend: the corridor, then the parcels on it,
 * then what the right of way takes. Reading order, and it does not depend on the database.
 */
export const LAYER_LEGEND_ORDER: ReadonlyArray<SpatialDatasetKind> = [
  "alignment",
  "parcels",
  "affectations",
];

/** Order layers for display without mutating the caller's array. */
export function orderLayersForLegend<T extends { readonly datasetKind: SpatialDatasetKind }>(
  layers: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const rank = (kind: SpatialDatasetKind) => {
    const index = LAYER_LEGEND_ORDER.indexOf(kind);
    return index === -1 ? LAYER_LEGEND_ORDER.length : index;
  };
  return [...layers].sort((a, b) => rank(a.datasetKind) - rank(b.datasetKind));
}
