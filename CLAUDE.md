# CLAUDE.md — EIA Studio

EIA Studio is a multi-tenant B2B SaaS for environmental consulting firms: field capture, parcels,
surveys, social analysis with human-in-the-loop AI, quality review and client reporting.

**Current phase: SLICE 2 (GIS / Parcel Explorer and Parcel Workspace) IMPLEMENTED ON
`feat/slice-2-gis-parcel-workspace`, PENDING IMPLEMENTATION GATE 2.** Slice 0 (SaaS foundation),
Slice 0.5 (staging foundation) and Slice 1 (product shell, Portfolio, Command Center, provenance
drawer) are merged into `main`; Implementation Gates 0 and 1 and Staging Gate 0.5 are closed.
Slice 2 makes GIS a real surface: the Parcel Explorer (map and table sharing one selection, faceted
filters, layer-provenance legend), the Parcel Workspace, the Command Center's territorial summary,
and their persistence (`spatial_dataset`, `spatial_dataset_version`, `alignment`, `parcel`,
`parcel_geometry`, `affectation`) with PostGIS geometry stored in a metric CRS. The corridor and
its 141 parcels are **deterministically generated and labelled SYNTHETIC**; the official GIS
package has not been received and its import is specified in `docs/GIS_IMPORT_CONTRACT.md`, not
built. See `docs/SLICE_2_REPORT.md` (and `docs/SLICE_1_REPORT.md`) for what was built, what was
deliberately omitted and every deviation from the design bundle. FieldFlow, Social Intelligence,
Quality Gate, RAG, Reports and the Client Portal are **not** implemented; their routes exist only
as capability-guarded placeholders. Staging is live for preview only; do not deploy production.

## Read before acting

Approved design bundle (source of truth; precedence: README → prototype → spec v0.2 → screenshots):

- `design/reference/claude-design-v0.2/README.md` — contract and 14 invariants
- `design/reference/claude-design-v0.2/EIA Studio.dc.html` — interactive prototype (behaviour)
- `design/reference/claude-design-v0.2/Arquitectura y Lenguaje Visual.dc.html` — spec v0.2 (rules)
- `design/reference/claude-design-v0.2/screenshots/` — golden visual references (not pixel specs)

Architecture documentation:

@docs/PRODUCT.md
@docs/ARCHITECTURE.md
@docs/TENANCY.md
@docs/FEATURES.md
@docs/SECURITY.md

Also relevant by task: `docs/DATA_MODEL.md`, `docs/PROVENANCE.md`, `docs/AI_GOVERNANCE.md`,
`docs/DEMO_ZAMORA.md`, `docs/DESIGN_SYSTEM.md`, `docs/TESTING_STRATEGY.md`,
`docs/GIS_IMPORT_CONTRACT.md`,
`docs/IMPLEMENTATION_PLAN.md`, `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`, the delivery docs
`docs/ENGINEERING_STANDARDS.md`, `docs/RELEASE_POLICY.md`, `docs/CI.md`, `docs/DEPLOYMENT.md`,
`docs/DEPENDENCIES.md`, `docs/TECH_DEBT.md`, the Gate record `docs/DECISIONS/GATE-1.md`, and
the ADRs in `docs/DECISIONS/ADR-001` … `ADR-014`. Root `README.md` has the local quick start.

## Working rules for every session

1. **Read the relevant docs and ADRs before any architectural change.** If a change contradicts
   an ADR, write or amend an ADR first (status Proposed) and say so in the summary.
2. **Inspect existing code before making claims or changes.** Do not describe files, functions
   or behaviour you have not opened in this session.
3. **Never hardcode Zamora.** The pilot project name, province, customer, consultant names, the
   figures 7.4 / 141 / 119 / 185, and "road" as the universal project type belong in
   `fixtures/` and project datasets, never in `packages/domain`, `apps/*` or `packages/ui`.
4. **Always preserve tenant and project context.** Use-cases take a `RequestContext` or
   `JobContext`; identifiers in payloads are validated against the context, never trusted.
   Every new table carries `tenant_id` (and `project_id` when project-scoped), RLS policies and
   the composite FK; register it in the RLS registry.
5. **Use centralised capability resolution.** Read the boolean `CapabilitySet` from the
   context; never add ad-hoc booleans. Navigation presentation (ACTIVE / ANNOUNCED / HIDDEN) is
   shell-only and never authorizes anything; an ANNOUNCED module is disabled. The catalogue holds
   exactly the 14 approved keys. Configuration ≠ capability.
6. **Enforce authorization server-side.** Every server action, route handler and job calls
   `requireCapability` and `requirePermission`. Hiding a nav item is not authorization.
   Authorization comes from EIA Studio memberships, roles and permissions, never from the
   identity provider's organisation roles (Better Auth supplies `userId` only).
7. **Preserve provenance.** Anything shown as a figure, layer, record, classification, finding
   or report section has a `provenance_id` whose record carries the four facets: regime, origin,
   transformations, granularity. The four v0.2 SOURCE TYPE badges are derived labels, not stored
   values. Derived values are produced by runs with method text and input edges. Synthetic data
   is never re-labelled.
