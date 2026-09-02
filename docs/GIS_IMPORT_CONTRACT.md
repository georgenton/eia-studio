# Official GIS import contract (preparation only)

> **Nothing here is implemented.** Slice 2 generates the corridor and its parcels
> deterministically because the official GIS package has not been received. This document states
> what the importer will need, so that the synthetic layers can be replaced without a schema
> change and without any parcel losing its identity. Read with `docs/DATA_MODEL.md` §3.3,
> `docs/PROVENANCE.md` and ADR-005.

## 1. What replacement means

An import does **not** rebuild parcels. It creates a new `SpatialDatasetVersion`, writes new
`ParcelGeometry` rows against it, names the version it supersedes, and becomes active. The old
version stays queryable, so a figure produced from it remains explainable.

```
SpatialDataset (kind = 'parcels')
  └── parcels_v1   origin=generated  is_active=false  ← what Slice 2 seeds
  └── parcels_v2   origin=imported   is_active=true   supersedes=parcels_v1
```

Consequences the importer must honour:

- `Parcel.id` is never reissued. A parcel matched by `parcel_code` keeps its UUID, and every
  future visit, instrument, finding and media row that points at it stays valid.
- Exactly one active version per dataset and one active geometry per parcel; both are enforced by
  unique partial indexes, so a half-finished import cannot leave two truths on the map.
- Superseded rows are not deleted.

## 2. What an official package must state

| Field | Why it is required |
|---|---|
| CRS (EPSG code) | our storage CRS is a demo assumption; the import declares the real one and geometry is transformed to the project's configured CRS |
| Geometry type per layer | `Polygon` for parcels and affectations, `LineString` for the alignment; multi-part geometry is rejected rather than silently flattened |
| Feature count | reconciled against rows written; a mismatch fails the run |
| Parcel identifier | the business code the package uses, mapped to `parcel_code`; if the package uses cadastral keys of identified persons, they are **not** stored as the code (SECURITY.md §10) |
| Source and date | who produced it and when, recorded on the provenance record |
| Licence or authorisation to use | recorded on the provenance record; the product records, it does not decide |

## 3. Matching rules (to be decided with the first real package)

Three cases, none of which may be resolved silently:

| Case | Proposed handling |
|---|---|
| A code in the package matches an existing parcel | new geometry version, same `Parcel.id` |
| A code exists only in the package | new parcel, `status = estimated`, flagged for review |
| A code exists only in our data | parcel kept, geometry deactivated, `status` unchanged, listed in the run report as unmatched |

An import run reports these three counts before anything is activated. Activation is a separate,
audited decision.

## 4. Provenance the import must write

Every imported version gets a provenance record with the four facets (ADR-005):

- **regime** `HISTORICAL_OBSERVED` or `LIVE_OPERATIONAL`, never `DEMO_SIMULATION`;
- **origin** `IMPORTED_DATASET`;
- **transformations** at least `ORIGINAL`, plus `REPROJECTED` when the CRS differs from storage;
- **granularity** `INDIVIDUAL` for parcel features.

The layer legend then derives to `OFFICIAL_CADASTRE` or `OFFICIAL_IMPORTED_ALIGNMENT` on its own.
There is no field to set, and no path by which synthetic data can be re-labelled as official:
`deriveLayerLegend` returns `SYNTHETIC_PARCELS` for any `DEMO_SIMULATION` regime whatever the
origin claims (asserted in `packages/domain/test/gis.test.ts`).

## 5. Validation the import must pass

- `ST_IsValid` and non-empty on every geometry (already a CHECK).
- Geometry inside the project's declared extent; anything outside fails the run rather than
  landing on a map somewhere else in the world.
- Parcel codes matching `PARCEL_CODE_PATTERN` (already a CHECK).
- Areas recomputed by PostGIS in the storage CRS, never taken from the package's own attributes.

## 6. Where this will run

An import is a **job**, not a request (ARCHITECTURE.md §6): `ImportRun` carries
`{ tenantId, projectId, actor, runId }`, the worker builds a `JobContext` with the same RLS
settings, and progress is written to the run row so the surface can show `syncing`. Nothing about
the import happens inside an HTTP request.

## 7. Open decisions

- Whether the package is uploaded through the product or staged in object storage first.
- Whether affectations arrive with the package or stay derived from the right-of-way strip.
- Whether unmatched parcels are archived or kept visible with no geometry (`partial GIS`).
- The project's real CRS, which the first package settles.
