# Implementation plan — vertical slices (proposal for Gate 1)

> Nothing below is started. Gate 1 approved the architecture with conditions (GATE-1.md) but
> **Slice 0 is not yet authorized**; an explicit go is required. Each slice is a thin vertical
> cut (schema → use-cases → routes → UI → tests) that leaves the product demonstrable. The order
> differs from the brief's expected shape; the reasons are in §2.

## 1. Proposed sequence

| # | Slice | Delivers | Depends on |
|---|---|---|---|
| 0 | **SaaS foundation** | monorepo (pnpm + Turborepo, `.nvmrc`, `packageManager`), tooling (Prettier, ESLint boundaries + forbidden strings, Husky + lint-staged, commitlint, Changesets config and release workflow), CI stages B–C and E (CI.md), DB with RLS roles and policies, auth (Better Auth per ADR-010), tenant/membership/project/role/permission, capability catalogue + resolver, configuration registry, profile `road_eia_social` (capabilities + config only), provenance and audit modules, shell (rail, topbar, switchers, palette), Portfolio with empty state, Tenant Settings (Usuarios, Roles, Módulos, Project templates read-only, Seguridad basics), design tokens + primitives + the 15 states, cross-tenant test harness, `/health` endpoints, `railway.toml` and Vercel project linking once a runnable build exists (staging automation from `main`) | — |
| 1 | **Documents and imports** | `core.documents`: SourceDocument/DocumentVersion, object storage, ImportRun framework, fixture import CLI (regime-aware), document viewer with locators; historical aggregate facts imported as `MetricSnapshot` with `REAL_AGGREGATE` provenance; **thin Command Center** showing only historical figures and the provenance drawer | 0 |
| 2 | **GIS + Parcel workspace** | SpatialDataset versions, layer import (GeoJSON/Shapefile/KML), Parcel/ParcelGeometry, linear extension (alignment, segments, linear reference), MapLibre explorer with synced table and panel, legends (state + provenance), Parcel Workspace shell with Resumen and Afectaciones tabs, `no GIS yet` / `partial GIS` | 0, 1 |
| 3 | **Field / survey foundation** | SurveyTemplate/Version/Question, SurveyInstance/Answer (immutable), Visit, Media (presigned upload), Assignment, Device, PII schema and `pii.read` policy, Field Surveys inbox with validation, Parcel tabs Visitas/Instrumentos/Media, survey import (CSV/Kobo later). **Open decision to settle here (D-020):** offline behaviour as a capability vs configuration `field.surveys.offline_mode = disabled / optional / required` | 0, 1, 2 |
| 4 | **Command Center (full)** | KPI strip from `MetricSnapshot` (live regime), forecast calculator + `ForecastSnapshot`, "Requiere atención hoy" aggregator, activity feed, territorial summary; demo simulation fixtures badged | 1, 2, 3 |
| 5 | **Social intelligence** | Taxonomy/versions/categories, deidentification gateway, `ai` ports with a deterministic fake adapter, ClassificationRun/AIClassification, coding queue with HumanReview and keyboard flow, AnswerCoding, closed-variable frequencies and cross-tabs (validated only), category proposals, states 14/15 | 3 |
| 6 | **Quality Gate** | Requirement/RequirementVersion registry, QualityRun job, seven pilot rules, findings inbox and detail with evidence locators, SpecialistReview state machine, copy lint, Parcel Quality tab | 1, 2, 3, (5 for legal-vs-social) |
| 7 | **Client Portal** | ClientPortalGrant, portal auth surface, PortalPublication + allowlist projection, portal UI, PDF export, denylist tests, `client.portal.show_forecast` | 1, 4 |
| 8 | **RAG / document intelligence** | DocumentChunk pipeline, redaction for PII documents, embeddings via `ai` port, retrieval scoped by RLS, task-embedded assistant (no dashboard chatbot) | 1, 5 (gateway) |
| 9 | **Reports** | GeneratedReport/ReportVersion/Section, citations to provenance, draft → review → approval → export with provenance per figure | 4, 5, 6, 8 |
| later | **FieldFlow mobile / offline sync** (capability or configuration, per the Field-slice decision), Climate, PMA, Audit extensions, custom roles, SSO | 3 |
| gate | **Staging gate**: database evaluation on Railway passed (DEPLOYMENT.md §4), runnable build, CI stages B–C green, secrets configured in Vercel/Railway. **Production readiness gate (D-018)**: Ecuador LOPDP/SPDP compliance review before any real personal data is ingested; hosting confirmation (ADR-012); backups tested; security checks blocking; manual, explicit production deploy only | before staging / before production |

