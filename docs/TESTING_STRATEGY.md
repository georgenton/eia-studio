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

## 9. Slice 1 — what is actually covered

| Layer | Files | Count |
|---|---|---|
| Domain unit | `packages/domain/test/{forecast,workspace,metrics}.test.ts` | forecast arithmetic and determinism, the surface registry, the closed metric vocabulary |
| Application integration | `packages/application/test/command-center.integration.test.ts` | the read models under real contexts: assigned member, OWNER implicit access, ADMIN denial (D-015), foreign project, foreign provenance id |
| Database isolation | `packages/testing/test/rls/slice1-project-data.integration.test.ts` | cross-tenant read and mutation on the five new tables, forged project context, no-context denial, and the integrity constraints (single value, non-empty transformations, closed enum, no self-edge, cross-tenant FK) |
| End to end | `e2e/{journey,authorization,admin,anonymous}.spec.ts` | the reviewer journey, the provenance drawer with focus and Escape, the disabled-capability URL, the unassigned project, the unauthenticated redirect, D-015 in the browser |
| Screenshots | `e2e/screenshots.spec.ts` → `docs/screenshots/slice-1/` | our regression baseline, not a pixel comparison with the design bundle |

The e2e suite authenticates once per role in a setup project and reuses the stored session: the
identity layer rate-limits sign-in, and re-authenticating per test made the suite both slower and
flaky. It never creates accounts, because public self-signup is disabled; `pnpm e2e:prepare`
provisions synthetic identities from `DEMO_USER_PASSWORD`.

## 15. Test environments: what may be destroyed, and what may not (IG3-001)

A test suite and an environment are two different things, and the difference is not a matter of
care. The integration suite starts every file from a known world — it truncates tenants, projects
and identities — which is correct against a container that lives for one run and destructive
against anything else. Pointed at the persistent staging database it did exactly what it says on
the tin: the synthetic identities went, and the next demo re-seed produced a campaign with no
technicians to assign work to.

So the two are separated by construction, not by convention.

| | Full integration suite | Staging verification |
|---|---|---|
| Command | `pnpm test:integration` (and `pnpm test:rls`) | `pnpm test:staging` |
| Config | `vitest.config.mts`, project `integration` | `vitest.staging.config.mts` (a separate file, so `pnpm test` can never reach it) |
| Database | **only** the Testcontainers PostGIS container the setup creates | a persistent environment named by `EIA_STAGING_MIGRATOR_URL` / `EIA_STAGING_RUNTIME_URL` |
| May truncate, drop, reset, rebuild fixtures | yes | **never** |
| Writes | anything | only inside transactions that always `ROLLBACK` |
| Fixtures | created per file by `packages/testing/src/factories.ts` | the persistent demo seed; the suite reads it and fails with an instruction if it is missing |
| Runs in CI | yes, on an ephemeral database | no — an explicit operator command at a gate |

### 15.1 How "ephemeral" is decided

Not by hostname, not by database name, not by `NODE_ENV`, and not by the absence of a
"this is production" flag: each of those is a guess, and a forgotten environment variable turns a
guess into a wiped environment. Instead the setup that *creates* the throwaway container stamps
it, in the same process, with a marker table holding a token generated in that run:

```
ephemeral_test.marker (token)   -- one row, a fresh random token per run
```

`assertEphemeralTestDatabase(db, token)` requires that the marker exists **and** that its token is
this run's. Every other outcome — no schema, no table, no row, more than one row, a different
token, any error at all — refuses. A persistent database has no marker because nothing but the
container setup writes one, and a copied marker fails because the token is new every run and never
leaves the process. `resetDatabase` calls it before its first statement, so the failure is the
first line of a test file rather than a discovery afterwards. There is no flag, argument or
environment variable that makes it pass: the escape hatch that used to point the destructive suite
at an external database (`EIA_TEST_MIGRATOR_URL`, `EIA_TEST_RUNTIME_URL`) is gone, and setting
those variables now fails the run with an explanation.

The staging suite asserts the same boundary from the other side: a persistent environment that
*did* carry the marker schema would fail its first check.

### 15.2 What the staging suite verifies

