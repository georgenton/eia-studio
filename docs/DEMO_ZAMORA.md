# The Zamora pilot: how the first real project enters the system without shaping the core

> The project "Vía Puente del Amor – Los Hachos" (Zamora Chinchipe, Ecuador) is a **completed**
> road EIA and the only real project. This document explains what is real, what is synthetic,
> where each piece will live, and the rules that keep all of it out of the core.

## 1. What is real, what is not

> **Superseded in part by the real-data wave (4 September 2026).** The cartography, the chainages
> and the management plan now come from the consultancy's own delivery (ADR-023, ADR-024), so the
> rows that described generated geometry are no longer true. The current, surface-by-surface
> version of this table is **`docs/ZAMORA_WORKSPACE.md`**; what follows is kept in step with it and
> the two must not disagree.

Provenance facets per PROVENANCE.md §2 (D-013); the last column is the derived v0.2 badge, whose
Spanish wording is in `docs/PRODUCT_LANGUAGE_ES.md` (ADR-025).

| Item shown in the workspace | Nature | Regime | Origin | Transformation | Granularity | Derived badge |
|---|---|---|---|---|---|---|
| Road length, roadside parcel count, socioeconomic survey count, consultation participants | Real aggregate figures from the finished study | HISTORICAL_OBSERVED | IMPORTED_DOCUMENT | [ORIGINAL] | AGGREGATE | Dato histórico |
| Official study title and programme reference | As written on the terms of reference | HISTORICAL_OBSERVED | IMPORTED_DOCUMENT | [ORIGINAL] | (n/a) | none (project record) |
| Consultation assemblies (four minutes, attendance) | Real documents of the study | HISTORICAL_OBSERVED | IMPORTED_DOCUMENT | [ORIGINAL] | (n/a) | none (document) |
| Base map (hydrography, towns, general location) | **Not implemented.** No base map has been received, so none is drawn and the legend does not claim one (TD-029) | — | — | — | — | legend `REAL_BASE_MAP` reserved, unused |
| Corridor alignment | **The study's own centreline**, imported from the consultancy's geodatabase (`EJE_VIAL`); 7 361,3 m measured by PostGIS against the ~7,4 km the study publishes | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ORIGINAL, ANONYMIZED] | (n/a) | Dato histórico / legend `OFFICIAL_IMPORTED_ALIGNMENT` |
| Parcel polygons (141) | **The study's own survey** (`PREDIOS`), with 18 personal attributes removed before the file entered the repository. Not official cadastre | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ORIGINAL, ANONYMIZED] | INDIVIDUAL | Agregado sin datos personales / legend `IMPORTED_STUDY_LAYER` |
| Affected areas (70 of 71; one names a parcel that does not exist) | The study's delimitation (`AREAS_AFECTADAS`), 19 personal attributes removed | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ORIGINAL, ANONYMIZED] | INDIVIDUAL | Agregado sin datos personales |
| Areas of influence (AID, AII, AISD, AISI) | Delimited by the study; declared in EPSG:32718 and reprojected without altering a coordinate | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ORIGINAL] | AGGREGATE | Dato histórico / legend `STUDY_DELIMITED_AREA` |
| Chainages | The package's own table where it declares one (139 parcels); projected onto the centreline for the 2 it does not | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ORIGINAL] or [DERIVED] | INDIVIDUAL | Dato histórico or Dato calculado |
| Parcel areas and affected shares | Measured by PostGIS over the imported geometry, in the dataset's analysis CRS | HISTORICAL_OBSERVED | IMPORTED_DATASET | [DERIVED] | INDIVIDUAL | Dato calculado |
| Parcel statuses (confirmed / in verification) | **The package's own `ESTADO` column**, not a claim this product makes | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ORIGINAL] | INDIVIDUAL | Dato histórico |
| Management plan: 9 plans, 22 programmes, 86 measures | Cap 11 of the study, read from the delivered `.docx` and stored as written (ADR-024) | HISTORICAL_OBSERVED | IMPORTED_DOCUMENT | [ORIGINAL] | INDIVIDUAL | Dato histórico |
| Visited, revisits, pending, productivity, projected close, activity feed, field inbox | Operational simulation to demonstrate the workflow | DEMO_SIMULATION | SYSTEM_GENERATED | [ORIGINAL] or [DERIVED] | AGGREGATE | Simulación operativa |
| Operational forecast | Deterministic calculation over simulated inputs | DEMO_SIMULATION | SYSTEM_GENERATED | [DERIVED] | AGGREGATE | Simulación operativa (never published to the portal, D-019) |
| The demonstration questionnaire and its answers | Reconstructed for the demonstration; the study's own socioeconomic sheet has not been delivered | DEMO_SIMULATION | SYSTEM_GENERATED | [RECONSTRUCTED] | INDIVIDUAL | Simulación operativa |
| The coding taxonomy | Reconstructed; the consultancy delivered none | DEMO_SIMULATION | SYSTEM_GENERATED | [RECONSTRUCTED] | (n/a) | Simulación operativa |
| Document excerpts in the corpus | Short passages transcribed by hand from the study; the PDFs are not in this repository | HISTORICAL_OBSERVED | IMPORTED_DOCUMENT | [RECONSTRUCTED] | (n/a) | Dato calculado |
| Quality Gate findings | Contrasts between two sources of the study, read by hand from the corpus | HISTORICAL_OBSERVED | SYSTEM_GENERATED | [DERIVED] | (n/a) | Dato calculado |
| Membership table in Tenant Settings | Synthetic identities on a reserved invalid domain | DEMO_SIMULATION | SYSTEM_GENERATED | [ORIGINAL] | INDIVIDUAL | n/a |

