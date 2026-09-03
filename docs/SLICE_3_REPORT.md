# Slice 3 — FieldFlow / survey foundation

> What was built, what was deliberately left out, and where the implementation departs from the
> approved design bundle and why. Read with `design/reference/claude-design-v0.2/README.md`
> (contract), `docs/DEMO_ZAMORA.md` (what is real and what is a demo simulation),
> `docs/DECISIONS/ADR-018-offline-capture-is-configuration.md` (D-020) and
> `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md` (the boundary a future external capture tool must
> respect).

## 1. The journey this slice delivers

```
Project → FieldFlow → campaign → assignment → visit → published questionnaire
       → answers → draft → submit → progress → Parcel Workspace · Visits
```

FieldFlow stops being a capability-guarded placeholder: `SURFACE_DEFINITIONS.field.implemented`
is now true. One route, `/t/[tenant]/p/[project]/field`, serves two different surfaces chosen by
**permission**, not by role name — a caller with `field.read` gets the coordinator's campaign
overview; a caller with only `field.assignments.read_own` gets their own work. A future role with
the same grants lands on the right screen without that file changing.

## 2. Surfaces

| Surface | Route | State |
|---|---|---|
| FieldFlow — coordinator | `/t/[tenant]/p/[project]/field` | Built: campaign, questionnaire version, capture channel and its offline support, progress counted from the tables, workload per technician (counts, never answers). |
| FieldFlow — My Work | same route, technician view | Built, mobile-first: the technician's own assignments with parcel code, position and state, and one obvious action per card. |
| Assignment / capture | `/t/[tenant]/p/[project]/field/assignments/[assignmentId]` | Built: parcel context, visit with its location outcome, the published questionnaire, draft, submit, read-only after submission. |
| Parcel Workspace · Visitas | `/t/[tenant]/p/[project]/parcels/[code]?tab=visitas` | Built: visit history with state, questionnaire version and provenance. Not the answers. |
| Command Center | `/t/[tenant]/p/[project]` | Gains the **field campaign panel**: submitted / assigned, badged SYNTHETIC, explicitly separate from the concluded study's historical socioeconomic aggregate. |

Route access is unchanged (ADR-016): `field.surveys` ineffective → 404. An assignment that is not
the caller's own also answers **404**, not a denial — a distinguishable error would confirm the row
exists, which is exactly what someone editing ids in the address bar wants to learn.

## 3. Data model

Eleven tables in `app`, each with `tenant_id`, `project_id` where project-scoped, the composite FK
to `project`, RLS `ENABLE` + `FORCE`, and a `provenance_id` with a composite FK to
`provenance_record`. Full shape and the differences from the DATA_MODEL §3.4 specification are in
**DATA_MODEL.md §3.4a**; the decisions worth restating here:

**A campaign is the unit a coordinator works with.** `SurveyCampaign` connects a project, one
published `SurveyVersion` and a set of assignments. It is not a scheduler and holds no routing or
optimisation. An assignment targets **one** parcel (not an array), because an assignment with a
list has no state of its own and no progress to count.

**Answers are typed columns, not a JSON blob.** `survey_answer` fills exactly one of
`text_value`, `number_value`, `boolean_value`, `date_value`, `option_id`; multi-choice selections
are rows in `survey_answer_option`. A blob cannot be constrained, cannot be indexed usefully, and
lets a v2 option code stand where a v1 option belongs — three costs paid entirely by the Social
slice, which is the slice this foundation exists for. Constraint triggers enforce the exclusivity,
the type match against the question, and that a chosen option belongs to *that* question of *that*
version.

**Progress is counted, never stored.** `campaignProgress` divides completed by assignable
(total − cancelled) and returns `null` rather than zero when nothing is assignable. A denormalised
counter is a second truth that drifts the first time a row is updated outside the one use-case
that maintains it. No figure on any of these screens is hardcoded.

## 3a. Versioned questionnaires, enforced by the database

An answer is only interpretable against the question that was asked. If a question meant one thing
when people answered it and someone later edits it to mean another, those answers silently change
meaning and nothing records that it happened. That is the ordinary way a questionnaire evolves
during fieldwork, so it is a database rule, not a use-case rule:

