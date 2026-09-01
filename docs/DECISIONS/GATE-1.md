# Architecture Gate 1 — record

- Date: 2026-09-01
- Outcome: **APPROVED WITH CONDITIONS** by the human architect.
- Implementation status: **Slice 0 NOT authorized.** This record does not start implementation;
  an explicit go must be appended below.

## Conditions and where they were applied

| Id | Decision | Applied in |
|---|---|---|
| D-013 | Provenance is faceted: regime (HISTORICAL_OBSERVED / LIVE_OPERATIONAL / DEMO_SIMULATION), origin (FIELD_CAPTURE / IMPORTED_DOCUMENT / IMPORTED_DATASET / SYSTEM_GENERATED, extensible), transformation list (ORIGINAL / RECONSTRUCTED / DERIVED / ANONYMIZED), granularity (INDIVIDUAL / AGGREGATE when applicable). The four v0.2 SOURCE TYPE badges are presentation labels derived from the facets, not the backend enum. | PROVENANCE.md §2, ADR-005, DATA_MODEL.md §3.8/§4, DEMO_ZAMORA.md §1, DESIGN_SYSTEM.md, ARCHITECTURE.md §8, CLAUDE.md rule 7 |
| D-014 | Capability resolution is boolean (enabled / disabled). Navigation presentation ACTIVE / ANNOUNCED / HIDDEN is separate and non-authorizing; ANNOUNCED is disabled and not invocable via URL, API, server action, job or command. Pilot: Reports ANNOUNCED; Climate / PMA / Environmental Audit HIDDEN. | FEATURES.md §2–§3, ADR-002, ARCHITECTURE.md §3, DESIGN_SYSTEM.md, TESTING_STRATEGY.md, PRODUCT.md, CLAUDE.md rule 5 |
| D-015 | Tenant roles OWNER (org-wide control and project access, PII auditable), ADMIN (administration, no implicit access to sensitive project data; ProjectMembership required), MEMBER. Project roles COORDINATOR, SOCIAL_SPECIALIST, ENVIRONMENTAL_SPECIALIST, GIS_SPECIALIST, FIELD_TECHNICIAN, REVIEWER, VIEWER. CLIENT is not a project role; client access is only `ClientPortalGrant`. | TENANCY.md §1–§2, §6, SECURITY.md §4, ADR-001, ADR-009, PRODUCT.md §3, DATA_MODEL.md §3.7, TESTING_STRATEGY.md |
| D-016 | Better Auth approved provisionally for identity, authentication and session management only; memberships, roles, permissions and the capability resolver remain domain concepts; no coupling to Better Auth organisation roles. | ADR-010 (new), TENANCY.md §3a, SECURITY.md §2, ARCHITECTURE.md §3/§9, CLAUDE.md rule 6 |
| D-017 | Hosting deferred; not a Slice 0 blocker; architecture deployable across reasonable providers; dev/CI on local/test PostgreSQL with extensions; worker is a persistent process; not every workload fits ephemeral serverless requests; final decision before staging. | ARCHITECTURE.md §6, §9 (hosting row), §9.1, IMPLEMENTATION_PLAN.md |
| D-018 | Privacy by design: data inventory, purpose, retention, auditability, deidentification, processor/vendor registry, legal-basis/consent metadata, future data-subject rights, AI vendor governance, DPIA/risk metadata. Ecuador LOPDP/SPDP compliance review is a production readiness gate before real PII ingestion; no legal conclusions in docs/code; demo data stays synthetic/anonymised/aggregated. | SECURITY.md §10a, AI_GOVERNANCE.md §4a, DATA_MODEL.md §3.9, IMPLEMENTATION_PLAN.md, DEMO_ZAMORA.md §3, CLAUDE.md rule 15 |
| D-019 | `client.portal.show_forecast = false` by default; if enabled, only explicitly published ForecastSnapshots with provenance, calculation time, assumptions/version and clear projection wording; DEMO_SIMULATION forecasts never published as real client progress. | ADR-009, SECURITY.md §11, PROVENANCE.md §5, FEATURES.md §4, DATA_MODEL.md §3.7, DEMO_ZAMORA.md §4, TESTING_STRATEGY.md §12 |
| D-020 | No `field.offline_sync` capability; catalogue stays at the approved 14. Offline behaviour (capability vs `field.surveys.offline_mode = disabled / optional / required`) is an open decision for the Field slice. | FEATURES.md §2/§4, ADR-002, PRODUCT.md §6, IMPLEMENTATION_PLAN.md slice 3 |

