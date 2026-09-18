# Writing a questionnaire

> How a `SurveyTemplate`, a `SurveyVersion` and its questions come into existence inside the
> product. Related: ADR-037 (the decision), ADR-006 (a published version is immutable), ADR-029
> (one bilingual definition), ADR-030 (*Preparar proyecto*), `docs/PROJECT_INTAKE.md`,
> `docs/OFFLINE_SYNC_PROTOCOL.md`, `docs/TENANCY.md` §3.1.

## 0. Where it is

*Preparar proyecto* → stage 5, **Formularios**
(`/t/:tenant/p/:project/intake?stage=surveys`).

Until Go-Live Wave A a `SurveyVersion` could be created by exactly one thing — the demonstration
seeder — so every questionnaire was a developer task. It is now written here, by the people
preparing the project.

## 1. The model, which did not change

```
SurveyTemplate  (the questionnaire as a concept: "Ficha socioeconómica")
  └── SurveyVersion   DRAFT → PUBLISHED → RETIRED   (the definition answers point at)
        └── SurveyQuestion   code · ordinal · type · prompt · help · required · sensitivity · section
              └── SurveyOption   code · label · ordinal
        └── SurveyQuestionTranslation / SurveyOptionTranslation   (the other language)
```

An answer references a **version**, never a template. That is why the rest of this document is
mostly about when a version may and may not change.

## 2. The lifecycle

| State | What may happen |
|---|---|
| `DRAFT` | rewritten freely, as often as the author likes; deleted |
| `PUBLISHED` | nothing. Not a prompt, not an option's label, not a translation, not a heading |
| `RETIRED` | nothing, and it is never reopened |

Enforced by database triggers (migration 0014 for the version, 0035 for the translations), not by
the use-cases alone: an application rule that lives only in a use-case is one repository call away
from being bypassed.

**Editing a published questionnaire is not offered at any level of the stack.** The way to change
one is *Nueva versión a partir de v1*: the definition is copied into a new `DRAFT`, which becomes
`v2` when it is published. The answers already given keep pointing at `v1`, and `v1` keeps its
words.

Only **one draft per questionnaire** is open at a time, so *what is being written* has one answer.

## 3. Who may do what

| Act | Permission | Roles |
|---|---|---|
| Read the questionnaires and a definition | `project.intake.read` | COORDINATOR, PROJECT_DATA_MANAGER, REVIEWER, VIEWER |
| Write a draft: questions, order, options, the second language | `field.instruments.author` | COORDINATOR, **PROJECT_DATA_MANAGER** |
| Publish it | `field.instruments.publish` | COORDINATOR |

A *Gestor de información* writes the instrument, because that is preparation — a project with no
questionnaire cannot be operated at all — and does not publish it, because deciding that households
will be asked something is a statement the firm makes. Nothing else about the role moved: no
`field.responses.read`, no `pii.read`, no `social.coding.review`, no `quality.review`, no
`portal.publish`.

A `FIELD_TECHNICIAN` holds neither key. They read the questionnaire they must fill in, which is
ordinary project data (SECURITY.md §10b), and write none of it.

## 4. What can be written

The eight question types the product already asks, answers offline, synchronises and counts:

`SHORT_TEXT` · `LONG_TEXT` · `INTEGER` · `DECIMAL` · `BOOLEAN` · `SINGLE_CHOICE` ·
`MULTI_CHOICE` · `DATE`

plus, per question: a **code** (lower snake_case, stable, what an answer points at), a position, a
prompt, optional help text, `required`, a **sensitivity** classification, and a **section**.

Per option of a choice question: a code, a label, a position.

### What cannot, and why

| Not built | Why |
|---|---|
| Conditional logic / skip rules | The domain has never had any. A semantics invented here would be fixed in a device's offline renderer, in a tabulation denominator and in an archive before a real form had asked for it |
| Expressions and calculated questions | A language, which four independent renderers would have to agree about exactly |
| Matrices and repeating groups | Answer identity stops being *one code per answer*, and everything downstream that counts changes with it |
| New question types | Each one is a control on the phone, a validation, a storage column and a tabulation rule |
| Per-question validation rules | The existing constraints (`required`, the type, the option set) are what the field slice validates; a rule language is the same problem as an expression language |

