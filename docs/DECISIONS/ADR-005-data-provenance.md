# ADR-005 — Data provenance: run-level records, single FK, lineage edges

- Status: Accepted with conditions at Gate 1 (decision D-013 applied, D-019 referenced)
- Date: 2026-09-01 (amended 2026-09-01 after Gate 1)
- Related: PROVENANCE.md, DATA_MODEL.md §3.8, ADR-008, ADR-009, GATE-1.md

## Context

Provenance is a cross-cutting product requirement (invariants 4, 5, 12, 13): one drawer serves
KPIs, forecasts, layers, parcels, variables, open answers, findings and future reports; every
datum carries a source type; synthetic or reconstructed values are never presented as historical;
the forecast must be reproducible. The prototype also distinguishes layer provenance for maps
(`REAL_BASE_MAP`, `RECONSTRUCTED_ALIGNMENT`, `SYNTHETIC_PARCELS`) which the official GIS will
replace later without rebuilding the project.

Patterns evaluated in PROVENANCE.md §3: columns on every table; central polymorphic table;
run-level provenance with a single FK; event-sourced lineage.

## Decision

1. **A single immutable `provenance_record` table** holding four **facets** (Gate 1 D-013)
   instead of one "source type" enum:
   - `regime`: HISTORICAL_OBSERVED · LIVE_OPERATIONAL · DEMO_SIMULATION (required);
   - `origin`: FIELD_CAPTURE · IMPORTED_DOCUMENT · IMPORTED_DATASET · SYSTEM_GENERATED
     (required, extensible by ADR amendment);
   - `transformations`: ordered list drawn from ORIGINAL · RECONSTRUCTED · DERIVED · ANONYMIZED
     (required; a lineage may accumulate several over time, e.g. `[ANONYMIZED, DERIVED]`);
   - `granularity`: INDIVIDUAL · AGGREGATE · null when not applicable;

   plus: source reference (document version, dataset version, import run or capture reference),
   version label, captured/imported timestamp and medium, one-line method text for derived
   values, calculation run reference, validation status/actor/time, note.
2. **Every provenance-bearing table carries `provenance_id NOT NULL`** referencing that table.
   Runs (`ImportRun`, `CalculationRun`, `ClassificationRun`, `QualityRun`, field sync) create
   records and stamp everything they produce; derived values (KPI snapshots, forecast snapshots,
   metrics, findings) get their own record.
3. **Lineage edges** (`provenance_input`) connect derived records to their inputs so the drawer
   can offer "Ver registros base" and audits can walk the chain to field records.
4. **Facets live on the record** and are fixed by the producing run; read models return
   `Sourced<T> = { value, provenance: {regime, origin, transformations, granularity},
   provenanceId, validation }`; UI components require it, derive DEMO badges from the regime, and
   exports/portal refuse `DEMO_SIMULATION` unless explicitly demo.
5. **The four SOURCE TYPE badges of design v0.2 are presentation, not storage.**
   `REAL_AGGREGATE` · `RECONSTRUCTED` · `ANONYMIZED` · `SYNTHETIC` are derived from the facets by a
   pure mapping table in the UI package (precedence: DEMO regime → SYNTHETIC; ANONYMIZED in
   transformations → ANONYMIZED; last transformation RECONSTRUCTED/DERIVED → RECONSTRUCTED;
   ORIGINAL + AGGREGATE → REAL_AGGREGATE; otherwise no badge). The drawer always shows the raw
   facets beneath the label. Renaming or splitting labels is a design change with no backend
   impact. (Replaces the earlier seven-value "source type" proposal.)
6. **Spatial layers are versioned datasets**; the legend keys (`REAL_BASE_MAP`,
   `RECONSTRUCTED_ALIGNMENT`, `SYNTHETIC_PARCELS`, `OFFICIAL_IMPORTED_ALIGNMENT`, …) are derived
   from dataset kind + facets. A replacement is a new `SpatialDatasetVersion` from a new
   `ImportRun`, superseding the old one; parcel identities persist and linear references are
   recomputed with `DERIVED` appended to their transformations.
7. **Operational forecast** persists `ForecastSnapshot` with algorithm key/version, window,
   input snapshot, assumptions, result and timestamp, under a record with origin
   `SYSTEM_GENERATED`, transformation `[DERIVED]`, granularity `AGGREGATE`, regime inherited from
   its inputs, with input edges. Publication of forecasts to the Client Portal is governed by
   ADR-009 (D-019): off by default, explicit publication only, never `DEMO_SIMULATION`.
8. **Audit and provenance are separate stores** with different purposes and exposure.

## Consequences

- One extra column per table and one record per run: cheap to add, hard to forget (CI registry
  check).
- A record cannot be edited; corrections are new runs with new records, which is the intended
  history-preserving behaviour.
- The drawer is one query; the "Ver origen" link is available wherever a `Sourced` value is
  rendered, which turns invariant 12 into a type rule rather than a review checklist.
- Developers must think in runs (import, calculation, classification) rather than ad-hoc writes;
  the module APIs are shaped accordingly.

## Alternatives rejected

- A single "source type" enum (four values from the spec, or seven values from the phase brief):
  conflates regime, origin, transformation and granularity; forced ad-hoc mappings such as
  "the forecast is RECONSTRUCTED"; rejected at Gate 1 (D-013).
- Columns everywhere: drift, no lineage, per-table drawer code.
- Polymorphic subject table without FKs: no integrity, orphaned or missing provenance
  undetectable.
- Event sourcing: infrastructure far beyond the six-field drawer's needs.
