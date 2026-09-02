import { z } from "zod";

/**
 * Coordinate reference systems (ADR-017, docs/DATA_MODEL.md §3.3).
 *
 * Three roles, kept apart on purpose. Only the first is a property of the platform.
 *
 * | Role | Where it lives | Value |
 * |---|---|---|
 * | **Canonical** — what every geometry column stores | the schema | always `EPSG:4326` |
 * | **Source** — what a dataset version arrived in | `spatial_dataset_version.source_srid` | per dataset |
 * | **Analysis** — where metres are computed | `spatial_dataset_version.analysis_srid` | per dataset |
 *
 * ## Why canonical storage is 4326 and not a projected CRS
 *
 * EIA Studio is multi-tenant and multi-project. A project may sit anywhere; the next one may
 * arrive in another official CRS entirely. Typing the geometry columns as a single projected
 * zone would make one pilot's UTM zone a property of the product, and a project outside it could
 * not be stored at all. `EPSG:4326` is the one CRS every project can share, and it is also what
 * MapLibre consumes, so reads need no transform.
 *
 * ## Why an analysis CRS still exists
 *
 * Degrees are not metres. Any length, area or projection along an alignment is computed by
 * transforming canonical geometry into the dataset's **analysis** CRS first:
 *
 * ```sql
 * ST_Area(ST_Transform(geom, analysis_srid))
 * ```
 *
 * The analysis CRS is data, chosen per dataset version, never a constant of the domain. For the
 * pilot it is UTM 17S, which lives in the project fixture — not here.
 *
 * ## Source CRS
 *
 * `source_srid` records what the data was in when it arrived, so an official import stays
 * explainable after the transform to canonical. For generated data it is the CRS the generator
 * worked in.
 *
 * This is not a CRS engine: there is no coordinate-system editor, no per-SRID table and no
 * reprojection service. Three integers of metadata and PostGIS's own `ST_Transform`.
 */
export const CANONICAL_SRID = 4326;

/**
 * What the browser receives. Identical to {@link CANONICAL_SRID} by design — the point of a
 * lon/lat canonical CRS is that presentation needs no transform — but named separately because
 * the two are different guarantees and only one of them is about storage.
 */
export const PRESENTATION_SRID = CANONICAL_SRID;

export const CANONICAL_CRS_LABEL = "EPSG:4326 · WGS 84";

/** `32717` → `EPSG:32717`. The label is derived; no table maps codes to names. */
export function epsgLabel(srid: number): string {
  return `EPSG:${srid}`;
}

/**
 * An EPSG code as stored in dataset metadata. Bounded to the published EPSG range so a typo or a
 * forged payload cannot reach `ST_Transform` as an arbitrary integer.
 */
export const sridSchema = z.number().int().min(1024).max(999_999);

/**
 * A metric CRS is required for length and area. Geographic CRS codes (the 4xxx block, including
 * 4326 itself) measure in degrees, so computing an area in one yields square degrees — a number
 * that looks plausible and means nothing. Analysis SRIDs are validated at the boundary.
 */
export function isGeographicSrid(srid: number): boolean {
  return srid >= 4000 && srid <= 4999;
}

export const analysisSridSchema = sridSchema.refine((srid) => !isGeographicSrid(srid), {
  message: "an analysis CRS must be projected: areas and lengths in a geographic CRS are degrees",
});

/**
 * The pilot's analysis CRS is an assumption, not a declared fact: the official GIS package has
 * not been received, so the project's real CRS is unknown. The chosen zone lives in the project
 * fixture; this string is the explanation that travels with any dataset generated under it.
 */
export const DEMO_CRS_ASSUMPTION =
  "CRS de análisis asumido para la demostración: el paquete GIS oficial no se ha recibido y el " +
  "CRS declarado del proyecto se desconoce. La geometría canónica se almacena en EPSG:4326; las " +
  "superficies y longitudes se calculan transformando al CRS de análisis del conjunto de datos. " +
  "Una importación oficial declara su propio CRS y reemplaza esta versión.";