| Trigger | Refuses |
|---|---|
| `survey_version_immutable` | editing or deleting a `PUBLISHED`/`RETIRED` version; reopening a retired one |
| `survey_question_frozen`, `survey_option_frozen` | inserting, editing or deleting any question or option of a non-draft version |
| `survey_instance_rules` | creating a response against a non-published version; any change to a `SUBMITTED` response, including its `survey_version_id` |
| `survey_answer_editable` | inserting, editing or deleting an answer of a submitted response |
| `survey_answer_matches_question` | a value in the wrong typed column, a non-integer for `INTEGER`, an option belonging to another question |

`packages/testing/test/rls/slice3-survey-versioning.integration.test.ts` is the regression: v1 is
published, a response S1 is submitted against it, v2 is then published with a renamed question and
a different option set, and the suite asserts v1's rows, questions and options are untouched, S1
still points at v1, rendering S1 reads v1's definition, and every attempt to edit or re-point it
fails. It runs on the **migrator** connection, which bypasses RLS: a rule only the application
enforces is a rule a future seeder, migration or worker can walk around.

Correction of a submitted response is deliberately **not** implemented (TD-036). When it exists it
will be a reviewed workflow that records who changed what and why, not a row edit.

## 3b. D-020 is closed: offline capture is configuration (ADR-018)

The catalogue stays at fourteen keys. `field.offline_sync` is not created, now or later. Offline
capture is the project configuration `field.surveys.offline_mode ∈ {disabled, optional, required}`
under the existing `field.surveys` capability, and a campaign records its **capture channel** plus
the offline mode in force when it was activated.

```
required ∧ ¬channel.supportsOffline  →  OfflineCaptureUnsupported   (at campaign activation)
```

`NATIVE_WEB.supportsOffline = false`, truthfully: the browser form posts to the server and there is
no queue behind it. So a project that requires offline capture **cannot** activate a campaign on
this channel, and is told so at activation, naming the setting and the channel — instead of losing
a technician's day of work in a valley with no signal. The reasoning, the rejected alternatives and
the shape a future channel takes are in ADR-018; the boundary an external tool would have to
respect is in `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`, written before anyone builds one.

## 4. Authorization: reading a response is its own permission

This is the first data in the product where being on the project is not enough.

| Key | Grants |
|---|---|
| `field.read` | the operational workflow: campaigns, progress, assignments, per-technician counts |
| `field.assignments.read_own` | *my* assignments and nobody else's |
| `field.capture` | start a visit, save a draft, submit — on my own assignments |
| `field.responses.read` | read an individual response and its answers, whoever captured it |

A `FIELD_TECHNICIAN` holds neither `field.read` nor `field.responses.read`. A `GIS_SPECIALIST`
holds `field.read` but not `field.responses.read`: they can see that a parcel was visited without
reading what a household answered.

Enforced twice, deliberately. The use-cases check the permission; and the RLS policies on
`field_assignment`, `field_visit`, `survey_instance` and `survey_answer` add *(this row is mine)
OR `app.can_read_field_responses()`* on top of tenant, project and project access. The second
condition reaches the database as the transaction-local setting `app.field_responses_access`, set
by the application layer from the resolved permission — the same shape as `app.pii_access`. A
caller that forgets to set it sees only its own rows, which is the safe direction to fail in.
`assignee_user_id` and `technician_user_id` are denormalised beside the membership ids precisely so
these policies compare two columns instead of joining `project_membership` from inside a policy
that would itself be evaluated against a policied table.

There is no `if admin return true`. A tenant ADMIN without a project membership reads no field row
at all (D-015), which the integration suite asserts table by table.

## 5. Provenance

Every field row carries a `provenance_id`, and Slice 3 closed a real gap while doing so: the GIS
tables (Slice 2) and the field tables declared `provenance_id NOT NULL` but had **no foreign key**,
so nothing stopped a row naming a record that no longer existed. Migration **0015** adds the
composite `(tenant_id, provenance_id)` FK to all ten provenance-bearing GIS and field tables.

