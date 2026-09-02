import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project } from "./app";

/**
 * GIS module tables (ADR-003 linear-infrastructure extension, DATA_MODEL.md §3.3).
 *
 * Geometry is stored natively in PostGIS in the **canonical** CRS `EPSG:4326`, which is the one
 * CRS every project can share and the one MapLibre consumes, so reads need no transform. The
 * projected CRS a dataset's metres are computed in is metadata on its version
 * (`analysis_srid`), not a property of the column — a second project in another UTM zone stores
 * geometry in the same tables (ADR-017). Canonical geometry is never JSON: GeoJSON is a
 * presentation format produced at read time.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts both lists stay identical.
 */

/**
 * A PostGIS geometry column. Drizzle has no native PostGIS type, and the alternative — storing
 * WKT in `text` — would give up spatial indexes, the SRID constraint and every spatial function.
 * The TypeScript type is `string` because every read goes through `ST_AsGeoJSON` and every write
 * through `ST_GeomFromGeoJSON`; nothing in the application handles raw WKB.
 */
const geometryColumn = (geometryType: "LineString" | "Polygon" | "MultiPolygon", srid: number) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `geometry(${geometryType},${srid})`,
  });

/**
 * The only SRID that appears in the schema. Everything project-specific about coordinate systems
 * is a column value, never a column type.
 */
const CANONICAL_SRID = 4326;

