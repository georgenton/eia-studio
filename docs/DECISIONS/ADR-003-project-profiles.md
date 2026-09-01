# ADR-003 — Project profiles and the territorial extension model

- Status: Accepted at Gate 1 (no specific conditions raised; see GATE-1.md)
- Date: 2026-09-01
- Related: FEATURES.md §5, DATA_MODEL.md §3.3, ADR-002

## Context

Projects are created from reusable profiles/templates. The first profile, `road_eia_social`,
models a road corridor: alignment, segments with abscissa ranges, roadside parcels with abscissa
and side, parcel affectations. Future environmental studies (mines, pipelines, hydro, facilities)
may have parcels but not roads, or zones but not parcels, or neither. The core must assume none
of Road, Parcel-with-abscissa, or Segment, without becoming a generic meta-platform for unknown
industries.

## Decision

1. **ProjectProfile is a versioned template with snapshot semantics.** Creating a project copies
   the profile's capability settings, configuration defaults, instrument templates, taxonomy
   seeds, quality rule set, milestone template and territorial model into the project; the
   project records `profile_key` + `profile_version`. Editing a profile never changes existing
   projects. Tenants may duplicate system profiles into tenant-owned ones ("Duplicar plantilla").
2. **Core territorial concepts are few and stable**: `Project`, `ProjectUnit` (named sub-area of
   a kind: segment, sector, zone, site; optional geometry), `Parcel` (territorial unit of
   analysis with optional geometry and a business code), plus `Visit`, `SurveyInstance`, `Media`,
   `Document`, `Finding` which reference parcels/units by id.
3. **Profile families add typed extension tables**, activated by the profile and guarded by
   `gis.*` capabilities. The `linear_infrastructure` family adds `Alignment`, `LinearReference`
   (parcel → abscissa, side) and `Affectation`/`AffectationItem`. Extensions declare their own UI
   columns/tabs (abscissa column, Afectaciones tab) so the parcel screens do not hardcode them.
4. **Minor profile-specific attributes** live in a validated `attributes jsonb` on `Parcel` and
   `ProjectUnit`, with the JSON schema declared by the profile. Anything queried, joined or
   computed gets a real column in an extension table.
5. **"Road" is not a module** and not a project type constant in core code. The pilot profile
   may specialise in roads; core code refers to `ProjectUnit.kind` and extension presence only.
6. **First profile** `road_eia_social` enables: core.projects, core.documents, gis.maps,
   gis.parcels, field.surveys, social.analytics, social.ai_coding, quality.document_gate,
   quality.rag_assistant, reports.social_generator, client.portal; disables climate.analytics,
   compliance.pma, audit.environmental.

## Consequences

- A second profile (e.g. a site facility) can be created without touching core tables: new
  family extension tables, new instrument templates, new rules.
- The parcel state read model, the GIS explorer and the Parcel Workspace must be written against
  core + extension descriptors, which costs some indirection in slice 2.
- Profile versioning adds a small maintenance duty (bump version on change) and gives provenance
  for "which template built this project".
- The prototype's template card ("7 módulos · 1 instrumento · 5 quality checks") is inconsistent
  with the eleven enabled capabilities; the eleven-capability definition is adopted and the card
  copy is a fixture artefact.

## Alternatives rejected

- Everything modelled around roads: cheapest for the pilot, blocks the second customer.
- Generic entity–attribute–value or "unit of analysis" meta-model: expensive, untyped,
  unqueryable, and it designs for industries not yet known.
- One module per industry ("road", "mining"): duplicates parcels/visits/surveys per industry.
