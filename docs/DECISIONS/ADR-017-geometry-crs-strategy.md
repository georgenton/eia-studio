# ADR-017 — Canonical geometry is EPSG:4326; the metric CRS is dataset metadata

- Status: Accepted (Implementation Gate 2, condition IG2-001)
- Date: 2026-09-02
- Related: ADR-003 (territorial extension), ADR-013 (Drizzle + reviewed SQL), ARCHITECTURE.md §7,
  DATA_MODEL.md §3.3, docs/GIS_IMPORT_CONTRACT.md

## Context

Slice 2 introduced PostGIS geometry. It stored it in **EPSG:32717** (WGS 84 / UTM zone 17S),
reasoning that areas, lengths and the projection of a parcel onto the corridor must be metric, and
that doing metric work in degrees is wrong. That reasoning is correct. The implementation of it
was not.

Migration 0009 typed the columns themselves:

```sql
geom geometry(Polygon, 32717)
```

which makes the pilot's UTM zone a property of the **platform**. EIA Studio is multi-tenant and
multi-project: the next project may sit in zone 18S, may arrive in a national grid, and will in
any case declare its own CRS when the official GIS package exists. Under that schema such a
project could not be stored at all — not "stored awkwardly", but rejected by a column type. The
constraint also silently promoted a demo assumption (we do not know the pilot's real CRS) into a
schema-level fact.

Three plausible corrections were considered:

1. **A column per CRS, or a table per CRS.** Multiplies every query and every index by the number
   of zones; the join keys become CRS-dependent. Rejected.
2. **A generic CRS engine**: coordinate-system configuration UI, reprojection service, arbitrary
   target CRS per query. A large subsystem for a product with one project. Rejected as
   over-engineering, and explicitly out of scope at the gate.
3. **One canonical CRS for storage, plus per-dataset metadata for the metric work.** Chosen.

## Decision

**Canonical geometry is `EPSG:4326`.** Every geometry column in `app` is typed `geometry(...,
4326)` and nothing project-specific appears in a column type.

Two integers on `spatial_dataset_version` carry what varies:

| Column | Meaning |
|---|---|
| `source_srid` | the EPSG code the data arrived in, before the transform to canonical storage |
| `analysis_srid` | the **projected** EPSG code this dataset's lengths and areas are measured in |

Rules that follow:

- **Presentation needs no transform.** MapLibre consumes lon/lat, so `ST_AsGeoJSON(geom)` is the
  whole read path. Canonical and presentation coincide, which is a reason to choose 4326 rather
  than a coincidence to rely on.
- **Metres come from an explicit transform**, always into the dataset's analysis CRS:
  `ST_Area(ST_Transform(geom, analysis_srid))`. Stored metric columns (`area_m2`,
  `affected_area_m2`, `length_m`, `chainage_m`, `frontage_m`) are written that way and their
  names state the unit.
- **`analysis_srid` must be projected.** A CHECK rejects the geographic 4xxx block, because an
  area computed in a geographic CRS is square degrees — a number that looks plausible and means
  nothing. Both SRIDs are bounded to the published EPSG range so a forged value cannot reach
  `ST_Transform` as an arbitrary integer.
- **The domain holds no zone.** `packages/domain/src/gis/crs.ts` exports `CANONICAL_SRID` and
  validators. The pilot's 32717 lives in `fixtures/projects/…/manifest.json` as `analysisSrid`,
  with `crsBasis: "DEMO_ASSUMPTION"`. A unit test fails if `32717` reappears as a domain constant.
- **Source CRS is preserved for imports.** An official package declares its own CRS; the import
  records it in `source_srid`, transforms to canonical, and supersedes the generated version
  (`docs/GIS_IMPORT_CONTRACT.md`).

## Consequences

- A project in another UTM zone, or in a national grid, needs no schema change: it writes a
  different `analysis_srid`. Asserted by an integration test that stores a second project's parcel
  with `analysis_srid = 32718` alongside the pilot's.
- Every metric query must transform explicitly. That is more verbose than a projected column, and
  deliberately so: the transform is where the reader can see which CRS a number came from.
- Reprojection has a cost at write time. It is paid once per feature, at seed or import, never per
  request; reads do no transform at all.
- Spatial indexes are on canonical geometry, so a bounding-box query is expressed in lon/lat.
- Migration 0011 is forward-only: it moves the columns with
  `ALTER COLUMN geom TYPE geometry(...,4326) USING ST_Transform(geom, 4326)`, backfills the two
  SRIDs from the old `source_crs` text, and drops that column. Migrations 0009 and 0010 are not
  rewritten; they were already applied to staging.

## What this decision does not do

It does not introduce a CRS engine, a coordinate-system editor, a per-SRID table, or support for
querying in an arbitrary CRS. It is three integers and PostGIS's own `ST_Transform`.
