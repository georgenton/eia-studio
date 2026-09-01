# Testing strategy

> Defines the test suites future slices must implement. None exist yet. The cross-tenant and
> authorization suites are **release gates**: CI fails the build when any of them fails.

## 1. Layers and tooling

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Vitest | pure functions: capability resolver, permission resolver, forecast arithmetic, frequency/cross-tab calculators, locator validation, deidentification scrubbers, copy linters | every push |
| Domain | Vitest + in-memory repositories | use-cases and aggregate invariants (state machines, immutability rules) with `RequestContext` for tenant A/B | every push |
| Integration / DB | Vitest + Testcontainers (Postgres with PostGIS + pgvector), real migrations | repositories, RLS policies, composite FKs, triggers, job handlers | every push (parallel) |
| Cross-tenant attack suite | Vitest + Testcontainers, dedicated harness in `packages/testing` | every server entry point and job exercised with a foreign context | every push, **gate** |
| API / server actions | Vitest with a Next.js test harness (request → action) | validation, context building, capability and permission enforcement, error → state mapping | every push |
| E2E | Playwright | connected flows from the prototype; the 15 states | nightly + pre-release |
| Visual regression | Playwright screenshots vs the 11 goldens (masked dynamic regions, perceptual tolerance) | shell, Command Center, GIS, Parcel, Social (2), Quality (2), Portal, Tenant modules, states gallery | nightly + pre-release |
| Performance smoke | k6 or Playwright timing | GIS layer load, queue navigation, portal TTFB | pre-release |

Fixtures for tests are generic factories (`tenantA`, `tenantB`, `projectX`, `projectY`,
`userAdminA`, `userViewerB`, `clientGrantX`). Zamora fixtures are used only for scenario tests
that need the four Quality Gate cases, referenced by rule key, not by project name.

## 2. Unit and domain tests

- Capability resolution: truth table over PRODUCT_AVAILABLE × ENTITLED × TENANT_ENABLED ×
  PROJECT_ENABLED × dependencies yields a boolean; project override cannot enable; a module with
  navigation presentation ANNOUNCED resolves to `disabled` and `requireCapability` throws for it
  (D-014); presentation values never reach the authorization layer (type test).
- Configuration registry: reading a key of a disabled capability throws; invalid values rejected.
- Permission resolution: role tables; OWNER implicit project access (audited on PII); ADMIN has
  no project data access without membership; MEMBER has no admin permissions; no `CLIENT` project
  role exists (D-015); PII policy.
- Provenance label derivation: the mapping from facets to the four v0.2 badges follows the
  precedence in PROVENANCE.md §2.6 for every combination (property test), and DEMO regime always
  wins.
- Identity boundary: authorization tests run with a fake identity provider that only supplies
  `userId`; no test may depend on identity-provider roles (D-016).
- Forecast: given a daily series and pending count, result matches the hand calculation; window
  and assumptions are echoed; unsynced records excluded.
- Frequencies and cross-tabs: only validated codings counted; base `n` reported; taxonomy
  version echoed.
- Finding state machine: every transition requires a justification; forbidden transitions throw.
- Immutability: updating an `Answer` after submit, an `AIClassification`, a published
  `SurveyVersion` or `TaxonomyVersion` throws (domain) and is rejected by the DB (trigger).

## 3. Database and RLS tests

For every table in the provenance/RLS registry:

- with tenant A context: sees only A rows; insert with `tenant_id = B` rejected by `WITH CHECK`;
- with no context settings: sees zero rows, inserts rejected;
- project-scoped tables with `app.project_id = X`: rows of project Y invisible even within the
  same tenant;
- PII schema invisible unless `app.pii_access = on`;
- portal role: cannot `SELECT` from `app.*`, can read only `portal.publication`;
- composite FK: inserting a parcel referencing project Y of tenant B while carrying tenant A fails;
- pooling: two sequential transactions on the same connection do not leak settings.

A schema test asserts that every table in `app`, `pii`, `vec`, `portal` has RLS enabled and forced
and at least one policy; and that every provenance-bearing table has `provenance_id NOT NULL`.

## 4. Authorization and capability enforcement tests

Generated from the catalogue and permission registry:

- for each server action/route handler: called with a context lacking the required permission →
  `PermissionDenied`; lacking the capability → `FeatureDisabled`; with both → success path.
- for each job handler: enqueue and run with a context whose capability is disabled → refused
  and audited.
- role assignment: member cannot assign; admin cannot grant owner; last owner cannot be removed;
  invitation outside allowed domains requires approval.
- payload tampering: `project_id`/`tenant_id` in bodies that differ from context → rejected;
  unknown fields → rejected (`strict()`).

## 5. Cross-tenant attack suite (release gate)

Harness: seed tenant A and tenant B with one project each, both with the full pilot profile,
identical data shapes. For **every** read model, use-case, server action, route handler,
presigned-URL issuer, retriever and job:

1. call as A with ids belonging to B → no data / `PermissionDenied`, and an audit entry;
2. call as A's viewer role for project Y of A they are not assigned to → denied;
3. call as B's client grant user against internal entry points → denied at the surface boundary;
4. vector search as A with query text that would match B's chunks → zero B results;
5. storage: request a presigned URL for a B key → denied; a leaked B key used with A's session →
   denied at issuance (no URL exists);
