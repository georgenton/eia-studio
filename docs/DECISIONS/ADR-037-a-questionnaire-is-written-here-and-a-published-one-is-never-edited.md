# ADR-037 — A questionnaire is written inside the product, and a published one is never edited

- Status: Accepted
- Date: 17 September 2026
- Related: ADR-006 (immutable survey versions), ADR-018 (offline capture is configuration),
  ADR-028 (EIA Field, the offline device), ADR-029 (one bilingual definition), ADR-030 (preparing a
  project is not configuring it), ADR-036 (validation is a fact, activation is a decision),
  CLAUDE.md rule 9 (answers are immutable; corrections are new instances).
- Amends `docs/TENANCY.md` §3.1 and §3.5 (two new project permissions) and
  `docs/OFFLINE_SYNC_PROTOCOL.md` (protocol version 2).

## Context

Eight road studies are about to be prepared, and until this change a `SurveyVersion` could be
created by exactly one thing: `packages/application/scripts/seed-demo-project.ts`. Every
questionnaire was therefore a developer task, which is not a product — it is a service contract
with a repository attached. `docs/PRODUCTION_V1_GO_LIVE.md` has carried it as a blocker since the
wave opened, and *Preparar proyecto* (ADR-030) has had a stage called **Formularios** that could
only ever report what somebody else had seeded.

The temptation at this point is to build an instrument designer: expressions, skip logic,
calculated fields, matrices, repeating groups, a type system for questions. That is a **language**,
and a language has to be interpreted identically by the web form, by the phone, by the tabulator
and by whatever reads the archive in five years. The moment two of those disagree, an answer means
two things and nobody can tell which.

## Decision

### 1. The authoring surface writes the questionnaire this product already knows how to ask

The eight existing `QUESTION_TYPES`, their options, their order, their `required` flag, their
sensitivity classification, and a second language for the words. Every field on the screen maps to
a column that already existed, which is why the phone renders what is written here without a second
interpreter and the tabulation counts it without a second rule.

**Not built, and not by omission:** no conditional logic, no expression syntax, no calculated
question, no matrix, no repeating group, no new question type, no per-question validation language.
Conditional logic in particular was considered and refused: the brief conditioned it on the domain
already supporting it, and the domain supports none — inventing a semantics for *show Q7 when Q3 is
`owner_occupier`* here would fix that semantics in a device's offline renderer, in a tabulation
denominator and in an archive, before any real form had asked for it.

### 2. A draft is a document; a published version is a fact

`saveSurveyDefinition` replaces the **whole** definition of a `DRAFT`. A questionnaire being
written is one thing a person is editing, not a sequence of row mutations somebody has to keep
consistent, and a partial save would leave a form that is half of two different forms.

Delete-then-insert rather than a diff, because a diff has to decide what "the same question" means
across an edit and the only honest answer is its code — which is precisely what an author may be
changing. That is safe here and nowhere else: it runs only on a `DRAFT`, which by construction has
no answers, and migration 0014's trigger refuses it on anything else.

**Editing a published version is not offered, at any level.** `createSurveyDraft` with
`copyFromVersionId` is how a published questionnaire is "changed": the copy becomes the next
version, and the answers already given keep pointing at the definition they were given (ADR-006,
CLAUDE.md rule 9). Only one draft per questionnaire is open at a time, so *what is being written*
has one answer.

### 3. Writing it and deciding it is asked are two permissions

| Key | Grants | Held by |
|---|---|---|
| `field.instruments.author` | edit a DRAFT definition: questions, order, options, the second language | COORDINATOR, PROJECT_DATA_MANAGER |
| `field.instruments.publish` | publish it — from that moment a campaign resolves answers against it for ever | COORDINATOR |

This is the split the Quality Gate already makes between running a check and settling a finding,
and ADR-036 makes between validating a template and activating it. `PROJECT_DATA_MANAGER` gains the
first because writing the instrument *is* preparation — a project with no questionnaire cannot be
operated at all — and not the second, because deciding that households will be asked something is a
statement the firm makes and this role makes none.

Nothing else moved. The role still holds no `field.responses.read`, no `pii.read`, no
`social.coding.review`, no `quality.review` and no `portal.publish`, and an integration test asserts
each absence. Neither key is an orphan: both are consumed by the *Formularios* stage and by the
use-cases behind it, in this change.