That was not theoretical. The demo seeder used to delete and re-insert provenance records with
fresh ids on every run — invisible while every dependent row was recreated alongside them, and a
dangling reference the moment a row was legitimately *reused*: a published questionnaire the
immutability triggers refuse to delete, or a campaign whose assignments carry submitted responses.
The seeder now derives provenance ids deterministically from the fixture key, so a re-seed updates
records in place, and `pnpm db:check-seeder-idempotency` proves it: snapshot, re-seed, compare
counts **and identities** row by row, then check every provenance reference still resolves. It runs
in CI after `e2e:prepare`.

Captured demo responses are `DEMO_SIMULATION` / `FIELD_CAPTURE` / `ORIGINAL` / `INDIVIDUAL`.

## 6. Historical facts versus demo simulation

The concluded study's **119 socioeconomic surveys** are a historical aggregate of finished
fieldwork. The demo campaign is a running simulation with 12 assignments. They are two different
figures with two different regimes, and this slice keeps them apart everywhere they meet:

- the Command Center's KPI strip carries the historical figure badged `REAL_AGGREGATE`;
- the field panel carries the campaign badged `SYNTHETIC` and says in words that it is not part of
  the concluded study's socioeconomic surveys;
- neither figure is summed into the other, and neither is written in React — the historical one is
  fixture data, the campaign one is counted from the field tables.

`e2e/field-integration.spec.ts` asserts the separation on screen, and the forbidden-strings lint
keeps the pilot's constants out of application code.

## 7. The demo questionnaire contains no personal data

Seven questions, all `NON_PERSONAL`: relationship to the parcel, main economic activity, expected
benefits, whether there is a concern, the concern in the informant's own words, household size,
interview date. It asks for **no** names, identity numbers, phone numbers, email addresses, health
or disability data, individual income, or precise household coordinates.

A visit's location is the **technician's own position** at the time of the visit, captured only
with the browser's permission, and it is never fabricated: a refusal is recorded as `denied`, a
device that cannot get a fix as `unavailable`, and a visit that never asked as `not_attempted`.
A device reporting no usable accuracy (an emulated fix reports zero) keeps its coordinate with the
accuracy recorded as unknown, rather than losing the visit to a schema that rightly refuses a
non-positive distance. Answer payloads are never written to logs.

## 8. Deviations from the approved design

| Deviation | Why |
|---|---|
| The bundle's Field surface is an **inbox of synced records** to validate; this slice built **capture**. | Nothing had ever been captured, so an inbox would have listed the seeder's output. Validation (`field.validate`) is modelled and unimplemented; the inbox arrives with it. |
| The technician surface is not in the bundle at all. | The bundle is desktop-first and FieldFlow mobile was out of scope for v0.2. A technician at a gate needs a phone, so the surface was designed from the touch target up and widened, rather than a desktop table shrunk. |
| The Parcel Workspace's Visitas tab now has data where the bundle shows an empty state. | The state was correct when nothing captured. Instrumentos, Media and Calidad still render the inert "aún sin datos" state naming the module they wait on. |
| No "edit submitted survey" action, which a prototype flow implies. | Invariant: answers are immutable after submission. The design may not override that (ARCHITECTURE §11a); the omission is recorded as TD-036 with the shape a correction workflow must take. |

## 9. Accessibility

The capture form is the most input-dense surface in the product and it runs outdoors on a phone.
Controls are 46 px minimum with 16 px text — the second number because anything smaller makes iOS
zoom the viewport on focus.

Three real defects were found by driving it at a mobile viewport, not by reading the code:

- the sticky action bar and the shell's topbar covered controls a technician scrolled to; the form
  now reserves room for both and questions carry scroll margins;
- a device reporting zero accuracy lost the whole visit to a schema that rightly refuses it;
- text, number and date controls sat inside a `fieldset` whose `legend` names the *group*, leaving
  them with no accessible name at all. Single controls now carry their own `<label for>`; only
  radio and checkbox groups keep the fieldset.