Migration ledger at the repository's head; extensions installed; the eleven Slice 3 tables present
with RLS enabled, forced and policied; the policy functions, immutability triggers and provenance
foreign keys installed; the runtime role without superuser or `BYPASSRLS`. Then isolation, through
the runtime role, using the identities actually provisioned there: no context reads nothing, a
forged tenant/project/user widens nothing, one technician cannot reach another's assignment, visit,
response or answers, a technician can reach their own, and `field.responses.read` is what separates
the two. Then the demo baseline — campaign, technicians, assignments, submitted responses,
ownership coherence, no dangling provenance, `DEMO_SIMULATION` on every captured response, the
historical aggregate still `HISTORICAL_OBSERVED` and not derived from demo answers, and no answer
text that looks like an identifier. Finally the installed contracts, each as a rollback probe: a
published version refuses an edit and a delete, its questions refuse a change, a submitted response
refuses a new answer and refuses being moved to another version.

The exhaustive v1→v2 versioning regression stays in Testcontainers, where creating and destroying
questionnaires is free. On staging the question is narrower: is the contract installed and
effective here, and is the environment exactly as it was found.

### 15.3 Proving the suite changed nothing

`pnpm -s staging:baseline` prints ids and counts — identities, memberships, campaign, survey
version, assignments, responses, answers, provenance, parcels — as stable JSON containing no
credential and no personal data. Run it before and after and `diff` the two: identity is what
matters, because a suite that deleted and recreated the campaign would leave every count identical
while destroying the demo.

### 15.4 Local development

`pnpm e2e:prepare` reconciles: it migrates, seeds and provisions the synthetic identities, and now
also **updates an existing identity's credential** to the supplied `DEMO_USER_PASSWORD` instead of
leaving an unknown one in place — which is what previously made "wipe the database" the only way
back in. Emptying a local database is a separate, named, guarded command:

```bash
APP_ENV=local EIA_CONFIRM_RESET=yes-delete-my-local-data pnpm db:reset:local
```

It refuses unless `APP_ENV=local`, the database host is loopback, and the confirmation is present.


## 16. Social Intelligence and the AI boundary (Slice 4)

**CI never calls a model.** The classifier is a port with two adapters, and since IG4-001 it has
**no default**: `SOCIAL_CLASSIFIER=fake` is written explicitly where a test needs it — the
Playwright web server, the queue-drain child process — and nowhere else. The whole suite therefore
runs with a deterministic in-process classifier and needs no credential, and a suite that forgot to
select one would lose assisted coding rather than silently acquire it.

The same rule refuses the fake outside `local` and `test`, so a persistent environment cannot store
keyword-matcher output in `ai_classification` (SECURITY.md §10c.1). There is no fallback in either
direction: an environment configured for the gateway without a key reports
`BLOCKED_EXTERNAL_CONFIG`, because the alternative is fabricated codings that are indistinguishable
from real ones once they are rows.

