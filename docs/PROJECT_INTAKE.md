# Preparing a project

> Decision: ADR-030. Related: ADR-003 (project profiles), ADR-016 (route outcomes), ADR-018 /
> D-020 (offline capture is configuration), ADR-029 (the product is bilingual), `docs/TENANCY.md`
> §2–§3, `docs/FEATURES.md` §4.

## 1. What this surface is for

Eight rural-road studies cannot each be a developer task. *Preparar proyecto* / *Project setup* is
where an authorised person fills in what EIA Studio needs in order to run a project — and where
the product says, in one place, what is still missing.

It is reached at `/t/:tenant/p/:project/intake`, governed by the `core.projects` capability and by
`project.intake.read`.

## 2. Who does what

| Act | Who | Key |
|---|---|---|
| Create the project shell | tenant OWNER / ADMIN | `projects.create` (tenant-scoped) |
| Assign people to it | COORDINATOR, OWNER / ADMIN | `project.members.manage` |
| Turn a module on or off | COORDINATOR, OWNER / ADMIN | `project.configure`, `modules.manage` |
| **Prepare the project** | COORDINATOR, **PROJECT_DATA_MANAGER** | `project.intake.write` |
| Read how far preparation has got | + REVIEWER, VIEWER | `project.intake.read` |

### The Project Data Manager

*Gestor de información* / *Project Data Manager*. A project role, not a tenant one: a data manager
is assigned to a project, like every other project role, and has no standing outside it.

**Holds:** `project.intake.read`, `project.intake.write`, `parcels.read`, `parcels.write`,
`geometry.import`, `field.read`, `field.instruments.author` (ADR-037), `documents.read`,
`documents.write`, `provenance.read`.

**Does not hold, and this is the role:**

- `field.responses.read` — they never read what a household answered. `field.read` (campaigns,
  assignments, counts) is a different grant, and the row-level policies enforce the distinction
  again underneath (SECURITY.md §10b).
- `pii.read`, `pii.export`.
- `field.instruments.publish` — they **write** the questionnaire and do not decide that households
  will be asked it. Writing the instrument is preparation; publishing it is a statement the firm
  makes (ADR-037).
- `social.coding.review`, `social.ai.run`, `quality.write`, `quality.review` — they settle nothing.
- `portal.preview`, `portal.publish` — they make no statement to the client.
- `project.configure`, `project.members.manage`, and anything tenant-wide.

A person who loads a project's files is not thereby a person who may read what a family said to a
technician. `packages/domain/test/readiness.test.ts` asserts each of those absences by name, so a
later convenience cannot quietly add one.

## 3. The eight stages

One page, eight sections, one route. There is **no workflow engine**: no stage table, no transition
graph, no stored position. A stage shows the project as it is; a stage the reader skipped is simply
a part of the project they have not filled in, and *Preparación* is the one place that says which.

| # | Stage | What it shows | Editable |
|---|---|---|---|
| 1 | Proyecto / Project | short name, official title, programme reference, location, offline-capture policy; profile and lifecycle read-only | yes |
| 2 | Equipo / Team | who is on the project and in what role, active and suspended | no — assigning is the coordinator's act |
| 3 | Cartografía / Cartography | active layer versions and parcels with geometry | no — importing uses the product's import contract |
| 4 | Documentos / Documents | the corpus by code, its current version and how many versions exist | no in this wave |
| 5 | Formularios / Questionnaires | every version, published or draft, the languages it carries (ADR-029), **and where a questionnaire is written** (ADR-037) | yes — `field.instruments.author`, and `field.instruments.publish` to publish |
| 6 | Plantillas / Templates | what the project's profile brings: instruments and the consistency rule set | no — see §6 |
| 7 | Preparación / Readiness | the deterministic report | — |
| 8 | Activación / Activation | move the project out of planning | yes, when operable |

The *Documentos* stage states the distinction the brief asks for in as many words: **uploaded is
not processed**. A document that exists in the corpus is not yet a document whose passages can be
cited.

