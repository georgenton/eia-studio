# Development wave log

> One append-only entry per merged slice of the sustained MVP development wave authorised on
> 3 September 2026. It records what landed, what it cost, and what is still owed — including the
> things that are blocked on someone other than the code.
>
> Companion documents, not replacements: each slice keeps its own report (`docs/SLICE_N_REPORT.md`),
> its decisions live in ADRs, and its debt lives in `docs/TECH_DEBT.md`. This file is the timeline.

## Standing constraints for the wave

| | |
|---|---|
| Deployments | Preview only. Production has never been deployed; the `production` branch is untouched. |
| Persistent staging | Non-destructive verification only (`pnpm test:staging`). No resets, no truncation, no destructive integration run against it. |
| External AI | `LIVE_AI = BLOCKED_EXTERNAL_CONFIG` — no `AI_GATEWAY_API_KEY` in any environment (TD-049). Deterministic behaviour is built and tested regardless; no fake ever substitutes for a live provider in a persistent environment. |
| Data | Synthetic, PII-free demo data only. The compliance gate of SECURITY.md §10a is unopened. |

## Entries

### Slice 4 — Social Intelligence / human-in-the-loop

| | |
|---|---|
| Branch / PR | `feat/slice-4-social-intelligence` · [#7](https://github.com/georgenton/eia-studio/pull/7) |
| Merge SHA | `7072e88` |
| Migrations | `0016_social_intelligence_tables.sql`, `0017_social_rls_and_invariants.sql` — forward only, already applied to staging before this wave began |
| Tests | unit **215**, integration **243**, Playwright **98**, staging (non-destructive) **57** |
| Staging | healthy; field baseline unchanged; snapshot identical before and after the verification suite |
| External configuration | `LIVE_AI = BLOCKED_EXTERNAL_CONFIG` (TD-049) |

**Scope delivered.** Deterministic closed-question tabulation with denominators declared in words;
a versioned, immutable coding taxonomy; classification runs and AI proposals; specialist review as
the validated result; the Social Intelligence surface. Plus, in this wave:

- **IG4-001 closed.** `SOCIAL_CLASSIFIER` no longer defaults to `fake`. One domain rule
  (`resolveClassifierAvailability`) decides for the web app, the worker and the operator scripts:
  the fake runs only in `local` and `test`, unset means unavailable rather than defaulted, a
  gateway without its credential is `BLOCKED_EXTERNAL_CONFIG`, and an environment name nobody
  anticipated counts as persistent. No run is written when nothing can process it; a worker with no
  usable classifier never constructs its consumer, so it never claims. Deterministic analytics are
  untouched, and no process refuses to boot over it.
- **UX-001 closed.** The topbar identity is a native `<details>` account menu with the signed-in
  address, the active role and `Cerrar sesión`. No role switcher: a role is a server-side
  membership, so changing it means signing in as someone else. Covered by `e2e/session.spec.ts`.
- **Internal manual started** at `docs/manual/`, pages 01–06 and 10 current, 07–09 marked not built.

**Meaningful decisions.** Availability is a *domain* concept rather than an environment-schema
refinement, because a missing credential must be a reported state and not a boot failure — a
staging deployment has to keep serving deterministic analytics. The environment schema was reduced
to shape validation accordingly. Environment classification fails closed: `local` and `test` are
named positively and everything else, including a typo, is persistent.

**Deviations.** None from the approved scope. The report's test totals were corrected before this
entry (Playwright 96 → 98 with the new session spec; unit 201 → 215; integration 240 → 243).

**Debt recorded.** TD-049 (no AI Gateway credential in any environment; owner decision). TD-041,
TD-042, TD-043, TD-044, TD-045, TD-046, TD-047, TD-048 remain open from the slice itself.

### Slice 5 — Quality Gate

| | |
|---|---|
| Branch / PR | `feat/slice-5-quality-gate` · [#9](https://github.com/georgenton/eia-studio/pull/9) |
| Merge SHA | `7a4012a` |
| Migrations | `0018_quality_gate_tables.sql` (5 tables), `0019_quality_rls_and_invariants.sql` (grants, RLS, CHECKs, append-only and two-source triggers) — forward only, additive, no backfill |
| Tests | unit **243**, integration **285**, Playwright **118**, staging (non-destructive) **70** |
| Staging | migrations 18 → 20 applied forward; 8 corpus assertions and 1 provenance record added; **every pre-existing id identical**; field baseline unchanged; verification suite 70 passed |
| External configuration | unchanged — this slice calls no model at all |

**Scope delivered.** Five deterministic rules over the concluded study's corpus; findings with two
sources of equal weight; a reviewer's decision with a mandatory justification, append-only; the
Quality Gate surface and the finding detail; an operator command (`pnpm quality:run`); manual page
07 and the walkthrough's reviewer leg.

**Meaningful decisions.** ADR-020: the rule catalogue is versioned code rather than a
`RequirementVersion` table with a `definition jsonb`, which amends ADR-008 §1. Two rules were
implemented differently from the brief's literal description, both for reasons of truthfulness:
QG-001 compares two documents rather than a document against the synthetic parcel layer, and QG-004
compares two documents rather than a legal conclusion against survey records — the latter would have
required special-category personal data the demo questionnaire is built not to collect.

**A defect found in our own posture.** The append-only grant on `specialist_review` was silently
absent: migration 0002's `ALTER DEFAULT PRIVILEGES` grants full DML on every new `app` table, so a
narrower `GRANT` beside it changes nothing. The isolation test caught it by asserting an error and
getting a successful no-op. Fixed with an explicit `REVOKE`, and staging now asserts the privilege
bits directly.

**Deviations.** Recorded in `docs/SLICE_5_REPORT.md` §9. Nothing outside the approved scope.

**Debt recorded.** TD-050 … TD-054.

### Slice 6 — Document intelligence and the scoped assistant

| | |
|---|---|
| Branch / PR | `feat/slice-6-document-intelligence` · [#10](https://github.com/georgenton/eia-studio/pull/10) |
| Merge SHA | `4daf9eb` |
| Migrations | `0020_document_intelligence_tables.sql` (3 tables, 2 enums, 2 columns on `document_assertion`), `0021_document_rls_and_retrieval.sql` (grants + REVOKE, RLS, immutability triggers, generated `tsvector` + GIN index, replaced CHECK) — forward only, additive |
| Tests | unit **265**, integration **320**, Playwright **130**, staging **81** |
| Staging | migrations 20 → 22 applied forward; 6 documents / 9 passages / 6 provenance records added; every pre-existing id identical; **the four Quality Gate findings and their decisions untouched**; verification suite 81 passed |
| External configuration | unchanged — retrieval needs no credential; the narrative generator reports `NOT_CONFIGURED` and the assistant still answers |

**Scope delivered.** Immutable document versions and deterministic chunking; full-text retrieval
behind a port; an assistant that cites document, version, page and passage; the Documents surface
and a version's passages; the Quality Gate's evidence linked to the passage it was transcribed from;
manual page 08 and the walkthrough's document leg.

**Meaningful decisions.** ADR-021: one retrieval stack, PostgreSQL full-text, with **no pgvector and
no fake embedder** — the only resolution consistent with the brief's three constraints, and the same
principle as IG4-001 applied to a column instead of a table. The assistant separates finding
evidence from writing prose, so the useful half works with no provider at all. The shared
availability rule moved to `domain/ai/` and gained a general form rather than being copied.

**Deviations.** Recorded in `docs/SLICE_6_REPORT.md` §9. One Slice 5 test was updated rather than
loosened: migration 0021 replaces the CHECK it asserted, and it now asserts the successor.

**Debt recorded.** TD-056 … TD-059.


### Slice 7 — Assisted report generation

| | |
|---|---|
| Branch / PR | `feat/slice-7-report-generation` · [#11](https://github.com/georgenton/eia-studio/pull/11) |
| Merge SHA | `b8e9fc0` |
| Migrations | `0022_report_generation_tables.sql` (4 tables, 1 enum), `0023_report_rls_and_immutability.sql` (grants + REVOKE, RLS, immutability triggers, uniqueness) — forward only, additive |
| Tests | unit **283**, integration **350**, Playwright **141**, staging **90** |
| Staging | migrations 22 → 24 applied forward; the baseline diff before and after shows **only the migration count**, no row added, changed or removed; verification suite **90 passed** (+9) and the baseline is byte-identical after it; no chapter exists there — a version is produced through the surface, never seeded |
| External configuration | unchanged — `LIVE_AI = BLOCKED_EXTERNAL_CONFIG` (TD-049); the narrative generator reports `NOT_CONFIGURED` and every version is generated complete without prose |

**Scope delivered.** The social chapter as a versioned artefact: a validated JSON snapshot of five
sections in which every fact carries a typed source; deterministic generation with optional prose;
immutable versions; the Reports surface with a version's detail; a .docx that says BORRADOR on its
face and prints the source under every figure; manual page 09.

**Meaningful decisions.** ADR-022: the snapshot is the deliverable and prose is a rendering of it,
which is what makes a version generated with no provider a *complete* draft rather than a degraded
one. Prose is generated from the snapshot rather than the database, and a paragraph stating a figure
its section did not compute fails the generation instead of being trimmed. The append-only shape now
used for the third time (`human_review`, `specialist_review`, `report_version`) was written with the
REVOKE first, because migration 0002's `ALTER DEFAULT PRIVILEGES` makes a GRANT-only append-only
table silently mutable — the defect Slice 5 found.

**Deviations.** Recorded in `docs/SLICE_7_REPORT.md` §8. Three e2e assertions and one integration
assertion were updated rather than loosened: they asserted that Reports was ANNOUNCED and therefore
404, which Slice 7 makes false, so they now assert the successor facts. The demo seeder's provenance
cleanup gained `report_version`.

**Debt recorded.** TD-060 (no approval workflow), TD-061 (grounding is arithmetic, not semantic),
TD-062 (one chapter shape), TD-063 (the .docx is rendered per download, not stored).

### MVP integration and demo hardening

| | |
|---|---|
| Branch / PR | `feat/mvp-integration-demo-hardening` · *(recorded at merge)* |
| Merge SHA | *(recorded at merge)* |
| Migrations | **none** |
| Tests | unit **283**, integration **353** (+3), Playwright **150** (+9), staging **90** |
| Staging | untouched by this branch — no migration, no seed, no write. The verification of Slice 7 stands as the last measurement |
| External configuration | unchanged — `LIVE_AI = BLOCKED_EXTERNAL_CONFIG` (TD-049) |

**Scope delivered.** The walkthrough as a test (`e2e/mvp-journey.spec.ts`), which asserts the seams
between surfaces rather than the surfaces themselves; a measured performance baseline
(`docs/PERFORMANCE_BASELINE.md`) with the instrumentation that produced it; one real UX defect
fixed; and the consolidated hand-off (`docs/MVP_REVIEW_HANDOFF.md`) that ends the wave.

**Meaningful decisions.** The performance work **measured and stopped**. It found that every project
page makes 37–95 database round trips, that 17 of them establish who is asking and 12 of those are
transaction framing, and that the functions and the database are on opposite coasts. None of it was
acted on: consolidating the context transactions changes the RLS envelope of the authorization path
(TD-064), and the region question is an owner decision the brief reserves. Fixing the count is worth
more than fixing the distance, and the document says so rather than proposing a migration.

**Deviations.** The Preview could not be measured end to end: its deployment protection answers 302
before a request reaches the application, and signing in needs the owner's credential. The
procedure to turn the projection into a measurement is written down instead of guessed at.

**Debt recorded.** TD-064 (context round trips), TD-065 (Social's 78 queries), TD-066 (no
request-scoped authorization cache), TD-067 (no connection or statement timeout), TD-068 (the
technician e2e specs consume a pending assignment per run).

**Wave closed.** Seven slices merged, Implementation Gates 0–4 and Staging Gate 0.5 closed, no
production deployment, the `production` branch untouched, and the staging database verified
unchanged after every run against it.