### 4. A section is a heading, and the design is that it is nothing else

A long form must read as a form rather than as a list, so a question carries a `section` — a nullable
text column on `survey_question`, and the same in `survey_question_translation` for the other
language.

It is **not** an entity. No id, no ordering of its own, no rules, and nothing about an answer
depends on it. A section table would have been a second thing a tabulation could be grouped by, and
there is exactly one: the question code. A unit test asserts that moving a question between headings
does not change `surveyVersionHash`, because it changes nothing an answer means.

The one rule it does carry is that a heading may not be **interrupted**: *Vivienda · Servicios ·
Vivienda* is a form whose grouping says one thing and whose order says another, and every renderer
would have to guess which. Refused while it is still a draft, because after publication nothing is
correctable.

The grouping itself is **computed from the questions** — by `sectionsOf` in the domain for the
authoring preview, and by `localizedSections` on the device — rather than sent as a structure. A
heading can therefore never disagree with the questions it claims to hold.

### 5. A second language is complete or it is absent

The identity of a question is its code, and of an option its code within that question, **in both
languages**, because there is one definition and the other language is rows hanging off it
(ADR-029). So a version that carries any English at all must carry all of it: every prompt, every
heading, every option label. A technician who switched the phone to English and met a Spanish prompt
halfway down would be answering a questionnaire nobody wrote, and the tabulation would count it
beside the others as though they had been asked the same thing.

Checked at publication, not at save, for the reason §2 gives: a form being written is incomplete.

### 6. The protocol version goes to 2

`packQuestionSchema` is `.strict()`, so a new field on it breaks an older device's parse — the rule
`COMMAND_TYPES` already states, and the reason `media.declare` could be added without a bump while
this cannot. A device built against version 1 now fails the version literal, which produces *your
application is older than this server* rather than an unexplained validation error deep inside a
questionnaire. No build is in anybody's hands (`docs/FIELD_MOBILE_BUILDS.md`), so the cost is a
rebuild.

### 7. Provenance

A draft opens with its own `ProvenanceRecord`: regime `LIVE_OPERATIONAL`, origin `SYSTEM_GENERATED`
— produced here rather than imported — transformation `ORIGINAL`, granularity `AGGREGATE`. The
method text says in words that a person wrote it in the Formularios stage. `survey_version` gains
`published_by_user_id`, which joins the columns a published version may no longer change, because
who decided that households would be asked this is part of what was decided.

Two audit lines, and deliberately not three: `field.survey.drafted` when a definition is opened for
editing, and the existing `field.survey.published` when somebody decides. Saving a draft is not
audited — a row per keystroke is noise nobody reads, and what the draft finally said is what
publication records. Neither line carries a prompt, an option's words or a heading.

## Consequences

- Two new project permissions, two additive migrations (0048 columns, 0049 a CHECK and one
  `CREATE OR REPLACE` of the existing immutability function), and **no new table**. The rules that
  make this safe — a DRAFT is free, a PUBLISHED version is frozen, a translation is frozen with the
  definition it belongs to — were already in migrations 0014 and 0035; this change is built on them
  rather than beside them.
- `FIELD_SYNC_PROTOCOL_VERSION` is 2. Devices must be rebuilt.
- The *Formularios* stage of *Preparar proyecto* is now where a questionnaire comes from, and the
  copy that said authoring "arrives in a later phase" is gone.
- `packages/application/test/survey-authoring.integration.test.ts` is the contract test: author →
  publish → Field Pack → the device's own render → an answer captured offline → sync → deterministic
  tabulation, in both languages, with one set of codes throughout. It seeds no questionnaire, which
  is the point.

## What this does not do

- **It is not a survey designer**, and §1 lists what that costs.
- It does not correct a submitted response. A correction to *an answer* is a different problem with
  a different shape, and it is ADR-038's.
- It does not import a questionnaire from ODK, Kobo or a spreadsheet. The adapter contract is still
  `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`, and nothing in this change assumes one.
- It does not decide that a question may lawfully be asked. `sensitivity` is a classification the
  author records; it authorizes nothing, and marking a question `SENSITIVE` asserts nothing about
  whether collecting it is lawful (SECURITY.md §10a).