| Layer | What it proves |
|---|---|
| Availability unit (`packages/domain/test/classifier-availability.test.ts`) | the IG4-001 table: the fake runs only in `local`/`test`, is refused in `preview`/`staging`/`production` and in any environment name nobody anticipated; unset is `NOT_CONFIGURED` everywhere, never a default; a gateway without its credential, or with a model id that does not name its provider, is `BLOCKED_EXTERNAL_CONFIG` and is never demoted to the fake; the detail text names variables and never a secret |
| Worker configuration unit (`apps/worker/test/config.test.ts`) | the worker resolves availability at startup, keeps running without one, and reports each of the three unavailable reasons — `main.ts` constructs the consumer only for `AVAILABLE`, so an unavailable worker never claims |
| Domain unit (`packages/domain/test/social.test.ts`) | taxonomy publishability and hashing, the demo-only gate, output validation including the injection case, confidence banding and its copy, eligibility, the ACCEPTED/CORRECTED derivation, label-set comparison, denominators, validated distribution, bounded retries |
| Application integration (`packages/application/test/social-coding.integration.test.ts`) | the whole journey against a real database: the gate refuses a non-demo run **and the classifier is never invoked**; a run queues one pending row per eligible answer; two concurrent claims take different rows; usage and latency are stored; a specialist accepts one proposal and corrects another and the proposal survives unchanged; validated metrics count human labels; a second review is refused; a technician and a viewer are denied; `social.ai_coding` off leaves tabulation working; **no run and no classification row is written for any of the three unavailable-classifier reasons** |
| Database isolation (`slice4-social.integration.test.ts`) | cross-tenant and no-context denial on all eight tables, ADMIN without membership, the coding tables gated by `field.responses.read` while the scheme stays project-readable, unique constraints, cross-tenant category borrowing, forced RLS |
| Versioning regression (`slice4-taxonomy-versioning.integration.test.ts`) | v1 published → proposal and review made against it → v2 published with changed categories; v1's rows untouched, both codings still resolve to v1, a v2 category cannot be attached to a v1 coding, a published version refuses edit and delete, a submitted review is final, and a second run with a different model and prompt leaves the first run's metadata unchanged |
| End to end (`e2e/social.spec.ts`) | the specialist's journey in a browser, with the queue drained by `pnpm social:drain` and the deterministic fake |
| Accessibility (`e2e/social-accessibility.spec.ts`) | axe over tabulation, workflow, queue, low-confidence and the review workspace; category chips carry text, not colour alone |

**Screenshots of AI states are UI evidence, not model evidence.** Every proposal in
`docs/screenshots/slice-4/` came from the fake classifier; the report says so beside them. A live
model result is only ever produced by an explicit operator smoke against staging.

## 17. Quality Gate (Slice 5)

**A rule is tested by writing down the two values.** The detectors are pure functions from two
values to *a finding or nothing*; they know nothing about the database, so "does this rule fire?"
never needs a fixture. What does need a database is everything about *time*: what a second run does
to a finding somebody already decided, and what changed evidence does to a settled conclusion.

| Layer | What it proves |
|---|---|
| Domain unit (`packages/domain/test/quality.test.ts`) | each rule stays quiet when the sources agree and fires when they differ; accents, case and whitespace are normalised before a mismatch is claimed; a non-calendar date is refused rather than string-compared; a fingerprint identifies the *comparison* and not its values, so a changed figure updates a finding instead of orphaning its decision; the state machine refuses every transition it does not declare; a justification under twelve characters is refused; the vocabulary of invariant 11 holds over the catalogue's copy **and** over every generated finding; the catalogue names no pilot project, province or figure |
| Application integration (`packages/application/test/quality-gate.integration.test.ts`) | the whole journey against a real database: a run raises one finding per real disagreement and reports the rules it could not feed rather than inventing `MISSING_EVIDENCE`; a second run updates and does not duplicate; **a re-run leaves a decided finding decided**, and only changed evidence reopens it with the decision history intact; a coordinator runs and cannot settle, a reviewer settles and cannot run, a technician sees nothing; the capability gates the module whatever the permission says; a change of mind is a second row; the audit log records the transition and never the justification |
| Database isolation (`packages/testing/test/rls/slice5-quality.integration.test.ts`) | cross-tenant and no-context denial on all five tables; the same `QG-001` in two tenants without either leaking; a finding readable **without** `field.responses.read`, because it is project data and not response data; `specialist_review` refused for UPDATE and DELETE by the runtime role *and* by the owning role; a one-sided finding refused at commit and one side of an existing pair undeletable; an assertion with two values, no values, a malformed date, or a claim to come from an ingested document, all refused; forced RLS on every table |
| End to end (`e2e/quality*.spec.ts`) | the coordinator's journey — the surface states what it checks, the run produces the corpus's four known discrepancies, a re-run produces none, both sources appear at equal weight, the evidence says it is reconstructed and carries no page number, and the decision form is absent for a coordinator; the reviewer's — a decision needs a justification, is recorded with its author, a forbidden transition is not even offered, and a change of mind is a second entry; a finding code that means nothing answers 404 |
| Accessibility (axe) | the list, a finding's two panels, and severity/state carried as words rather than only as colours |
| Staging (non-destructive) | the tables, policies, triggers and CHECKs exist; `eia_app` genuinely lacks UPDATE and DELETE on `specialist_review` (privilege introspection, because the `ALTER DEFAULT PRIVILEGES` of migration 0002 makes the REVOKE load-bearing); every assertion is `RECONSTRUCTED_CORPUS` with a source reference; no stored finding declares compliance; and two rollback probes attempt what the CHECKs forbid |