The four expedient demonstration cases for the Quality Gate:

1. numerical: 70 vs 71 affected parcels between the social report and the affectation annex;
2. cross-document: an inherited reference to another jurisdiction (Pichincha) in the legal
   framework of a project in another province;
3. temporal: planned time vs executed time of a consultation assembly (possible undocumented
   rescheduling);
4. interdisciplinary: legal conclusion vs social data on vulnerable population
   ("Specialist interdisciplinary review required").

## 2. Where Zamora lives in the repository

```
fixtures/
  projects/
    zamora-puente-del-amor/          # everything project-specific, never imported by core
      manifest.json                  # tenant slug, project slug, profile key + version, regime flags
      historical/                    # REAL_AGGREGATE facts + document references (no PII)
      documents/                     # placeholders / references to the real expedient (no PII in repo)
      gis/
        base-map.*                   # REAL_BASE_MAP references (tile source, bbox)
        alignment.reconstructed.geojson
        parcels.synthetic.geojson    # generated polygons, flagged SYNTHETIC
      surveys/
        social_v2.template.json      # instrument definitions (versions), no responses with PII
        answers.anonymized.json      # anonymised open answers used by the demo queue
      taxonomy/
        social-expectations.v4.json
      quality/
        demo-findings.json           # the seven findings, with their evidence locators
      ops-simulation/
        ops_metrics_demo.json        # synthetic operational metrics, regime DEMO_SIMULATION
      portal/
        milestones.json, deliverables.json, activities.json
  tenants/
    demo-consultancy/                # synthetic tenant + memberships (badge DEMO)
```

### 2.1 What Slice 1 actually loads

The layout above is the target shape. As of Slice 1 the directory contains exactly one file:

```
fixtures/projects/zamora-puente-del-amor/manifest.json
```

It holds the four approved historical aggregates (corridor length, roadside parcels,
socioeconomic surveys, consultation participants), the demo operational metrics the Command
Center composition needs, the forecast inputs, the attention queue and the activity feed — and a
`safetyClassification` block that states, in the fixture itself, that it contains no personal
data and lists what it excludes. The GIS, survey, taxonomy, quality and portal directories arrive
with their own slices.

It is loaded by `pnpm db:seed:demo-project`, which is a **generic** project-fixture loader:
the pilot directory is named on the command line (`--fixture <dir>`), so no pilot constant lives
in `packages/` or `apps/` (rule 1, enforced by `tooling/scripts/check-forbidden-strings.mjs`).

Two things the loader does deliberately:

- **The forecast is computed, not copied.** The manifest carries the *inputs* (pending count,
  daily completions, window, target date, technicians, assumptions); the loader runs the domain
  algorithm and stores the result. A figure on the screen therefore always follows from the
  stored inputs (invariant 5).
