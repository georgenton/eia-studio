# ADR-017 — Canonical geometry is EPSG:4326; the metric CRS is dataset metadata

- Status: Accepted (Implementation Gate 2, conditions IG2-001 and IG2-009)
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
- **`analysis_srid` must be projected and metre-based**, judged from the CRS definition. See
  §"How a CRS is judged" below.
- **The domain holds no zone.** `packages/domain/src/gis/crs.ts` exports `CANONICAL_SRID` and
  validators. The pilot's 32717 lives in `fixtures/projects/…/manifest.json` as `analysisSrid`,
  with `crsBasis: "DEMO_ASSUMPTION"`. A unit test fails if `32717` reappears as a domain constant.
- **Source CRS is preserved for imports.** An official package declares its own CRS; the import
  records it in `source_srid`, transforms to canonical, and supersedes the generated version
  (`docs/GIS_IMPORT_CONTRACT.md`).

## How a CRS is judged (IG2-009)

**An SRID numeric value is never used to infer CRS type.** An SRID is an identifier; the number
encodes nothing about whether a CRS is geographic, projected, metric, or fit for measuring areas.
The first implementation of this ADR got that wrong: it rejected the 4xxx block as "geographic",
which is false in both directions.

| Code | What it actually is | The numeric rule said |
|---|---|---|
| `EPSG:4087` | **projected**, equidistant cylindrical, metres | rejected — wrongly |
| `EPSG:6318` | **geographic**, NAD83(2011), degrees | accepted — wrongly, and every area under it would be square degrees |

The source of truth is `spatial_ref_sys`. An `analysis_srid` is accepted only when all four hold:

1. **registered** — a row exists in `spatial_ref_sys`. No authority is assumed, so a custom SRS an
   operator registered counts as much as an EPSG one; there is no curated code list;
2. **projected** — the definition begins `PROJCS` (WKT1) or `PROJCRS` (WKT2);
3. **metre-based** — the definition carries a linear unit named metre/meter with conversion factor
   exactly 1 (`UNIT[...]` in WKT1, `LENGTHUNIT[...]` in WKT2). The nested geographic CRS's angular
   unit ("degree", factor 0.0174…) never matches, so its presence inside a `PROJCS` does not make
   the CRS look metric. A projected CRS in feet (EPSG:2225, EPSG:2263) is refused;
4. **usable** — `ST_Transform` can actually build a transform for it. The probe runs *out of* the
   candidate CRS from its own origin, not into it from a fixed lon/lat: a lon/lat point is only
   valid inside a CRS's area of use, and `(0,0)` lies outside UTM 17S, so probing that way would
   have rejected the pilot's own CRS. A projected CRS's origin is always inside the projection's
   mathematical domain, which asks PROJ the question we actually have.

This lives in two places, both reading the same catalogue and neither parsing a projection:

- `app.srid_is_registered(integer)` and `app.srid_is_metric_projected(integer)` (migration 0012),
  with the `spatial_dataset_version_crs_valid` constraint trigger underneath every write. They are
  plain SECURITY INVOKER functions, because `spatial_ref_sys` is world-readable and no privilege
  needs borrowing; `public` is deliberately absent from their `search_path` since every reference
  is schema-qualified;
- `assertAnalysisSridUsable` / `assertSourceSridUsable` in `packages/application/src/gis/`, so a
  caller gets a sentence naming the CRS and the consequence rather than a PostGIS exception, and
  so a long import fails at its start rather than at its last insert.

`source_srid` carries **no** projection or unit requirement — an official package delivered in a
geographic CRS is normal. It must only be registered, or the transform to canonical storage cannot
be explained afterwards.

### The supported contract, and what is future work

The analysis-CRS contract is **projected + metre-based**, because the stored columns are metres and
square metres (`area_m2`, `affected_area_m2`, `length_m`, `chainage_m`, `frontage_m`). Supporting a
non-metric projected CRS would mean carrying the unit alongside every measurement and converting at
every boundary; it is future work, and only if a real project requires it. Until then such a CRS is
refused rather than silently reinterpreted.

## Which CRS owns which measurement (IG2-009)

A measurement belongs to the dataset whose measurement it is. In the pilot all layers share one
analysis CRS, so the rule is invisible; an official import can bring parcels in one CRS and an
alignment in another, and then it is the only thing preventing a road being measured with a parcel
layer's ruler.

| Measurement | CRS used | Read from |
|---|---|---|
| Alignment length, and every chainage along it | the **alignment** dataset's `analysis_srid` | the alignment's own version row |
| Parcel area | the **parcel** dataset's `analysis_srid` | that geometry's version row |
| Affectation area | the **affectation** dataset's `analysis_srid` | that affectation's version row |

Chainage projects the parcel centroid into the *alignment's* CRS before locating it on the line, so
both sides of the measurement live in one coordinate system. An integration test gives an alignment
and a parcel layer deliberately different valid metric CRS — UTM 17S and World Equidistant
Cylindrical, which measure the same line as 11 107,7 m and 11 131,9 m — and asserts the chainage
follows the alignment's.

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
  SRIDs from the old `source_crs` text, and drops that column. Migration 0012 is likewise
  forward-only: it drops 0011's two numeric CHECKs and replaces them with the catalogue-backed
  functions and trigger. Migrations 0009–0011 are not rewritten; they were already applied to
  staging.

## What this decision does not do

It does not introduce a CRS engine, a coordinate-system editor, a per-SRID table, a curated EPSG
list, a projection parser, or any external service. It is two integers of metadata, two predicates
over a catalogue PostGIS already ships, and `ST_Transform`.
