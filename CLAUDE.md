# CLAUDE.md — EIA Studio

EIA Studio is a multi-tenant B2B SaaS for environmental consulting firms: field capture, parcels,
surveys, social analysis with human-in-the-loop AI, quality review and client reporting.

**Current phase: SUSTAINED MVP DEVELOPMENT WAVE (authorised 3 Sep 2026).** Slice 0 (SaaS
foundation), Slice 0.5 (staging foundation), Slice 1 (product shell, Portfolio, Command Center,
provenance drawer), Slice 2 (GIS / Parcel Explorer, Parcel Workspace), Slice 3 (FieldFlow, versioned
questionnaires, typed answers) and **Slice 4 (Social Intelligence / human-in-the-loop)** are merged
into `main`; Implementation Gates 0–4 and Staging Gate 0.5 are closed. The wave continues through
Slice 5 (Quality Gate), Slice 6 (document intelligence + RAG), Slice 7 (assisted report generation)
and MVP integration, self-gated before each merge and logged in `docs/DEVELOPMENT_WAVE_LOG.md`.
Staging is live for preview only; **do not deploy production** and never touch the `production`
branch.

Slice 4 is the first slice where a language model is part of the product, and its governing rule is
**rules calculate, AI proposes, a human validates, and the system preserves all three** (ADR-019).
It adds deterministic closed-question tabulation with declared denominators, a versioned and
immutable coding taxonomy (`taxonomy`, `taxonomy_version`, `taxonomy_category`), classification runs
and AI proposals (`classification_run`, `ai_classification`), specialist review as the validated
result (`human_review`), and the Social Intelligence surface. A published `TaxonomyVersion` is
immutable by database trigger; a submitted `HumanReview` is final; a correction never overwrites the
proposal it corrects. **Only `DEMO_SIMULATION` answers may be sent to a model**: the gate is checked
in the use-case and again in the worker, and a non-demo answer is refused with
`ai_processing_not_authorized` whatever the caller's role (SECURITY.md §10c). **Which classifier
runs is explicit configuration with no default** (IG4-001, SECURITY.md §10c.1): the deterministic
fake is permitted only in `local` and `test`, an unset `SOCIAL_CLASSIFIER` means assisted coding is
unavailable rather than faked, a gateway without its credential is `BLOCKED_EXTERNAL_CONFIG`, no run
is written when nothing can process it, and a worker with no usable classifier never claims.
The model's confidence is an uncalibrated heuristic and AI-vs-human coincidence is **agreement,
never accuracy**; `HumanReview` is not a thesis gold standard (TD-044). Social analytics require
`field.responses.read` even for aggregates, because RLS would otherwise return silent zeros
(TD-045).

**Slice 5 (Quality Gate)** turns known document inconsistencies into a traceable specialist review.
Five deterministic rules compare two sources and say they disagree; none says which is right and
none declares compliance (invariant 11, enforced by a vocabulary test over the catalogue, over every
generated finding and over what is stored). The rule catalogue is **versioned code, not a table**
(ADR-020, amending ADR-008 §1); a finding stores `requirement_key` + `requirement_version` as text.
`specialist_review` is append-only — `REVOKE UPDATE, DELETE` *and* triggers — with a mandatory
justification; a change of mind is a second row. A re-run reconciles on a fingerprint, so a decided
finding stays decided and only changed evidence reopens it. Evidence is a `document_assertion` read
by hand from the corpus with **no page number**, because document ingestion does not exist yet and a
citation nobody can check is a fabrication. Checking (`quality.write`) and deciding
(`quality.review`) are different grants: a specialist runs, a reviewer settles.

RAG, Reports and the Client Portal are **not** implemented; their routes exist only as
capability-guarded placeholders until their slices land.

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
`docs/GIS_IMPORT_CONTRACT.md`, `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`,
`docs/IMPLEMENTATION_PLAN.md`, `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`, the delivery docs
`docs/ENGINEERING_STANDARDS.md`, `docs/RELEASE_POLICY.md`, `docs/CI.md`, `docs/DEPLOYMENT.md`,
`docs/DEPENDENCIES.md`, `docs/TECH_DEBT.md`, the Gate record `docs/DECISIONS/GATE-1.md`, and
the ADRs in `docs/DECISIONS/ADR-001` … `ADR-019`. Root `README.md` has the local quick start.

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
