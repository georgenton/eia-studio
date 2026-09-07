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
| Branch / PR | `feat/mvp-integration-demo-hardening` · [#12](https://github.com/georgenton/eia-studio/pull/12) |
| Merge SHA | `2bc58b5` |
| Migrations | **none** |
| Tests | unit **283**, integration **353** (+3), Playwright **150** (+9), staging **90** |
| Staging | untouched by this branch — no migration, no seed, no write. Re-verified after the merge all the same: **90 passed**, and the baseline captured before and after the run is byte-identical |
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

## Real data and productization wave (authorised 4 September 2026)

The wave that follows the MVP one. Its governing rule is **realistic experience, honest
provenance**: the project is real — *Actualización de Estudios Socioambientales con lineamientos
BID para el proyecto de asfaltado de la vía Puente del Amor – Los Hachos, cantón Yantzaza,
provincia de Zamora Chinchipe*, PROVIAL 2 EC-L1289 — and reconstructed operational data must never
be silently converted into historical fact.

Standing constraints, where they differ from the wave above:

| | |
|---|---|
| Data | Real **non-sensitive** project data may now enter the repository and staging, sanitised: no names, identity numbers, deeds, phone numbers, photographs of people, or household coordinates. Synthetic operational data keeps its `DEMO_SIMULATION` regime and is never relabelled. |
| The consultancy's delivery | The archive, the geodatabase and the workbook are **never** committed, never uploaded, and never sent to a model or an API. They are read read-only in a workspace outside the repository (`docs/REAL_DATA_INTAKE.md`). |
| Everything else | Unchanged: preview deployments only, non-destructive staging verification, `LIVE_AI = BLOCKED_EXTERNAL_CONFIG`, the compliance gate of SECURITY.md §10a unopened. |

### Wave A — discovery, and the safe data contracts

No branch of its own: it produced the reports in the intake workspace and the summary that was
merged with Wave B (`docs/REAL_DATA_INTAKE.md`). What it established, and what everything after it
rests on: the cartographic package is 23 layers of a real corridor with **18 personal attributes**
on the parcels layer and 19 on the affectations layer, all of which had to be dropped before a
single file entered Git; the PGAS arrived as a **Word document**, not the workbook the brief
expected; and the parcel counts in the delivery disagree with each other (141 in the geodatabase,
148 in one list, 74 in an export) — which is a finding, not a defect to repair.

### Wave B — the study's real cartography

| | |
|---|---|
| Branch / PR | `feat/real-gis-zamora` · [#14](https://github.com/georgenton/eia-studio/pull/14) |
| Merge SHA | `0257779` |
| Migrations | `0024_real_geometry_and_influence_areas.sql`, `0025_influence_area_rls.sql`, `0026_project_official_title.sql` — forward only, additive except two widenings (single-part → multi-part geometry) and one replaced CHECK |
| Tests | unit **286**, integration **364**, Playwright **150** |
| Staging | migrations applied to 0026; the baseline diff before and after the import shows **4 new provenance records and no changed id** |

**Scope delivered.** The real alignment (7 361,3 m measured by PostGIS, against the ~7,4 km the
study publishes), 141 parcels with the codes the field sheet uses, 70 affected areas, four influence
areas, and the chainage table — imported from the consultancy's geodatabase with every personal
attribute removed before the file entered the repository.

**Meaningful decisions.** ADR-023: *the real package decides the shape*. Three contradictions were
resolved in the data's favour rather than the model's — geometry became multi-part because a plot
split by the road is two polygons; chainage became a range because the delivery gives one; and the
influence areas became a layer of their own. Three defects in the delivery were **kept**: `042a`
beside `042A`, the reversed chainage ranges (`080A` runs 2 583 → 2 557), and the affected area whose
parcel code does not exist. The database stores what the source says; saying two sources disagree is
the Quality Gate's job.

**Debt recorded.** TD-069 (the declared area is not stored, so its disagreement with the measured
one cannot be reported), TD-070 (the influence areas are stored but not drawn), TD-071 (the demo
campaign clusters at abscissa 0 now that the chainages are real).

### Wave C — the management plan (PGAS)

| | |
|---|---|
| Branch / PR | `feat/pgas-foundation` · [#15](https://github.com/georgenton/eia-studio/pull/15) |
| Merge SHA | `1665548` |
| Migrations | `0027_pgas_tables.sql` (3 tables), `0028_pgas_rls_and_invariants.sql` (invariants, grants, RLS, the one-active-run index) — forward only, additive |
| Tests | unit **300** (+14), integration **378** (+14), Playwright **155** (+5) |
| Staging | **not applied in this session.** The read-only baseline was captured (27 migrations, 141 parcels, 23 provenance records); applying 0027–0028 and re-seeding was refused by the sandbox, so it is owed. Nothing was written to the persistent environment. |
| External configuration | unchanged — `LIVE_AI = BLOCKED_EXTERNAL_CONFIG` (TD-049); no model is involved in reading a document's tables |

**Scope delivered.** The study's Cap 11 as a model and a surface: three tables, an importer that is
idempotent by the file's SHA-256, and `/t/:tenant/p/:project/pgas` showing nine plans, twenty-two
programme groupings and eighty-six measures in the document's own words. `compliance.pma` becomes
AVAILABLE, giving the pilot profile a twelfth enabled capability, and the rail has no ANNOUNCED
placeholder left. Full model in `docs/PGAS_MODEL.md`.

**Meaningful decisions.** ADR-024: *the PGAS is a document with a shape, not a compliance workflow*.
A programme is a banner row, so it is two columns on the measure rather than a table that would
force the two plans without one to carry a synthetic programme. Nothing in the schema can record
execution — no compliance state, no evidence, no obligation — because the road has not been built,
and an integration test asserts that over `information_schema` so the absence survives a future
migration. Four completeness checks and two inconsistency checks were **drafted as Quality Gate
rules and withdrawn**: a finding compares two sources, *a measure has no indicator* has one side,
and routing typography through the Gate would have produced sixteen findings about spelling beside
four about the study. They live on the surface instead, beside the plan they belong to.

**Deviations.** The demo seeder's provenance cleanup gained `pgas_import_run` — the fourth time that
list has been extended by a slice, and the reason it is written as an explicit enumeration. Three
documentation rows in `docs/FEATURES.md` §2 were corrected while the table was open: `core.documents`,
`quality.rag_assistant` and `reports.social_generator` were still recorded as ANNOUNCED, which
Slices 6 and 7 made false.

**Debt recorded.** TD-072 (the plan's *lugar de aplicación* is not cross-checked against the
cartography — the one genuinely cross-document rule this material supports, deferred because against
the delivered data it would be silent).

### Wave D — the product's language

| | |
|---|---|
| Branch / PR | `feat/spanish-environmental-ux` · [#16](https://github.com/georgenton/eia-studio/pull/16) |
| Merge SHA | `7a51be9` |
| Migrations | **none** |
| Tests | unit **300**, integration **378**, Playwright **167** (+12) |
| Staging | untouched by this branch — no migration, no seed, no write |
| External configuration | unchanged |

**Scope delivered.** Every word on screen is Spanish. The rail (*Centro de control*, *Cartografía y
predios*, *Trabajo de campo*, *Análisis social*, *Control de calidad*, *Documentos*, *Plan de
Manejo*, *Informes*), the provenance drawer (*ORIGEN DEL DATO*, *Validación humana*), the four
SOURCE TYPE badges (*Dato histórico*, *Dato calculado*, *Agregado sin datos personales*,
*Simulación operativa*), the map legend, the demo fixture's own copy, and the panel badge that used
to be a solid **DEMO** stamp. `docs/PRODUCT_LANGUAGE_ES.md` is the vocabulary; `e2e/vocabulary.spec.ts`
is what keeps it.

**Meaningful decisions.** ADR-025 states the rule as a boundary rather than a translation pass — *a
stored value is never rendered; a label for it is* — because the leak was systematic: a component
that renders a domain value directly produces one without anyone deciding to. The four badge
categories and their derivation are untouched, so invariant 13 still holds and only the words
changed. The drawer's eyebrow now explains the datum (*Cifra verificable del expediente, sin datos
identificables*) rather than the mechanism (*ETIQUETA DERIVADA DE LAS FACETAS*), because a reader
opens it to decide whether they may quote a figure. And the **DEMO** stamp was removed *because* of
invariant 4 rather than despite it: a badge on every panel is skimmed, and one that is skimmed has
stopped marking anything.

**Deviations.** This is a deliberate divergence from the approved bundle, whose rail and badges are
English. It changes nothing the bundle governs — composition, hierarchy, treatment, interaction
intent (ARCHITECTURE §11a) — and is recorded as entry 15 of `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`.
Thirteen e2e assertions were updated to the successor facts rather than loosened. The demo
fixture's `surfaceLabel`s and one activity event were part of the leak and were corrected with the
rest: a fixture writes the words a reviewer reads.

**Debt recorded.** None new. TD-068 (the technician specs consume a pending assignment per run) was
hit twice during this wave and worked around with `pnpm db:reset:local`; it is still owed.

### Wave E — one transaction to know who is asking

| | |
|---|---|
| Branch / PR | `feat/request-context-performance` · [#17](https://github.com/georgenton/eia-studio/pull/17) |
| Merge SHA | `f957e5c` |
| Migrations | **none** |
| Tests | unit **300**, integration **386** (+8), Playwright **167** |
| Staging | untouched by this branch — no migration, no seed, no write |
| Measured | context round trips **17 → 12** on every project route, **14 → 9** on the Portfolio, **13 fewer per page** overall (`docs/PERFORMANCE_BASELINE.md` §10) |

**Scope delivered.** TD-064, closed. `resolveAccessContext` resolves the caller in one transaction:
reconcile the user row, prove the tenant with `app.tenant_id` unset, adopt it, then read the
project, its memberships, the overrides and the tenant's capability rows under it. The settings the
shell needs come back with the context instead of being re-read, and `getSessionUser` no longer
reconciles the user row a second time for a display name.

**Meaningful decisions.** The envelope was preserved rather than approximated: `adoptTenantContext`
exists so the ordering the four transactions expressed structurally is expressed by `SET LOCAL`
inside one, and the eight-test envelope suite was written *before* the merge because a performance
argument is not a licence to weaken the authorization path. One behaviour did change and is
deliberate: a denied resolution now leaves no `app.user` row behind, because the reconciliation
rolls back with everything else — a row for somebody with access to nothing is a row nobody asked
for, and identities are provisioned explicitly (`provision:identity`) rather than by browsing.

**Deviations.** The region measurement (`docs/PERFORMANCE_BASELINE.md` §7) is still owed: the
Preview answers 302 before a request reaches the application and signing in needs the owner's
credential. §8 argued the count should come down before geography is spent on it, and it has.

**Debt recorded.** None new. TD-064 closed; TD-066 narrowed to what remains true.

### Wave F — the workspace as the real project

| | |
|---|---|
| Branch / PR | `feat/zamora-realistic-workspace` · [#18](https://github.com/georgenton/eia-studio/pull/18) · follow-up [#19](https://github.com/georgenton/eia-studio/pull/19) |
| Merge SHA | `ac574d5` · `956406a` |
| Migrations | **none** |
| Tests | unit **300**, integration **386**, Playwright **168** (+1) |
| Staging | migrated to 0028 and re-seeded after the merge: the PGAS chapter is there and `compliance.pma` is entitled. The baseline diff shows **additions only** — 2 migrations, 1 provenance record, and 10 assignments the campaign gained because the earlier twelve were kept rather than moved (see the follow-up below and §20 of the handoff) |

**Scope delivered.** The Command Center names the study as its terms of reference do, with the
programme reference beside it — the project record has carried both since Wave B and nothing showed
them. The demonstration campaign's twelve assignments are spread along the corridor by chainage
instead of clustering in its first few hundred metres (TD-071). `docs/ZAMORA_WORKSPACE.md` says,
surface by surface, which numbers are the study's and which are ours;
`docs/PRODUCT_VALUE_AND_DIRECTION.md` says what the product does for a consultancy today and what it
deliberately does not; `docs/DEMO_ZAMORA.md` §1 is brought back into step with what the workspace
now holds, and the walkthrough gains the management plan and the Spanish rail.

**Meaningful decisions.** The four things the delivery gets wrong are still not repaired, and
`docs/ZAMORA_WORKSPACE.md` gives them a table of their own rather than a footnote: `042a` beside
`042A`, the reversed chainage ranges, the affected area whose parcel does not exist, and the
chapter's spelling. A workspace that quietly fixed its source would stop being able to tell anyone
what the source said. `docs/PRODUCT_VALUE_AND_DIRECTION.md` ends by naming what would make it
dishonest — a roadmap with dates — because the ordering in it is evidence for a decision the owner
makes, not a plan the code has assumed.

**Deviations.** None.

**Debt recorded.** None new. TD-071 closed.

### Closing the wave

| | |
|---|---|
| Handoff | `docs/REAL_DATA_WAVE_HANDOFF.md`, answering the brief's twenty-one questions |
| Merged | PRs [#14](https://github.com/georgenton/eia-studio/pull/14) … [#19](https://github.com/georgenton/eia-studio/pull/19); `main` at `956406a` |
| Tests | unit **300**, integration **386**, Playwright **168**, staging **88 of 90** |
| Staging | migrated to 0028, re-seeded, verified. The two staging failures are one fact: its demo campaign holds 22 assignments where the fixture declares 12, because a re-seed after the target parcels moved added the new ones beside the old. Removing them is a delete against a persistent environment and waits on the owner |
| Not done, deliberately | no production deployment, no real personal data, no Climate Intelligence, no audit/compliance implementation, no region move |

### Staging campaign canonicalization

| | |
|---|---|
| Branch / PR | `fix/staging-campaign-canonicalization` · PR pending |
| Merge SHA | pending |
| Migrations | **none** |
| Tests | unit **300**, integration **398** (+12), Playwright **168**, staging **91** (+1) |
| Staging | one authorized, non-destructive transition: the drifted campaign **closed**, a new canonical campaign seeded. **Zero deletes, zero id replacements, zero submitted-response mutations**; the baseline diff is additions only, and two consecutive verification runs afterwards leave it byte-identical |

**Scope delivered.** The owner's decision, implemented: preserve the operational history and create
a new canonical current campaign, rather than deleting the eight technically-deletable assignments
(which would have left 14/6 — no fixture's baseline either) or adopting 22/6 as the new normal.

**Meaningful decisions.** ADR-026 answers the modelling question underneath the incident: a campaign
is an **operational snapshot**, not a plan, so its target universe is a fact about something that
happened and changed semantics open a new campaign. `assertCampaignClosable` + `closeCampaign` are
the transition the product was missing; the demo fixture identifies its campaign by a declared key
rather than by its Spanish display name; and `resolveCurrentCampaign` is now the single definition
of *now*, consulted by the Command Center's field panel, by every Social Intelligence read model and
by the report snapshot. That last part was the real hazard: Social tabulation grouped by survey
version alone, so two campaigns on one published version would have shared a denominator — two
operations, months apart, presented as one sample.

**Deviations.** The staging fixture contract was **not** relaxed to `>=`. It now asserts the current
operation exactly and asserts of history only that it is closed, dated and intact; the project's
total assignment count is no longer a fixture number. One isolation assertion that hardcoded "one
campaign is visible" now compares permitted and unpermitted callers instead, which is the property
it was actually testing.

**Debt recorded.** TD-073 (nothing in the schema prevents two `ACTIVE` campaigns; the current rule
has a deterministic tie-break rather than a guarantee).

## Consultancy demo readiness wave (authorised 5 September 2026)

Focused product readiness rather than another subsystem: clarity → realism → speed → evidence →
demo flow. Standing constraints unchanged from the wave above.

### Readiness 1 — the workspace as a consulting product

| | |
|---|---|
| Branch / PR | `feat/consultancy-demo-readiness` · [#22](https://github.com/georgenton/eia-studio/pull/22) |
| Merge SHA | `dbf6bcc` |
| Migrations | **none** |
| Tests | unit **307** (+7), integration **398**, Playwright **170** (+2) |

**Scope delivered.** An audit of every surface, read as a consultant rather than as an engineer,
and its consequences: the last internal words off the screens (*tenant*, *Portfolio*, *fixture*, a
permission key, rule keys, role and status enums, a repository path, the classifier's
adapter/prompt/hash table); the rail ordered the way the work happens, with the Quality Gate renamed
*Control de consistencia*; the management plan rendered as a plan, grouped by the document's own
programme banners; the four areas of influence drawn (TD-070); field history behind a disclosure;
and the one cross-document check the plan supports (TD-072).

**Meaningful decisions.** The audit trail the removed identifiers carried was **kept, one click
away** — the model, adapter and prompt version of a run, the taxonomy's fingerprint, a rule's
catalogue key on the finding it produced — because it is evidence, not something a consultant reads
while working. The influence areas are drawn from a **generalised outline computed on read** (890 KB
of stored coordinates → 21 KB drawn) rather than by simplifying what is stored, which is the choice
TD-070 asked for. `rule.pgas_place_vs_influence_area@1` is **silent against the study as delivered**,
which is exactly why the surface lists what was checked whether or not it fired.

**Debt recorded.** None new. TD-070 and TD-072 closed.

### Readiness 2 — round trips and the connection

| | |
|---|---|
| Branch / PR | `perf/connection-and-round-trips` · [#23](https://github.com/georgenton/eia-studio/pull/23) |
| Merge SHA | `ed4affb` |
| Migrations | **none** |
| Tests | unit **307**, integration **398**, Playwright **170** |
| Measured | **four fewer round trips on every project page** (`docs/PERFORMANCE_BASELINE.md` §11) |

**Scope delivered.** `loadWorkspaceHeader`, because every page was loading a whole portfolio —
metrics, attention items, activity feed and their provenance — to draw a breadcrumb and a switcher.
And a connection pool that no longer runs on defaults: keepalive, a bounded lifetime, a shorter idle
timeout, a connect timeout and a statement timeout, chosen from the one observed `ECONNRESET` rather
than from a checklist (§11.1).

**Meaningful decisions.** **No retries.** A retry around a transaction re-runs whatever it contained
and this product's transactions write; the pool already discards an errored client, so making the
failing request fail clearly is the honest fix. Social's 85 round trips were left alone: campaign
scoping (ADR-026) added an `EXISTS` to each of its reads, the correct denominator costs more than
the wrong one, and rewriting those queries must not change a single figure (TD-065).

**Debt recorded.** None new. TD-067 closed; TD-065 amended with what campaign scoping cost.

### Readiness 3 — the demo, and two products deliberately not started

| | |
|---|---|
| Branch / PR | `docs/demo-script-and-product-direction` · PR #24 |
| Merge SHA | `385cf20` |
| Migrations | **none** |

**Scope delivered.** `docs/CONSULTANCY_DEMO_SCRIPT.md` — nine beats, roughly 25 minutes, in Spanish,
with what to say, what to answer, and what not to do. `docs/CLIENT_PORTAL_DECISION.md` — what a
client actually needs, the eight things that must never be exposed, what already exists to feed it,
and the three decisions the owner has to make first. `docs/ENVIRONMENTAL_AUDIT_PRODUCT_DIRECTION.md`
— the chain from a proposed measure to an audit report, and the adoption act that is the seam.

**Meaningful decisions.** Both notes end with *do not start yet*, and say what would have to be true
first: a second project and the compliance review for the portal; a real engagement with obligations
in force for the audit. The demo script's instruction is to **not lead with AI** — it is one step of
nine and the least finished — and never to describe the simulated field operation as though it
happened.

**TD-073 (two ACTIVE campaigns) is deliberately deferred**, per the owner's decision: the current
resolution is deterministic and no business case for simultaneous field operations exists yet.

## Consultancy validation & live-AI readiness wave (authorised 6 September 2026)

Two objectives, kept apart on purpose: make the product **validatable by a consulting firm**, and
make live AI **ready to activate** when the owner authorises it — without activating it. No paid
model call, no production deployment, no persistent staging mutation.

### Validation 1 — the checks that run before somebody is watching

| | |
|---|---|
| Branch / PR | `feat/consultancy-validation-readiness` · PR #25 |
| Merge SHA | `6f3c7ee` |
| Migrations | **none** |
| Tests | unit **705**, integration **398**, Playwright **177** |

**Scope delivered.** `pnpm demo:preflight` (seven checks: which database was reached, migrations
against the repository's journal, PostGIS, `eia_app` without `BYPASSRLS`, RLS forced everywhere, the
address, the credential's presence) and `pnpm demo:doctor` (twenty checks over the study's data,
following the demo script's nine beats). `e2e/journey-integrity.spec.ts` — seven tests for what only
fails *between* screens: rail destinations that answer and name themselves, no dead links, every
control with an accessible name, every empty region explaining itself, the field surface opening on
the current operation, the provenance drawer opening and closing, and a way out of the workspace a
reader can find. `docs/CONSULTANCY_DEMO_PREFLIGHT.md` and `docs/CONSULTANCY_FEEDBACK_TEMPLATE.md`.

**Meaningful decisions.** The operator tools are **read-only in every environment**: one that
repairs what it finds is one nobody can trust to report. Two conditions are hard failures rather
than warnings — a dangling `provenance_id`, and fake-classifier rows in a persistent environment —
because both put something *false* on screen rather than nothing. An unconfigured model provider is
a **WARN**: the deterministic product is unaffected, and the honest demonstration of the other half
is the unavailable state. The feedback template is a **document, not a module**: no ticket entity,
no backlog table, no feedback surface in the product; and it keeps *they could not find it* apart
from *they found it and reject it*, because merging the two turns a strategic signal into a copy
edit.

**Fixed in passing.** `SET statement_timeout` was a fire-and-forget query racing the first real
query; it is now the connection's `options` startup parameter. `docs/TECH_DEBT.md` had **two**
TD-073 entries — the PGAS ingestion one is now TD-074, the campaign one keeps the number the log
already references.

### Validation 2 — live AI, ready and not switched on

| | |
|---|---|
| Branch / PR | `feat/live-ai-readiness` · PR #26 |
| Merge SHA | `555a116` |
| Migrations | **none** |

**Scope delivered.** `docs/AI_LIVE_ACTIVATION.md` — the resolution matrix for the three features
that may call a model, what each would actually send, what it would cost, the bounded smoke
procedure, and the rollback. `docs/AI_MODEL_SELECTION.md` — a reading of the **live** Vercel AI
Gateway catalogue taken on 6 September 2026 (373 models; no credential used, no model invoked),
the filters that eliminated 331 of them, and the two chosen with their prices. A cap on how many
answers one run may send, with an explicit `limit` for a deliberate small run. A boundary test over
what each of the three paths puts in an outbound payload.

**Meaningful decisions.** **No paid call was made**, and no provider is configured anywhere. The
run cap **refuses rather than truncates**. The model ids were read from the catalogue rather than
remembered — which is how the document came to record that of OpenAI's language models only the
`gpt-oss` and `codex` families report zero data retention across every route, that Google's Gemini
models report it for *some*, and that `claude-sonnet-5` is now cheaper than the `claude-sonnet-4.5`
the code's own example still names. The `DEMO_SIMULATION` gate is stated for what it is: a rule
about **individual survey answers**, not about aggregates — the report path sends already-computed
figures, some resting on the study's historical numbers, and saying otherwise would be a
comfortable overstatement.

**Debt recorded.** TD-075: the report narrative records its model and prompt version but not its
tokens, and the assistant records nothing because nothing it produces is persisted.
### Validation 3 — the trace, the measurement procedure, and three documents

| | |
|---|---|
| Branch / PR | `feat/second-project-and-trace` · PR pending |
| Merge SHA | pending |
| Migrations | **none** |

**Scope delivered.** A read-only trace of *Análisis social* (`docs/PERFORMANCE_BASELINE.md` §12),
which found a duplicated campaign-scope predicate in four tally queries and removed it. An operator
procedure for measuring the region cost behind deployment protection (§13) — the routes, the two
ways in, the table to fill, how to read `db.ms ÷ db.queries`, and who may conclude what.
`docs/CONSULTANCY_DEMO_BRIEF.md` (one page, non-technical Spanish, six questions).
`docs/THESIS_ALIGNMENT.md` (Conditions B and C preserved; A structurally impossible today).
`docs/SECOND_PROJECT_READINESS.md` (every component classified, and what the next study costs).

**Meaningful decisions.** **TD-065 stays open**: the consolidation that would matter is the
per-question loop, and resolving the current campaign once instead of four times would buy three
round trips of eighty-three at the price of passing a campaign id between read models that each
open their own transaction. Correctness wins over query count. **Only the route that changed is
reported**: two `before` runs of another route disagreed by more than the effect under test, so the
rest of the table was dropped rather than dressed up. And the absolute numbers are **not** §11's —
the local database has been accumulating submitted responses from every e2e run since, which is
itself the measurement rule §13 is written around.

**On the thesis**: `human_review.classification_id` is `NOT NULL`, so a coding cannot exist without
a proposal to attach to. That is why Condition A needs a new row shape and a blind mode, and why
`HumanReview` is not a gold standard — the reviewer decided while looking at the proposal.

**On the second project**: nothing was refactored, because nothing needed it. `zamora`, `yantzaza`,
`provial` and the rest appear nowhere in `packages/domain`, `packages/ui`, `packages/application/src`
or the web app's trees, and the pilot's figures appear there only inside five comments.

## Hotfix — the map that framed nothing (7 September 2026)

| | |
|---|---|
| Branch / PR | `fix/gis-multipolygon-camera` · PR pending |
| Merge SHA | pending |
| Migrations | **none** |
| Data | **none touched** — this was a read model and a camera, not a seed |

**The defect.** *Cartografía y predios* opened on an empty grey square. Nothing was missing: 141
parcels with geometry, the 7 361 m centreline and four areas of influence were all in the payload,
and the table listed every one of them. `loadParcelExplorer` computed the opening extent by walking
coordinates **two levels deep**, which is the shape of a `Polygon`; every parcel of this study is
stored as a `MultiPolygon`, so `Math.min` received a ring, the accumulator became `NaN`, and one
multi-part parcel emptied the extent for all 141. `bounds: null` → `center [0, 0], zoom 1`, about
8 700 km from the project, scale bar reading *3000 km*.

**Why nothing caught it.** Every GIS test was green, and each was right: the table, the shared
selection, the filters, the legends and the provenance drawer all describe the *payload*. None of
them could see where the camera was pointing — a canvas has no state a test can read. The
regression now does: the map publishes its viewport and how many parcel polygons are actually drawn,
and the suite asserts the corridor is inside a frame under a degree wide with geometry in it.

**The fix.** A pure `geometryBounds` / `unionBounds` in `@eia/domain` that recurses to the numbers
instead of indexing to a fixed depth, ignoring anything that is not two finite numbers rather than
propagating it. The identical recursive walk already existed **inline in the map component**,
written there after the same mistake broke selection on the first click — the read model was simply
missed. It is now one function, and the client uses it too.

**Two deliberate exclusions.** The areas of influence are not in the opening extent (the indirect
social one is 22 × 28 km against the corridor's 4 × 6, which would make the road a smudge), and
**no base map was added** — the point of the fix is that the project's own cartography is visible
with no external provider at all.

**«Centrar en proyecto».** A real button outside the `aria-hidden` canvas, which is why it can
exist where MapLibre's own controls cannot (IG2-005): it re-frames the extent, and it is the way
back after scrolling has lost the project.

**`loadParcelWorkspace` was audited and left alone.** Its extent comes from PostGIS —
`ST_XMin(ST_Envelope(geom))` and siblings — which is already the envelope of the whole collection;
verified against the real multi-part parcels, and given the multi-part test it lacked.

## Reference basemap (7 September 2026)

| | |
|---|---|
| Branch / PR | `feat/gis-reference-basemaps` · PR pending |
| Merge SHA | pending |
| Migrations | **none** |
| Provider | **none activated** — no account, no key, no request ever made to a tile provider |

**Scope delivered.** A provider-neutral reference basemap under the study's cartography, in four
modes (*Sin fondo* · *Mapa* · *Satélite* · *Relieve*) with MapTiler as the first provider; a
switcher on the map; per-browser preference; attribution; and `docs/BASEMAP_POLICY.md`.

**The principle the shape enforces.** The basemap is **context**, the study's layers are
**evidence**, and they cannot merge by accident: the background is one raster layer with no
provenance record, no entry in the layer legend, no *Ver origen* and no path into a report snapshot.
An e2e test asserts a configured reference service does not appear among the study's layers.

**Two decisions worth naming.** Raster tiles rather than the provider's vector style, because
`setStyle` tears down every source and layer — the project's geometry would be rebuilt on every
background change and would vanish while the new style loaded. And the **centreline moved above the
parcels**: underneath them it was legible on a pale ground and lost against imagery, and the road
is the subject of the study.

**What the wave found.** MapLibre does **not** report a raster tile that answers 404 — no error
event, no failed state, just a background that never appears — and a permanently failing source
stops the map ever reaching `idle`, which had silently disabled the camera instrumentation added in
the previous change. Availability is therefore *asked*: one tile covering the project is fetched,
and anything but a plain success becomes "no background", with the neutral ground and one quiet
line. The suite covers this against a second server configured with a reference service whose tiles
do not exist — no external request, no credential, nobody billed.

**Not activated.** No account was created and no paid service subscribed. `docs/BASEMAP_POLICY.md`
§7 lists the six steps, of which the first — deciding the account and the plan — is the owner's and
costs money.