axe (WCAG 2.1 A/AA, failing on `serious` and `critical`) covers My Work, an assignment with its
questionnaire, a submitted read-only response, the refused-location state, the coordinator's
campaign overview and the Parcel Workspace's Visits tab. As before: a green axe run is a
regression net, not evidence of conformance (TD-022).

## 10. Security and tenancy

| Concern | This slice |
|---|---|
| New tables | 11, all with `tenant_id`, `project_id`, composite FK to `project`, RLS ENABLE + FORCE, provenance FK |
| New entry points | `/field`, `/field/assignments/[id]`; server actions `startVisit`, `saveSurveyDraft`, `submitSurveyInstance`, `activateCampaign` — each calls `requireCapability('field.surveys')` and its permission |
| Row ownership | technician-scoped policies on assignment, visit, instance and answer (§4) |
| Client input | every id is validated against the verified context; a malformed UUID is `NotFound`, not a 500; the payload's assignment is resolved *and* re-checked for ownership server-side |
| Harness | `slice3-field.integration.test.ts` — cross-tenant reads and writes, missing context denies, forged tenant/project, technician-vs-technician on all four tables, ADMIN without membership, composite-FK borrowing across tenants |
| PII | none captured (§7) |
| Audit | the material workflow events are audited — campaign activation and survey submission — with actor, project and object; the details carry counts and identifiers only, never an answer, a respondent's words or a coordinate. Ordinary row mutations (starting a visit, saving a draft) are not: an event store that mirrors every write is noise nobody reads |

## 10a. The eleven tables, and how each one is defended (IG3-001 §10)

The audit the gate asked for, in full. Every Slice 3 table is tenant-scoped and project-scoped,
carries the composite foreign key to `project`, and has RLS `ENABLE` + `FORCE` with a select and a
write policy. Where the columns differ is *ownership*: four tables carry an individual's work
directly, two inherit it through a parent, and five hold definitions that belong to the project
rather than to a person.

| # | Table | Tenant | Project | FORCE RLS | Policies | Technician row ownership | Testcontainers | Staging suite |
|---|---|---|---|---|---|---|---|---|
| 1 | `project_configuration` | yes | yes | yes | select + write | not applicable — a project's settings, not a person's work | cross-tenant, no-context, forged context | table + RLS state |
| 2 | `survey_template` | yes | yes | yes | select + write | not applicable — a questionnaire is the questions, not the answers | cross-tenant, no-context | table + RLS state |
| 3 | `survey_version` | yes | yes | yes | select + write | not applicable; immutability instead (trigger) | cross-tenant + the full v1→v2 regression | table, trigger, provenance FK, rollback probes |
| 4 | `survey_question` | yes | yes | yes | select + write | not applicable; frozen with its version | cross-tenant + frozen-definition regression | table, trigger, rollback probe |
| 5 | `survey_option` | yes | yes | yes | select + write | not applicable; frozen with its version | cross-tenant + frozen-definition regression | table, trigger |
| 6 | `survey_campaign` | yes | yes | yes | select + write | not applicable — operational workflow, visible to the project | cross-tenant, readable without `field.responses.read` | table, baseline, provenance FK |
| 7 | `field_assignment` | yes | yes | yes | select + write | **yes**, by `assignee_user_id` | own vs other technician, list scoping, self-reassignment attempt, composite-FK borrowing | own vs other, list scoping, forged ids |
| 8 | `field_visit` | yes | yes | yes | select + write | **yes**, by `technician_user_id` | own vs other | own vs other |
| 9 | `survey_instance` | yes | yes | yes | select + write | **yes**, by `respondent_user_id` | own vs other, draft update, submission attempt | own vs other, submitted-state probes |
| 10 | `survey_answer` | yes | yes | yes | select + write | **inherited** — `EXISTS` over its instance, whose policy has already applied | own vs other, foreign write refused | own vs other, typed-column and option integrity |
| 11 | `survey_answer_option` | yes | yes | yes | select + write | **inherited** — `EXISTS` over its answer | own vs other multi-choice selections | RLS state, no-context, forged context |