**No AI is involved.** Slice 5's rules are deterministic comparisons; the semantic rule compares two
statements the corpus itself makes, and nothing in this module calls a model. Semantic proposal by
a model remains a later slice, and when it arrives it proposes a finding for a specialist to
validate — it never settles one.

## 18. Document intelligence (Slice 6)

**Cross-tenant retrieval leakage is the critical test.** A retriever takes free text and returns
document content, so a lost scope hands one consultancy another's study. It is checked with the
*same full-text query the retriever runs*, executed under tenant A's context using tenant B's own
distinctive term — and again with a forged scope naming tenant B, which the policy refuses rather
than the predicate.

| Layer | What it proves |
|---|---|
| Domain unit (`packages/domain/test/documents.test.ts`) | chunking is deterministic and its strategy is versioned; chunk hashes are of their own words; a paragraph too long to quote is split at sentence ends and a short tail joins its neighbour rather than becoming a passage nobody would cite; a document flagged `contains_pii` is refused with the reason; codes and version labels follow the product's one convention; a citation names its version always and its page only when the passage sits on one; **an answer may cite only what was retrieved** — an invented index fails the answer rather than being dropped; the strategy's own description does not claim to be semantic |
| Application integration (`packages/application/test/documents.integration.test.ts`) | ingestion writes a version, chunks it and records the strategy; **re-ingesting identical text writes nothing**; corrected text is a new version and the old one keeps its words and its chunk ids; a PII-flagged document is refused before a single row; a technician holds neither read nor write; the capability gates the module and takes the assistant with it; retrieval searches only the current version, so a corrected figure is not re-quoted; no evidence says so and cites nothing; without a generator the passages still answer; an invented citation fails the answer; **hostile text inside a source document is retrieved as ordinary content and grants nothing**; the audit log records the act and never the content |
| Database isolation (`packages/testing/test/rls/slice6-documents.integration.test.ts`) | cross-tenant retrieval leakage, three ways; project scope inside one tenant; no-context retrieval; forged `tenant_id` on insert; a chunk refused for UPDATE and DELETE by the runtime role **and** by the owning role, with the version cascade as the one legitimate route; per-project code uniqueness; forced RLS; **no embedding column and no `vec` schema**, asserted so that adding pgvector is a deliberate act; and the four shapes of a half-formed citation the CHECK refuses |
| End to end (`e2e/documents*.spec.ts`) | the corpus lists and says what kind of text it is; a document shows its passages and states that they do not move; a question returns cited passages naming document, version and passage; no evidence is said plainly; with no generator the passages stand alone with the reason; an unknown code answers 404 |
| Accessibility (axe) | the corpus list with its search form, an answer rendered without a navigation, and a document's passages |
| Staging (non-destructive) | the tables, policies, triggers and index exist; `eia_app` genuinely lacks UPDATE and DELETE on `document_chunk`; every version is `RECONSTRUCTED_EXCERPT` with a null importer; no chunk is orphaned; full-text retrieval finds the corpus and finds none of it outside the project; the Quality Gate's assertions carry their passage links; and two rollback probes attempt what the triggers forbid |

**CI calls no model.** Retrieval needs no credential at all, and the generator is a deterministic
in-process fake selected explicitly (`ASSISTANT_GENERATOR=fake`) by the same no-default rule as the
Social classifier.

## 19. Report generation (Slice 7)

**The test that decides whether a chapter can be believed** is that a provisional AI classification
never becomes a figure in it. Asserted directly against a database holding a proposal and no review:
the themes section says nothing has been validated, and the proposal is verified to exist, so the
result is a refusal to count it rather than an absence of anything to count.