## 2. Why this order differs from the brief

The brief expected: 0 Foundation · 1 Command Center · 2 GIS · 3 Field · 4 Social · 5 Quality ·
6 RAG · 7 Reports · 8 Client Portal.

- **Command Center moved after Field (was 1, now 4).** Its KPIs, forecast and attention list are
  derived from parcels, visits, instrument states, codings, findings and sync. Building it first
  would mean building it on synthetic fixtures, which is exactly the trap the bundle warns about.
  A thin Command Center with historical facts and the provenance drawer ships in slice 1 so the
  walking skeleton is still visible end to end.
- **Documents and imports promoted to slice 1.** GIS imports, survey imports, Quality Gate
  evidence, RAG and the Zamora historical facts all rest on `ImportRun`, `DocumentVersion` and
  object storage. Doing this once early avoids four ad-hoc import paths.
- **Client Portal moved before RAG and Reports (was 8, now 7).** It is designed (screenshot 09),
  customer-facing, and depends only on foundation + Command Center inputs. RAG and Reports are
  "fase posterior" and undesigned; their UI needs a design iteration first.
- **Social before Quality** is kept, because the interdisciplinary rule contrasts validated social
  data with documents.

## 3. Slice 0 in more detail (the risky one)

Exit criteria:

1. Tenant A / tenant B seeded by factories; the cross-tenant suite passes on every entry point
   that exists (portfolio, settings, memberships).
2. RLS schema test passes; migrations create policies alongside tables.
3. Capability catalogue drives the rail, the palette and the route table; toggling a module in
   Tenant Settings hides its rail item and makes its route render `feature disabled`.
4. Project creation from `road_eia_social` copies capability settings and configuration defaults
   and records profile key/version.
5. Provenance drawer component renders from a `ProvenanceRecord` (using a seeded historical
   aggregate) — even before any real data flows.
6. The 15 states exist as components with approved copy and Storybook stories; visual baselines
   for screenshots 01, 10, 11 are established.
7. Audit log receives membership/role/capability changes.

Gate 1 settled the pre-slice-0 decisions: Better Auth provisionally for identity/auth/sessions
only (D-016); hosting deferred and not a blocker, persistent worker process, local/test
PostgreSQL with extensions for dev/CI (D-017); pnpm monorepo as proposed. The delivery
alignment added: GitHub private repo with protected `main`, Conventional Commits, Changesets,
Husky/commitlint, staged GitHub Actions, Vercel + Railway staging topology (ADR-011…ADR-014).
Slice 0 still needs an explicit go from the architect, and the repository must exist on GitHub
with the Stage A workflow green before the first Slice 0 PR.

Additional exit criteria for slice 0 from the delivery alignment:

8. `pnpm ci:local` reproduces the `quality` and `db` jobs; hooks installed and documented.
9. Changesets configured (linked group for the two apps, private packages versioned), release
   workflow opens its first Version Packages PR.
10. Both apps expose `/health` with version + git SHA; staging deploys from `main` on Vercel and
    Railway after the database evaluation (DEPLOYMENT.md §4) passes.

## 4. Cross-slice rules

- Every slice adds its tables to the RLS and provenance registries and its entry points to the
  enforcement registry; CI coverage assertions fail otherwise.
- Every slice ships the system states relevant to its surface.
- Zamora fixtures are extended per slice under `fixtures/projects/…` with regime flags; nothing
  Zamora-specific enters `packages/domain`.
- An ADR is added or amended when a slice changes an architectural decision.
- Demo and test data stay synthetic, anonymised or aggregated until the compliance gate passes
  (D-018).
- Intentional technical debt is recorded in `docs/TECH_DEBT.md` (created with slice 0) with an
  owner and a removal trigger.

## 5. Estimated shape (not a commitment)

Slice 0 and 1 are the largest (foundation + import framework). Slices 2–4 are UI-heavy with
well-defined data. Slices 5–7 are domain-heavy with strong test suites. Slices 8–9 need a design
iteration before implementation. Estimates belong to the team after Gate 1.