Two notes, because a table of "yes" is worth less than the exceptions.

**Why five tables have no ownership rule.** A technician must be able to read the form they are
being asked to fill in. A questionnaire is a definition, not an individual's data, so
`survey_template`, `survey_version`, `survey_question` and `survey_option` follow the ordinary
project-access policy, and what protects them is immutability rather than visibility. The campaign
is the same argument for the operational workflow: that a campaign exists and how far along it is
does not disclose what any household said. No artificial ownership predicate was added to make the
counts line up.

**Why the last two inherit instead of declaring.** `survey_answer` and `survey_answer_option` have
no user column, and denormalising one onto them would create a second place where the truth about
who captured a response lives — the duplicated fact this slice removed everywhere else. Their
policies are `EXISTS` over the parent, whose own policy has already run, so a technician's answer
query sees only their own instances. `survey_answer_option` was the eleventh table and the one the
Gate 2 report's "ten field tables" missed; it now carries a multi-choice answer in the fixture
precisely so its isolation is proved against real rows rather than an empty table.

## 11. Verification

| Suite | Result |
|---|---|
| Unit and domain | **154 passed** — 41 of them the new field suite (offline modes, channel, activation, transitions, progress, publishable questionnaires, the definition hash, answer typing, submission completeness, location schema) |
| Integration (Testcontainers, RLS) | **196 passed** (16 files), including the two Slice 3 suites and the seven cases that prove the destructive helpers refuse an unstamped database |
| Staging verification (non-destructive) | **43 passed** (3 files) against the real provider, twice, changing nothing (§11a.2) |
| End to end (Playwright) | **73 passed** across coordinator, admin, technician, second technician and anonymous projects |
| Seeder idempotency | stable across a second pass, locally and on staging: 141 parcels, 1 survey version, 1 campaign, 12 assignments, 4 responses, 26 answers, 10 provenance records, none re-created |
| Lint, format, typecheck, build | clean |

Two Slice 2 e2e assertions were **corrected rather than preserved**: the "enabled but unbuilt
surface" example moved from FieldFlow to the Quality Gate, and the Parcel Workspace's Visitas tab
now asserts visit history where it previously asserted the empty state. Both were true when
written and became false because this slice built the thing they pointed at.

## 11a. Staging verification, and the boundary that was missing (IG3-001)

The first Slice 3 staging run applied the migrations, exercised the isolation guarantees on the
real provider — and **left staging unusable**. The integration suite truncates tenant and identity
rows between files, which is how each file starts from a known world; against a persistent
environment it removed the synthetic identities the demo campaign assigns work to, and the re-seed
that followed produced a campaign with zero assignments. The remedy on offer was "re-provision
afterwards", which is a habit, not a contract.

Implementation Gate 3 called this blocking, and it was right to. The suite was never the problem;
the missing boundary was. It is now two commands against two kinds of database:

| | `pnpm test:integration` | `pnpm test:staging` |
|---|---|---|
| Database | only the Testcontainers container its own setup creates and stamps | a persistent environment named by `EIA_STAGING_*` |
| May truncate / reset | yes | never |
| Writes | anything | only inside transactions that always `ROLLBACK` |
| Enforcement | `assertEphemeralTestDatabase` verifies a per-run marker token before the first statement; no flag overrides it | fails if the environment carries that marker |

`EIA_TEST_MIGRATOR_URL` / `EIA_TEST_RUNTIME_URL` — the external-database mode that made the damage
possible — no longer exist; setting them fails the run with an explanation. The full contract is in
TESTING_STRATEGY.md §15 and SECURITY.md §12a.

### 11a.1 What the staging suite checks

Schema (9 checks): migration ledger at head, extensions, the eleven field tables with RLS enabled,
forced and policied, no table in `app`/`audit` without forced RLS, the policy functions, the seven
immutability and typing triggers, the five provenance foreign keys, and a runtime role with no
superuser and no `BYPASSRLS`.