8. **Never send identified PII to an LLM without the approved deidentification path.** `ai`
   ports accept only `Deidentified<T>` produced by the gateway; do not add bypasses "for a demo".
9. **Preserve original survey answers.** Answers are immutable after submission; corrections are
   new visits/instances. Never edit an answer, not even spelling.
10. **Keep AI classification separate from human review.** `ai_classification` is insert-only;
    `human_review` is append-only; analytics read only validated codings; scores are model scores
    with High/Medium/Low labels, never probabilities.
11. **Write tests** with every change: unit/domain for logic, integration for DB/RLS, and add new
    entry points to the cross-tenant attack harness and enforcement registry.
12. **Run lint, typecheck and tests before declaring work complete**, and report the actual
    output. If something failed or was skipped, say so.
13. **Document intentional technical debt** in `docs/TECH_DEBT.md` with owner and removal
    trigger; do not leave it only in code comments.
14. **Create or update an ADR when changing an architectural decision**
    (`docs/DECISIONS/ADR-NNN-slug.md`, same template as the existing ones).
15. **Never weaken isolation or security to simplify a demo.** No RLS bypass roles in app
    config, no "temporary" cross-tenant queries, no PII in fixtures, no synthetic values without
    regime, no portal reads of operational tables, no forecast in the portal unless explicitly
    published under `client.portal.show_forecast`, no real personal data before the compliance
    gate (`docs/SECURITY.md` §10a). Do not write legal conclusions into code or docs.

## Delivery rules (Git, releases, CI, deployment) — see `docs/ENGINEERING_STANDARDS.md`

16. **Work on a feature branch**, never directly on `main`: `feat/*`, `fix/*`, `chore/*`,
    `docs/*`, `refactor/*`, `test/*`. Changes reach `main` only through a pull request that is
    squash-merged. Commit or push only when the user asks.
17. **Use Conventional Commits** for commit messages and PR titles (`type(scope): subject`,
    scopes listed in `docs/ENGINEERING_STANDARDS.md` §3). Add the `Tenancy-impact:` and
    `Schema-impact:` footers when relevant.
18. **Add a Changeset** (`pnpm changeset`) when a change is release-visible (behaviour, UI,
    entry points, schema, configuration keys, catalogue, fixtures). Docs-only, ADR, CI/tooling,
    test-only and invisible refactors need none; say so in the PR.
19. **Never bypass CI or branch protection.** Do not use `--no-verify` to get a failing check
    through, do not force-push to `main`, do not disable required checks. Fix or revert.
20. **Never deploy production** without an explicit user instruction in the conversation.
    Staging deploys from `main` automatically once enabled; production is manual and gated
    (`docs/DEPLOYMENT.md` §6). Never store secret values in the repository; names only.
21. **Document schema/migration effects** of every change: migration ids, RLS policy changes,
    backfills and rollback notes, in the PR description and, when durable, in the ADR or
    `docs/TECH_DEBT.md`.
22. **Report tenancy and security impacts in every PR summary**: new entry points and their
    capability/permission checks, new tables' tenancy columns/RLS/composite FK, harness
    coverage, PII/audit/portal effects. "None" must be stated explicitly, never implied.
23. **Keep the stack minimal**: no Prisma beside Drizzle, no TanStack Router/Start, no Redis,
    event bus, Kubernetes, microservices or extra API service without an ADR that names the
    slice requirement (ADR-012, ADR-013, ADR-014).

## Product language rules (lint-enforced later)

- Model scores: allowed "model score 0,86 · confianza Alta"; forbidden "% de acierto",
  "precisión del", "probabilidad calibrada".
- Quality Gate: allowed "possible inconsistency", "missing information", "potential mismatch",
  "insufficient evidence", "specialist review required"; forbidden "incumplimiento",
  "infracción", "error detectado", "no conforme", "el sistema determina".
- Disabled modules never appear greyed-out or padlocked; direct links render the
  `feature disabled` state.
- Every map, including thumbnails, shows the state legend and the layer-provenance legend.

## Conventions (to apply once implementation is approved)

- TypeScript strict; pnpm workspace; modules under `packages/domain/<module>` with a public
  `index.ts`; no imports of a sibling module's internals (ESLint boundaries).
- UUID v7 ids; business identifiers are separate unique columns per project.
- Zod `strict()` schemas at every boundary; server actions are thin (validate → context →
  use-case).
- Spanish (`es-EC`) is the default locale; user-facing copy lives in message catalogues.
- Tokens and components from `packages/ui`; never inline hex values or screenshot pixel widths.
- Drizzle ORM only (schema in Drizzle, RLS/PostGIS/pgvector in reviewed SQL migrations,
  ADR-013); Next.js App Router with selective TanStack Table/Query/Virtual/Form per ADR-014.
- Husky + lint-staged (`pre-commit`), commitlint (`commit-msg`), light optional `pre-push`;
  the full suite runs in GitHub Actions (`docs/CI.md`).

## When the phase changes

Implementation begins only with slice 0 of `docs/IMPLEMENTATION_PLAN.md`, after the architect
gives an explicit go (to be appended to `docs/DECISIONS/GATE-1.md`). Update the "Current phase"
line above when that happens. Hosting is decided before staging; the compliance review is a
production readiness gate.