6. jobs: enqueue a job with A context and payload ids from B → handler finds nothing, writes
   nothing, records the attempt.

The suite iterates the registry of entry points so that a new action without registration fails a
"coverage" assertion.

## 6. Background job tests

- Idempotency by run id; retry after failure does not duplicate rows.
- Job context builder refuses payloads without tenant id.
- Long imports write progress readable by the `syncing` state.
- Retention job anonymises only tenants whose policy is due and records provenance.

## 7. GIS import and provenance tests

- Import of an alignment layer creates a dataset version with the declared layer provenance;
  supersession chain is correct; previous version remains readable for history.
- Replacing a reconstructed alignment with an official one recomputes linear references with a
  `DERIVED` record and leaves parcel ids untouched.
- Parcel geometry matching reports matched/unmatched counts (drives `partial GIS`).
- Area and abscissa computed in the project CRS; a project without CRS configured cannot import
  geometry (typed error).
- Every map read model includes the facets needed to derive the legend key.

## 8. Survey versioning tests

- Publish v1, create 40 instances, publish v2: v1 instances still resolve their questions and
  answers unchanged; v2 instances use v2 questions.
- Attempt to edit a published version → rejected.
- Aggregation across versions requires a `QuestionMapping`; without it the metric reports
  per-version bases.

## 9. PII tests

- PII-flagged answers land in `pii` tables and not in `app.answer`.
- Read models for analytics and portal contain no PII columns (schema assertion + row assertion
  with sentinel values such as a unique fake phone number that must never appear in any
  non-PII output, log line, span attribute or error report).
- `ai` ports reject non-deidentified inputs at compile time (type test) and at runtime (guard).
- Deidentification scrubber removes sentinel names/phones/IDs from free text; the run records
  counts.
- PII read and export write audit entries with reason.

## 10. AI / HITL tests

- Classification run creates immutable rows with provider/model/prompt/taxonomy version and
  thresholds snapshot; labels match thresholds.
- Accept/modify/new-category/reject produce `HumanReview` rows and update `AnswerCoding`; raw
  `AIClassification` unchanged.
- Low-confidence outcome yields no preselected category and candidate list (state 15).
- Provider unavailable yields state 14 and manual coding still works.
- Second-opinion and disagreement statuses computed correctly.
- Category proposal approval creates a new draft taxonomy version; published versions unchanged.
- Copy lint: forbidden score phrases absent.

## 11. Quality Gate tests

- Each rule (numeric cross-doc, territorial reference, temporal plan vs report, legal vs social
  contrast, media completeness, document completeness, geo abscissa tolerance) has scenario tests
  producing a finding with Source A/B evidence locators and permitted language.
- Re-running a rule with unchanged inputs does not duplicate findings (fingerprint); changed
  inputs reopen.
- Decisions without justification are rejected; state transitions per ADR-008.
- Interdisciplinary flag set by the legal-vs-social rule.
- Copy lint: forbidden compliance phrases absent from templates and stored findings.

## 12. Client portal tests

- Publication projection validated against the allowlist; a projection containing any forbidden
  key fails validation.
- Denylist sentinel test: seed identified data, raw classifications, findings, audit entries and
  parcel codes; render the portal and the PDF; assert none of the sentinels appears.
- Portal session cannot access internal routes; internal session cannot access the portal without
  a grant (or, for internal users, only via the explicit "Client Portal" link with their own
  internal role, rendered as the portal projection).
- Forecast absent by default (`client.portal.show_forecast = false`); when on, only an
  explicitly published `ForecastSnapshot` appears, with provenance, calculation time,
  assumptions/version and projection wording; publishing a `DEMO_SIMULATION` snapshot is
  rejected regardless of configuration (D-019).
- Privacy metadata (D-018): every PII-flagged dataset has a data inventory entry, purpose and
  retention policy; `ai` adapters refuse unregistered vendors; the production readiness gate
  check fails when real PII ingestion is enabled without a recorded compliance review reference.
- Withdrawn publication returns the portal's empty state.

## 13. E2E and visual regression

Connected flows (README "Interactions & Behavior"):

1. Command Center → attention row → GIS → select row → polygon highlighted → panel → "Abrir
   Parcel Workspace" → Quality tab → "Ver hallazgo" → finding detail → "Volver a la bandeja".
2. Command Center → social alert → queue → `J`/`K` → `A` accepts → row becomes VALIDADA →
   session counter increments → reload keeps it (persisted).
3. Provenance drawer opens from every listed invocation point and closes via overlay, ×, Esc.
4. Command palette ⌘K / Ctrl+K → destinations → Esc.
5. Tenant Settings › Módulos toggle off `social.ai_coding` → rail item disappears for the
   project, direct link renders `feature disabled`, server action returns `FeatureDisabled`.
6. Each of the 15 states rendered in its container with the approved copy.

Visual regression: one baseline per golden screenshot at 1440 px, masks for timestamps, counters
and map tiles, tolerance tuned to catch drift of hierarchy/density/colour, not sub-pixel
differences. Screenshots are references; failing a baseline prompts a review, not a CSS change to
match pixels.

## 14. Quality bar for "done"

A slice is complete only when: lint, typecheck, unit, domain, integration (incl. RLS and the
cross-tenant suite) pass in CI; new entry points are registered in the enforcement registry; new
tables are in the RLS/provenance registries; ADRs updated when a decision changed.