Design-bundle known issues were recorded in `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md` without
modifying the approved design files or reconstructing `support.js`.

## ADR status after Gate 1

| ADR | Status |
|---|---|
| ADR-001 multi-tenancy | Accepted with conditions (D-015, D-016 applied) |
| ADR-002 capability resolution | Accepted with conditions (D-014, D-020 applied) |
| ADR-003 project profiles | Accepted (no conditions raised) |
| ADR-004 row level security | Accepted (no conditions raised) |
| ADR-005 data provenance | Accepted with conditions (D-013 applied, D-019 referenced) |
| ADR-006 survey versioning | Accepted (no conditions raised) |
| ADR-007 AI human-in-the-loop | Accepted (no conditions raised; D-018 vendor governance referenced from AI_GOVERNANCE.md) |
| ADR-008 quality gate | Accepted (no conditions raised) |
| ADR-009 client portal isolation | Accepted with conditions (D-015, D-019 applied) |
| ADR-010 identity provider boundary | New, accepted provisionally (D-016) |

ADRs marked "Accepted (no conditions raised)" keep their original decision text; only their
status line now reads "Accepted at Gate 1 (no specific conditions raised)", on the basis of the
overall approval. The architect may add per-ADR remarks here.

## Open decisions carried forward

- Field slice: offline behaviour as capability vs configuration (D-020).
- Before staging: hosting provider (D-017).
- Before production PII ingestion: Ecuador LOPDP/SPDP compliance review (D-018).
- Slice 0: confirm Better Auth meets the provisional criteria in ADR-010 (D-016).

## Delivery alignment (2026-09-01, after Gate 1 documentation approval)

Engineering standards and delivery architecture approved and recorded:

| Topic | Decision | Where |
|---|---|---|
| Git | GitHub private repo `eia-studio`; protected `main`; short-lived `feat/fix/chore/docs/refactor/test` branches; PRs required; squash merge; Conventional Commits; PR template; no issue templates for now; CODEOWNERS as future optional | ENGINEERING_STANDARDS.md, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS.example` |
| Releases | Changesets, SemVer, generated changelogs, private packages versioned/tagged not published; no changeset for docs/tooling-only changes | RELEASE_POLICY.md, ADR-011 |
| Hooks | Husky + lint-staged (`pre-commit`), commitlint (`commit-msg`), optional light `pre-push`; CI authoritative | ENGINEERING_STANDARDS.md §7 |
| CI | GitHub Actions; staged quality gate (`ci / quality` today: hygiene + PR title; Slice 0 adds frozen install, format, lint, typecheck, unit, build; later db/RLS/harness, e2e/visual, security) | CI.md, `.github/workflows/ci.yml` |
| Frontend | Next.js App Router kept; no TanStack Router/Start; TanStack Table/Query/Virtual/Form selectively per slice | ADR-014 |
| ORM | Drizzle only; no Prisma; SQL migrations for RLS/PostGIS/pgvector | ADR-013 |
| Topology | `apps/web` → Vercel; persistent `apps/worker` → Railway; Postgres on Railway pending evaluation; storage behind S3 port; no duplicate web deployment; no extra API service | DEPLOYMENT.md, ADR-012 |
| Environments | local, CI/test, PR preview (Vercel; Railway PR env only when needed), persistent staging from `main` after Slice 0 build, production manual and gated | DEPLOYMENT.md §2 |
| Simplicity | no Kubernetes, event bus, microservices, second ORM, Redis, extra API, or full observability stack without a demonstrated requirement and ADR | ADR-012, CLAUDE.md rule 23 |

## Authorization to implement

_Not yet granted. Append the go decision here (date, author, scope) before Slice 0 begins._