This is a **bounded authoring surface, not a survey designer**, and the boundary is the decision
rather than a stage of one.

## 5. Sections are headings

A `section` is a nullable label on a question, with its own wording in each language. It groups
questions on screen so a long form reads as a form.

It is **not** an entity: no id, no order of its own, no rules, and nothing about an answer depends
on it. Moving a question between headings changes no code, no option, no denominator and not even
the version's `definition_hash` — a unit test asserts that last one, because it is the claim that
would be easiest to quietly break.

One rule: **a heading may not be interrupted.** *Vivienda · Servicios · Vivienda* is a form whose
grouping says one thing and whose order says another. Refused while it is still a draft.

The grouping itself is computed from the questions — `sectionsOf` in `@eia/domain` for the preview,
`localizedSections` in `apps/field` for the phone — rather than stored as a structure, so a heading
can never disagree with the questions it claims to hold.

## 6. Two languages, one definition

`survey_question.prompt` and `survey_option.label` hold the canonical `es-EC` wording. Every other
language is a translation row keyed by question or option id (ADR-029). There is one set of codes,
one `definition_hash`, one denominator and one response.

**A second language is complete or it is absent.** A version carrying any English at all must carry
all of it — every prompt, every heading, every option label — and publication refuses otherwise. A
technician who switched the phone to English and met a Spanish prompt halfway down would be
answering a questionnaire nobody wrote, and the tabulation would count it beside the others as
though they had been asked the same thing.

Checked at **publication**, not at save: a form being written is incomplete, and refusing to store
it until it is finished would mean the author keeps the work in a browser tab.

## 7. What publication does

1. `assertAuthoredVersionPublishable` — the same `assertSurveyVersionPublishable` the field slice
   has always used, plus the locale coverage of §6. Run **before** the status moves, because after
   it the definition cannot be corrected.
2. `definition_hash` is computed and stored (FNV-1a over a canonical rendering — a *detector* of
   drift, not identity; the version's UUID is identity).
3. `published_at` and `published_by_user_id` are written, and both join the columns the version may
   no longer change.
4. `field.survey.published` is audited, with the version label, the question count, the hash and
   the languages — and not one word of the questionnaire's text.

## 8. What reaches the phone

The Field Pack (`docs/OFFLINE_SYNC_PROTOCOL.md`) carries the published version: every question, its
code, its type, its options' codes, its section, and every language — so a technician can switch
with no network.

`FIELD_SYNC_PROTOCOL_VERSION` is **2** as of ADR-037. `packQuestionSchema` is `.strict()`, so
adding `section` to it breaks an older device's parse; the version literal turns that into *your
application is older than this server* rather than a validation error deep inside a questionnaire.
Devices must be rebuilt.

## 9. The contract test

`packages/application/test/survey-authoring.integration.test.ts` is the proof, and it seeds no
questionnaire:

```
author (data manager) → publish (coordinator) → Field Pack → the device's own render
  → an answer captured offline → sync (twice: the second is a duplicate) → deterministic tabulation
```

with one set of codes in both languages throughout. A proof that used the seeder would be proving
the thing this wave replaced.

`e2e/survey-authoring.spec.ts` does the browser half, on a project it creates itself, with no
fixture and no SQL.

## 10. What this does not do

- It does not correct a **submitted response**. That is a different problem with a different shape.
- It does not import a questionnaire from ODK, Kobo or a spreadsheet
  (`docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`).
- It does not decide that a question may lawfully be asked. `sensitivity` is a classification the
  author records; it authorizes nothing, and marking a question `SENSITIVE` asserts nothing about
  whether collecting it is lawful (SECURITY.md §10a).