- **Every row names its provenance record**, and the loader refuses to start if any value points
  at a record the manifest does not define. There is no default provenance and no way to insert
  a metric without one: `provenance_id` is `NOT NULL` in the schema.

Loading is done by an **import** (an `ImportRun` per fixture file) that stamps every created
record with a provenance record whose facets (regime, origin, transformations, granularity) come
from the fixture manifest.
Nothing in `packages/domain` or `apps/web` references these files. The name of the tenant,
project, province and customer appear only inside fixture data.

## 3. Rules

1. **No Zamora constants in core.** Forbidden in reusable code: the project name, the province,
   the customer, any consultant name, the figures 7.4, 141, 119, 185, and "road" as the universal
   project type. Enforced by `tooling/scripts/check-forbidden-strings.mjs` (part of `pnpm lint`
   and of the pre-commit hook) and by code review. The check scans `apps/` and `packages/`; it is
   the reason the fixture directory is passed to the loader as an argument rather than written
   into the script.
2. **Regime travels with the data.** Every record created from a fixture inherits the regime of
   its `ImportRun`. Synthetic values can never be re-labelled as historical by a UI or an export.
3. **The demo badge is derived, not hand-placed.** The `DEMO / SYNTHETIC` badge appears when any
   value composing a block has regime `DEMO_SIMULATION`; it is not a boolean in the component.
   The prototype's `showDemoBadges` prop is a preview toggle only and has no production
   equivalent.
4. **Anonymised is not synthetic.** Open answers and closed-variable frequencies are real,
   de-identified data (regime HISTORICAL_OBSERVED, transformation includes `ANONYMIZED`), and the
   pipeline that produced them must be documented as an ImportRun with method "anonymised by X on
   date". Demo data stays synthetic, anonymised or aggregated unless explicitly approved
   otherwise (D-018).
5. **The reconstructed alignment is replaceable.** When the official GIS arrives, a new
   `ImportRun` creates a new spatial dataset version (`OFFICIAL_IMPORTED_ALIGNMENT`); parcels keep
   their identity and their linear references are recomputed with provenance (see
   PROVENANCE.md §Spatial).
6. **Fixtures are not tests.** Tests use small, generic factories (tenant A / tenant B, project X
   / project Y). Zamora fixtures are used only for demo seeding and for a small set of
   scenario tests that exercise the four Quality Gate cases through generic rule ids.
7. **No PII in the repository.** The real expedient contains names, signatures and phone numbers
   (assembly minutes, survey sheets). The repo holds references and anonymised derivatives only;
   identified data is imported at runtime into the PII store under the tenant's control.

## 4. Known prototype artefacts that must not become behaviour

The full list of design-bundle known issues recorded at Gate 1 is in
`docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`. The ones that affect the demo:

- The Client Portal milestone note contains "cierre proyectado 24 sep", which is a synthetic
  forecast value shown on the client surface without a DEMO mark. Spec decision 09 forbids
  synthetic data in client views without its mark. Gate 1 D-019: `client.portal.show_forecast`
  defaults to false; when a project enables it, only explicitly published `ForecastSnapshot`s
  with provenance, calculation time, assumptions/version and projection wording may appear, and
  a `DEMO_SIMULATION` forecast may never be published as real client progress. The prototype's
  text is a fixture artefact.
- Parcel codes (`PRED-ZAM-042`) embed a project abbreviation. `parcel_code` is a business
  identifier whose format is a **project configuration** (prefix pattern), never a parsing rule.
- The `road_eia_social` template card says "7 módulos · 1 instrumento · 5 quality checks", while
  the Command Center header shows eight capability chips and Tenant Settings shows eleven
  included modules. The profile definition in FEATURES.md uses the phase brief's list of eleven
  enabled capabilities; the "7 módulos" figure is a counting artefact of the prototype.

## 5. Demonstration acceptance (later)

The demo is "correct" when a reviewer can, on the seeded project:
- see every synthetic block badged and every real aggregate figure un-badged with a green
  `REAL_AGGREGATE` provenance;
- open "Ver origen" on the projected close and read the exact arithmetic and assumptions;
- run the coding queue, validate an answer, and see it counted only after validation;
- open the four expedient findings and see Source A / Source B with document locators;
- open the Client Portal and find no parcel code, person, phone, income, vulnerability, internal
  note, raw AI classification or Quality Gate content.
