# ADR-023 — The real cartographic package decides the shape of the GIS model

- Status: Accepted
- Date: 4 September 2026
- Supersedes: nothing. **Amends** `docs/GIS_IMPORT_CONTRACT.md` §2 and §3, and `docs/DATA_MODEL.md`
  §3.3.
- Related: ADR-003 (core + profile extension), ADR-005 (faceted provenance), ADR-017 (canonical
  storage CRS and per-dataset analysis CRS), `docs/SECURITY.md` §10a.

## Context

Slice 2 built the territorial model from a prototype screenshot and a deterministic corridor
generator, because the official GIS package had not arrived. `docs/GIS_IMPORT_CONTRACT.md` was
written at the same time to say what an import would need, so that the synthetic layers could be
replaced without a schema change.

The package has now arrived: `Anexo 7. Cartografía.rar`, 2,11 GiB, containing an Esri File
Geodatabase with 83 live feature classes for the real study — *Actualización de Estudios
Socioambientales … vía Puente del Amor – Los Hachos*, Yantzaza, Zamora Chinchipe (PROVIAL 2,
EC-L1289).

Read with GDAL in an isolated workspace, it contradicts three assumptions the model made. All three
contradictions are properties of real cadastral and environmental data, not of this delivery, so
guessing again would only postpone them.

**1. A real parcel is not one polygon.** `PREDIOS` holds 141 features, and **20 of them are
multi-part** — a plot split by the road, or with a detached portion. `AREAS_AFECTADAS` holds 71
features of which **14 are multi-part**, one with eight parts. The columns are typed
`geometry(Polygon, 4326)`. The import contract said multi-part geometry would be "rejected rather
than silently flattened"; applied literally that rejects 14 % of the real parcels, and flattening
loses land that a right of way will be paid for.

**2. A parcel's chainage is a range, not a point.** `ABSCISA_PREDIO` holds 282 rows: one `INICIAL`
and one `FINAL` per parcel, with `DER_IZQ` naming the side. `parcel.chainage_m` stores one number.
A frontage runs *from* an abscissa *to* an abscissa; that is how the consultancy addresses a
roadside plot, and it is what the field sheet reads.

**3. Influence areas are a layer of the study, not a footnote.** The package carries 19 AID/AII and
sensitivity polygon layers. They are the geometry the PGAS's `LUGAR DE APLICACIÓN` refers to and the
first thing a reviewer looks for on a map of an environmental study. There is no domain object for
them; a `SpatialDataset` has three kinds and none fits.

## Decision

**1. Geometry columns hold multi-part geometry.** `alignment.geom` becomes
`geometry(MultiLineString, 4326)`; `parcel_geometry.geom` and `affectation.geom` become
`geometry(MultiPolygon, 4326)`. Migration 0024 widens them with `ST_Multi`, which is lossless: a
single polygon is a valid multipolygon of one part, so no existing row changes meaning and none is
rewritten in substance.

The import contract's rejection rule is **amended**: multi-part geometry is *stored as it arrived*.
What must never happen silently is the opposite — discarding parts to fit a narrower type.

**2. A parcel carries a chainage range.** `parcel` gains `chainage_start_m` and `chainage_end_m`,
both nullable. `chainage_m` is **kept** and keeps its meaning — the single reference point used for
ordering along the corridor and for the existing `chainage_method` provenance — and is set to the
start of the range when a range exists. Nothing that reads `chainage_m` today changes behaviour.

**3. Influence areas become a first-class layer.** A new table `influence_area`, a new
`spatial_dataset_kind` value `influence_areas`, and an `influence_area_kind` enum with four values
the package itself distinguishes: `direct`, `indirect`, `direct_social`, `indirect_social` (AID,
AII, AISD, AISI). One table, project-scoped, versioned by `spatial_dataset_version` exactly as
parcels are.

This is an extension in the sense of ADR-003 — activated by the profile's territorial model, not
assumed by the core — and it is deliberately *one* table rather than a generic feature store. A
generic "any layer, any attributes" table is the meta-platform ADR-003 rejects.

## What this decision does **not** do

- **It does not import a single owner-bearing attribute.** The package's parcel layers carry owner
  names, deed references, compensation agreements, surveyor names, photographs and free-text field
  notes. Every one is stripped before the geometry reaches this repository, under an allowlist that
  denies by default, and the compliance gate of `SECURITY.md` §10a stays closed. The fixture
  carries fourteen property keys, all of them codes, areas, states or chainages.
- **It does not repair the package.** `042A` and `042a` remain two spellings of one parcel; code
  `090` still has an affectation and no parcel; `091` still has no chainage; `ESTADO` still holds
  both `COMPLETO` and `COMPLETA`. Those are findings for the Quality Gate to state, not defects for
  an importer to hide.
- **It does not change the storage CRS.** Geometry is stored in EPSG:4326 and measured in the
  dataset version's `analysis_srid` (ADR-017). The package's 23 layers declared in EPSG:32718 are
  reprojected on the way in and the declared source CRS is recorded per dataset version — they are
  correctly georeferenced, merely expressed 416 km from that zone's central meridian.
- **It does not ingest rasters.** The 194 MB ECW orthophoto, the 66 PDF sheets, the 65 ArcMap
  projects and the 890 MB video stay outside the product.

## Consequences

- Migration 0024 is forward-only and additive in effect: two nullable columns, one enum value, one
  enum type, one table, and three widened geometry types. No column is dropped and no row is
  deleted by it.
- PostGIS accepts a `Polygon` literal into a `MultiPolygon` column only through `ST_Multi`; every
  write path uses it, and the seeder's WKT builders are updated accordingly.
- The corridor generator, its tests and the `RECONSTRUCTED_ALIGNMENT` legend stay. They are how a
  project without a package still gets a workspace, and they are what the Zamora fixture used until
  today.
- `influence_area` needs RLS, a composite FK, cross-tenant harness coverage and isolation tests, in
  the same shape as every other project-scoped table.

## Alternatives rejected

**Reject multi-part features, as the contract said.** It would drop 20 real parcels and 14 real
affectations on the first real package. A rule that fails on its first legitimate input was written
against an imagined dataset.

**Flatten to the largest part.** Silent loss of land inside a right-of-way calculation. The worst
option on the list.

**Store parcels as one row per part.** It breaks `parcel_code` uniqueness or invents sub-codes the
consultancy does not use, and every downstream count becomes wrong.

**Model influence areas as parcels with a category.** A parcel is a unit of analysis with a code, an
owner in the real world and a field sheet. An influence area is none of those.

**A generic `feature` table with a JSON attribute bag.** The meta-platform ADR-003 rejects, and it
would put unvalidated attributes — the exact place an owner name would eventually reappear — in the
one part of the model that has no schema.