| Layer | What it proves |
|---|---|
| Domain unit (`packages/domain/test/reports.test.ts`) | a fact cannot exist without a source, and an undeclared source kind is refused; a theme figure claiming a count from zero validated codings is refused while the honest empty case is accepted; a snapshot whose fact carries an undeclared regime is refused, so a chapter built partly on simulated data says so at the top; the digest identifies content and not the instant, and survives key reordering; a paragraph may state only figures its section computed, and one that does not fails rather than being corrected |
| Application integration (`packages/application/test/reports.integration.test.ts`) | the whole journey against a real database: a proposal with no review yields "—"; validating it makes the figure appear with its review count; **the earlier version keeps the empty section**; the database refuses to edit or delete a version or a section; regenerating unchanged data produces a new version and reports it as identical; every fact carries a source and the sources are queryable rows as well as snapshot fields; the narrative is attached only when a generator ran, and an ungrounded paragraph fails the generation; a technician may neither read nor generate; the capability gates the module; the .docx is a real Word file named for its version; the audit log records the act and never the chapter's text; every version's provenance is `DERIVED` / `PENDING` |
| Database isolation (`packages/testing/test/rls/slice7-reports.integration.test.ts`) | cross-tenant invisibility on all four tables, including a query against the other tenant's snapshot by project name; forged `tenant_id`; no-context; membership gating; UPDATE and DELETE refused for the runtime role **and** the owning role on versions, sections and sources, with the report cascade as the one legitimate route; one chapter per kind per project; forced RLS |
| End to end (`e2e/reports*.spec.ts`) | the surface states what a version is before one exists and never declares compliance; generating produces one; every figure names its source on screen; the themes section says nothing was validated; regenerating adds a version and keeps every earlier one, with the first marked superseded; the .docx downloads as a real Word file marked a draft; an unknown version label answers 404 and so does its download |
| Accessibility (axe) | the version list and a version's nested figures with their source lines |
| Staging (non-destructive) | the four tables exist on the persistent environment with RLS enabled, forced and policied; the runtime role holds SELECT and INSERT and neither UPDATE nor DELETE; the six immutability triggers are installed and owned by `eia_policy`; a version created inside a rolled-back transaction cannot be amended or deleted even by the owning role, while the cascade from its report is allowed; no chapter exists there, and the inputs one would read do |

**CI calls no model.** The snapshot is arithmetic and SQL; the narrative generator is a deterministic
in-process fake selected explicitly, and the versions CI produces have no prose at all — which is
the shipped behaviour everywhere, since no provider is configured (TD-049).

## 20. The walkthrough, as a test (MVP integration)

Every slice has a spec that proves its own surface. None of them proved the thing a reviewer
actually experiences: that the surfaces are **one product**. `e2e/mvp-journey.spec.ts` walks the
coordinator's path in the order `docs/manual/10-demo-walkthrough.md` describes it and asserts the
seams.

| What it asserts | Why it is a seam and not a feature |
|---|---|
| tenant and project ride the rail across all six destinations | invariant 1 is about the shell, so it can only fail *between* surfaces |
| a parcel selected in the table opens as a workspace | invariant 6's selection is shared state; a per-surface spec cannot see it break |
| the Quality Gate names no compliance conclusion and offers a coordinator no decision form | invariant 11 plus the `quality.write` / `quality.review` split, on the screen where both meet |
| a finding raised before ingestion links into the passage it was transcribed from, and the link resolves | ADR-020 §6's promise spans two slices; nothing inside either one can prove it |
| the assistant answers with passages and says the search is lexical | ADR-021's honesty is a property of what the reader sees, not of the retriever |
| the chapter carries five sections, says BORRADOR, and states no compliance conclusion | ADR-022's output read by the person the demo is for |
| the session can be ended from the topbar | UX-001; a demo that cannot be handed to the next person is not a demo |

It is also the regression guard for the walkthrough document: if a step here changes, that page is
wrong.

**Instrumentation is tested too.** `packages/testing/test/rls/pool-instrumentation.integration.test.ts`
asserts that the performance hook counts statements inside transactions — where nearly all of them
are — and that it is handed a duration and nothing else. A counter that silently sees nothing
reports zero, and zero round trips is indistinguishable from a page that touched no database.
