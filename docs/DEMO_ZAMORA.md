# The Zamora pilot: how the first real project enters the system without shaping the core

> The project "Vía Puente del Amor – Los Hachos" (Zamora Chinchipe, Ecuador) is a **completed**
> road EIA and the only real project. This document explains what is real, what is synthetic,
> where each piece will live, and the rules that keep all of it out of the core.

## 1. What is real, what is not

Provenance facets per PROVENANCE.md §2 (D-013); the last column is the derived v0.2 badge.

| Item shown in the prototype | Nature | Regime | Origin | Transformation | Granularity | Derived badge |
|---|---|---|---|---|---|---|
| Road length, roadside parcel count, socioeconomic survey count, consultation participants | Real aggregate figures from the finished study | HISTORICAL_OBSERVED | IMPORTED_DOCUMENT | [ORIGINAL] | AGGREGATE | REAL_AGGREGATE |
| Consultation assemblies (four minutes, attendance) | Real documents of the study | HISTORICAL_OBSERVED | IMPORTED_DOCUMENT | [ORIGINAL] | (n/a) | none (document) |
| Base map (hydrography, towns, general location) | Real geography | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ORIGINAL] | (n/a) | legend `REAL_BASE_MAP` |
| Corridor alignment (dashed line) | Approximate reconstruction until the official GIS arrives | HISTORICAL_OBSERVED | IMPORTED_DATASET | [RECONSTRUCTED] | (n/a) | RECONSTRUCTED / legend `RECONSTRUCTED_ALIGNMENT` |
| 24 parcel polygons on the map | Generated; not cadastre | DEMO_SIMULATION | SYSTEM_GENERATED | [ORIGINAL] | INDIVIDUAL | SYNTHETIC / legend `SYNTHETIC_PARCELS` |
| Parcel sheet (area, front, use, owner anonymised) | Demo sheet with synthetic values | DEMO_SIMULATION | SYSTEM_GENERATED | [ORIGINAL] | INDIVIDUAL | SYNTHETIC (badge `DEMO · ANONIMIZADO`) |
| Visited, revisits, pending, productivity, projected close, activity feed, field inbox | Operational simulation to demonstrate the workflow | DEMO_SIMULATION | SYSTEM_GENERATED | [ORIGINAL] or [DERIVED] | AGGREGATE | SYNTHETIC |
| Operational forecast | Deterministic calculation over simulated inputs | DEMO_SIMULATION | SYSTEM_GENERATED | [DERIVED] | AGGREGATE | SYNTHETIC (never published to the portal, D-019) |
| Closed-variable frequencies (e.g. main income source) | Aggregates over anonymised individual records | HISTORICAL_OBSERVED | SYSTEM_GENERATED | [ANONYMIZED, DERIVED] | AGGREGATE | ANONYMIZED |
| Open answers in the coding queue | Anonymised original texts | HISTORICAL_OBSERVED | IMPORTED_DATASET | [ANONYMIZED] | INDIVIDUAL | ANONYMIZED |
| Quality Gate findings (four expedient cases + three field cases) | Contrasts drawn from real documents; some field cases simulated | HISTORICAL_OBSERVED or DEMO_SIMULATION per finding | SYSTEM_GENERATED | [DERIVED] | (n/a) | RECONSTRUCTED or SYNTHETIC |
| Membership table in Tenant Settings | Example memberships (badge DEMO) | DEMO_SIMULATION | SYSTEM_GENERATED | [ORIGINAL] | INDIVIDUAL | n/a |

The four expedient demonstration cases for Quality Gate:

1. numerical: 70 vs 71 affected parcels between the social report and the affectation annex;
2. cross-document: an inherited reference to another jurisdiction (Pichincha) in the legal
   framework of a Zamora Chinchipe project;
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

Loading is done by an **import** (an `ImportRun` per fixture file) that stamps every created
record with a provenance record whose facets (regime, origin, transformations, granularity) come
from the fixture manifest.
Nothing in `packages/domain` or `apps/web` references these files. The name of the tenant,
project, province and customer appear only inside fixture data.

## 3. Rules

1. **No Zamora constants in core.** Forbidden in reusable code: the project name, the province,
   the customer, any consultant name, the figures 7.4, 141, 119, 185, and "road" as the universal
   project type. Enforced by a lint rule (string denylist) and code review.
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