export const spatialDatasetKind = app.enum("spatial_dataset_kind", [
  "alignment",
  "parcels",
  "affectations",
]);
export const spatialDatasetOrigin = app.enum("spatial_dataset_origin", [
  "generated",
  "imported",
  "field_captured",
]);
export const parcelSide = app.enum("parcel_side", ["left", "right", "both"]);
export const parcelStatus = app.enum("parcel_status", [
  "confirmed",
  "estimated",
  "not_located",
  "excluded",
]);
export const chainageMethod = app.enum("chainage_method", [
  "frontage_midpoint",
  "centroid_projection",
  "access_point",
  "declared",
]);
export const affectationCategory = app.enum("affectation_category", [
  "right_of_way",
  "access",
  "infrastructure",
  "crops",
  "other",
]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

/** A named spatial layer of a project. Geometry lives on its versions, never here. */
export const spatialDataset = app.table(
  "spatial_dataset",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    kind: spatialDatasetKind("kind").notNull(),
    label: text("label").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("spatial_dataset_project_kind_key").on(t.tenantId, t.projectId, t.kind),
    unique("spatial_dataset_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "spatial_dataset_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One version of a dataset. Replacement is the point of this table: an official import becomes a
 * new version, names the version it supersedes, and takes over as active. Nothing is deleted, so
 * a figure produced from the old geometry stays explainable.
 */
export const spatialDatasetVersion = app.table(
  "spatial_dataset_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    datasetId: uuid("dataset_id").notNull(),
    versionLabel: text("version_label").notNull(),
    origin: spatialDatasetOrigin("origin").notNull(),
    /**
     * EPSG code the geometry arrived in, before the transform to canonical storage. Preserved so
     * an official import stays explainable after reprojection.
     */
    sourceSrid: integer("source_srid").notNull(),
    /**
     * Projected EPSG code this dataset's lengths and areas are computed in. Per dataset, because
     * the right zone is a property of where the project is, not of the product.
     */
    analysisSrid: integer("analysis_srid").notNull(),
    /** Algorithm identity for generated data; null for an import. */
    generatorVersion: text("generator_version"),
    featureCount: integer("feature_count").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    supersedesVersionId: uuid("supersedes_version_id"),
    producedAt: timestamp("produced_at", { withTimezone: true, mode: "date" }).notNull(),
    note: text("note"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("spatial_dataset_version_label_key").on(t.tenantId, t.datasetId, t.versionLabel),
    unique("spatial_dataset_version_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "spatial_dataset_version_dataset_fk",
      columns: [t.tenantId, t.datasetId],
      foreignColumns: [spatialDataset.tenantId, spatialDataset.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "spatial_dataset_version_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "spatial_dataset_version_supersedes_fk",
      columns: [t.tenantId, t.supersedesVersionId],
      foreignColumns: [t.tenantId, t.id],
    }),
    index("spatial_dataset_version_active_idx").on(t.tenantId, t.datasetId, t.isActive),
  ],
);

/** The corridor axis. One geometry per dataset version. */
export const alignment = app.table(
  "alignment",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    datasetVersionId: uuid("dataset_version_id").notNull(),
    label: text("label").notNull(),
    geom: geometryColumn("LineString", CANONICAL_SRID)("geom").notNull(),
    lengthM: numeric("length_m", { precision: 12, scale: 2 }).notNull(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "alignment_version_fk",
      columns: [t.tenantId, t.datasetVersionId],
      foreignColumns: [spatialDatasetVersion.tenantId, spatialDatasetVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "alignment_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("alignment_geom_idx").using("gist", t.geom),
  ],
);

/**
 * Parcel identity. `id` is the technical key; `parcel_code` is the business identifier the
 * cartographer and the field sheet use, unique per project. Geometry is deliberately absent:
 * it lives in `parcel_geometry`, versioned, so an official import replaces boundaries without
 * touching identity.
 */
export const parcel = app.table(
  "parcel",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    parcelCode: text("parcel_code").notNull(),
    sectorLabel: text("sector_label"),
    side: parcelSide("side").notNull(),
    status: parcelStatus("status").notNull().default("estimated"),
    /** Reference along the corridor, in metres. Never an identifier. */
    chainageM: numeric("chainage_m", { precision: 10, scale: 1 }),
    chainageMethod: chainageMethod("chainage_method"),
    frontageM: numeric("frontage_m", { precision: 8, scale: 1 }),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("parcel_project_code_key").on(t.tenantId, t.projectId, t.parcelCode),
    unique("parcel_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "parcel_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("parcel_project_chainage_idx").on(t.tenantId, t.projectId, t.chainageM),
  ],
);

/**
 * A parcel's boundary as recorded by one dataset version. Exactly one row per parcel may be
 * active; superseding one is how geometry is replaced without the parcel changing identity.
 */
export const parcelGeometry = app.table(
  "parcel_geometry",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    parcelId: uuid("parcel_id").notNull(),
    datasetVersionId: uuid("dataset_version_id").notNull(),
    geom: geometryColumn("Polygon", CANONICAL_SRID)("geom").notNull(),
    areaM2: numeric("area_m2", { precision: 14, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    supersededByGeometryId: uuid("superseded_by_geometry_id"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("parcel_geometry_parcel_version_key").on(t.tenantId, t.parcelId, t.datasetVersionId),
    unique("parcel_geometry_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "parcel_geometry_parcel_fk",
      columns: [t.tenantId, t.parcelId],
      foreignColumns: [parcel.tenantId, parcel.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "parcel_geometry_version_fk",
      columns: [t.tenantId, t.datasetVersionId],
      foreignColumns: [spatialDatasetVersion.tenantId, spatialDatasetVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "parcel_geometry_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("parcel_geometry_geom_idx").using("gist", t.geom),
    index("parcel_geometry_active_idx").on(t.tenantId, t.projectId, t.isActive),
  ],
);

/** What the right of way takes from a parcel. No owner, no valuation, no settlement workflow. */
export const affectation = app.table(
  "affectation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    parcelId: uuid("parcel_id").notNull(),
    datasetVersionId: uuid("dataset_version_id").notNull(),
    category: affectationCategory("category").notNull(),
    geom: geometryColumn("Polygon", CANONICAL_SRID)("geom").notNull(),
    affectedAreaM2: numeric("affected_area_m2", { precision: 14, scale: 2 }).notNull(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("affectation_parcel_version_category_key").on(
      t.tenantId,
      t.parcelId,
      t.datasetVersionId,
      t.category,
    ),
    foreignKey({
      name: "affectation_parcel_fk",
      columns: [t.tenantId, t.parcelId],
      foreignColumns: [parcel.tenantId, parcel.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "affectation_version_fk",
      columns: [t.tenantId, t.datasetVersionId],
      foreignColumns: [spatialDatasetVersion.tenantId, spatialDatasetVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "affectation_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("affectation_geom_idx").using("gist", t.geom),
  ],
);

/** Re-exported so migrations and read models can reference the storage CRS in one place. */
export { CANONICAL_SRID };