Isolation (12 checks), through the runtime role with the identities actually provisioned there: no
context reads nothing; a tenant without a user is not enough; forged tenant, project and user ids
widen nothing; a technician sees their own assignment and not the other's; their assignment list
contains only their own work; they cannot read another's visits, responses or answers; they can
read their own submitted response and its answers; the questionnaire stays readable; a caller with
`field.responses.read` sees the project's responses and the same caller without it sees none.

Fixture and contracts (14 checks): the demo baseline (campaign, published version, both synthetic
technicians as project members, the documented assignment and submitted-response counts, every
assignment owned by a project member, every response captured by the assignment's own technician,
no dangling provenance); demo/historical separation (`DEMO_SIMULATION` on every captured response,
the historical socioeconomic aggregate still `HISTORICAL_OBSERVED` and not derived from demo
answers); no personal data (no question marked personal, no answer text shaped like an identifier);
and five rollback probes — a published version refuses an edit and a delete, its questions refuse a
change, a submitted response refuses a new answer and refuses being moved to another version —
followed by a re-read asserting the baseline is exactly as it was found.

The exhaustive v1→v2 versioning regression stays in Testcontainers. On staging the question is
narrower: is the contract installed and effective here, and did verifying it change anything.

### 11a.2 Results

Staging was restored first — the identities the earlier run removed were re-provisioned with an
operator-supplied `DEMO_USER_PASSWORD`, and the demo project re-seeded — then verified twice with
a full snapshot taken before, between and after.

| Step | Result |
|---|---|
| Restoration (`pnpm e2e:prepare` against staging) | 4 synthetic identities created through Better Auth, 4 tenant memberships, 3 project memberships; the campaign then seeded with **12 assignments · 4 submitted responses** |
| Baseline before verification | 16 migrations · 141 parcels · 1 template · 1 published version · 7 questions · 15 options · 1 campaign · 12 assignments · 4 visits · 4 responses · 26 answers · 8 multi-choice selections · 10 provenance records · 9 metrics · **no dangling provenance** |
| Staging verification, run 1 | **43 passed** (3 files) |
| Snapshot after run 1 vs before | **identical** — byte-for-byte, ids and counts |
| Staging verification, run 2 | **43 passed** |
| Snapshot after run 2 vs after run 1 | **identical** |
| Seeder idempotency on staging | stable across a second pass; snapshot after the re-seed **identical** to the one before it |
| `postgres-gis` | deployment SUCCESS; served the restoration, two verification runs and two seeds without a restart |
| `worker` | deployment SUCCESS; heartbeats continuous, `pending: 0`, ~23 h uptime, no error line through any of the above |

"Identical" is the whole claim, so it is worth saying what it covers: every auth identity, app
user, tenant, project, tenant membership, project membership, campaign, survey version, question,
option, assignment, visit, response, answer, provenance record and parcel — **by id**, not by
count. A run that had deleted and recreated the campaign would keep every count and fail this.

Staging is demonstrable: a reviewer signs in as `coordinadora@demo.invalid` and sees the demo
campaign with its 12 assignments and submitted progress, or as `tecnico@demo.invalid` and sees
their own assignments and nobody else's. Running the verification suite again does not change that.

Nothing was deployed. Staging still runs the `main` build (Slice 2); these migrations are additive,
so that build is unaffected by them. Production was not touched.

## 12. What this slice does not do

Named plainly, so nothing here reads as an oversight:

- **No offline capture** (ADR-018, TD-035) — and no pretence of it.
- **No correction of a submitted response** (TD-036).
- **No media capture** — the Media tab renders the inert state (TD-037).
- **No identified respondents, no PII, no consent records** (TD-038); before the compliance gate.
- **No cross-version aggregation** — no `QuestionMapping` until something aggregates (TD-039).
- **No field-inbox validation workflow** — `field.validate` is modelled, not built.
- **No questionnaire authoring UI.** Versions come from the fixture; the surfaces render published
  definitions and no code path here writes a question, an option or a version.
- **No Social Intelligence, Quality Gate, RAG, Reports or Client Portal.** No embeddings, no
  pgvector, no LLM call — this slice touches none of it.
- **No external capture adapter** — only the contract that one would have to satisfy.