## 4. Readiness

```
evaluateReadiness(snapshot) → { checks, operable, blocking, advisory }
```

A **pure function of a snapshot** the application reads in one transaction. No clock, no I/O, no
randomness — the same picture gives the same report, and a test states a project in ten lines. A
check that queried as it went would be a set of rules each seeing a different instant.

| Rule | Severity | Satisfied when |
|---|---|---|
| `project.identity` | required | short name, official title and location are all present |
| `project.coordinator` | required | at least one **active** COORDINATOR membership |
| `project.cartography` | advisory | an active layer version and at least one parcel with geometry |
| `project.questionnaire` | required | at least one **published** SurveyVersion |
| `project.capture_channel` | advisory | the project's campaign declares a channel |
| `project.offline_channel` | **required** | §5 |
| `project.corpus` | advisory | at least one document |

Three outcomes — `satisfied`, `blocked`, `not_applicable` — because a project without
`field.surveys` has no questionnaire to publish, and reporting that as a gap teaches a reader to
ignore the report. Two severities, because blocking every project for the weeks a GIS package takes
to arrive would do the same. Only a **required** rule that is blocked stops activation.

A rule returns **values**, not a sentence. `{ missing: "officialTitle, locationLabel" }`, not "the
official title is missing" — the surface puts the values into the reader's language (ADR-029).

## 5. The offline gate (D-020)

A project whose `field.surveys.offline_mode` is `required` cannot be operated on a capture channel
that needs a connection to submit. The rule is stated **twice**, deliberately:

- `project.offline_channel` **reports** it while the project is being prepared — before anybody
  drives to a valley;
- `assertCaptureChannelSatisfiesOfflineMode` **refuses** campaign activation (ADR-018).

Neither replaces the other: a report can be read and ignored, a refusal cannot be reached by a
different caller. They share the same two predicates, so they cannot disagree.

Today exactly one channel earns it: `EIA_FIELD_MOBILE` (ADR-028). The native web channel declares
`supportsOffline: false`, truthfully.

## 6. What preparing a project does **not** include

- **Authoring report templates.** The *Plantillas* stage reports what the profile brings. A firm's
  own `.docx` is uploaded and activated under *Informes* (ADR-036), not here.

  Authoring **questionnaires** was in this list until Go-Live Wave A, and is not any more: stage 5
  is where a `SurveyVersion` comes from (ADR-037, `docs/SURVEY_AUTHORING.md`). Two permissions were
  minted for it, and neither is an orphan — both are read by that stage and by the use-cases behind
  it.
- **Importing cartography.** The GIS stage reports status; importing uses the product's own import
  contract (`docs/GIS_IMPORT_CONTRACT.md`). This screen converts no formats and reimplements no
  QGIS.
- **Uploading documents.** The corpus stage lists what is there. Upload arrives with object storage.
- **Object storage readiness.** The rule the brief lists joins the set with the adapter; a rule
  whose input nothing can produce would be a green tick with nothing behind it.

## 7. Activation

`activateProject` moves `lifecycle` from `planning` to `field` and **changes one column**. It
activates no campaign, assigns no work and publishes nothing: a transition that silently did those
things would be a button whose blast radius nobody could read off the screen.

It recomputes the readiness report inside the use-case, so the decision rests on the server's
picture rather than on whatever the browser last rendered, and refuses while a required rule is
blocked. Pressing it twice reports where the project is rather than pretending to move it again.
Both the update and the activation write an audit line (`project.intake.updated`,
`project.activated`).

## 8. What readiness is not

> **EIA Studio can operate this project.**
> Not *the study is complete*. Not *the study complies*.

The copy says so at the top of the stage and again beside the verdict, because a green tick is
exactly the artefact somebody would otherwise quote. Completeness is a specialist's judgement;
consistency is the Quality Gate's, and that module declares no compliance either (invariant 11).
