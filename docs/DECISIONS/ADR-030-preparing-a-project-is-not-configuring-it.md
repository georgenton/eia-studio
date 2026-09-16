# ADR-030 — Preparing a project is not configuring it, and readiness says only that the product can operate it

- Status: Accepted
- Date: 16 September 2026
- Related: ADR-002 (capability resolution), ADR-003 (project profiles), ADR-016 (route outcomes),
  ADR-018 / D-020 (offline capture is configuration), ADR-020 (the rule catalogue is code),
  ADR-028 (EIA Field), ADR-029 (the product is bilingual), D-015 (roles),
  `docs/PROJECT_INTAKE.md`, `docs/TENANCY.md`, `docs/FEATURES.md`.

## Context

Eight rural-road studies go live on 15 October 2026, and today a project is prepared by running
scripts: `createProject`, then a seeder for the cartography, the questionnaire and the campaign.
That is fine for one pilot and impossible for eight — it makes every new project a developer task
and puts the decisions that shape a study in a terminal nobody audits.

Two questions had to be answered before any screen could be drawn.

**Who prepares a project?** The people who will load eight studies' files, cartography and
questionnaires are data staff, not coordinators. Giving them a coordinator's role would hand them
`field.responses.read`, `quality.review`, `portal.publish` and `pii.read` — the four grants that
decide what a household's answer means, whether a finding is settled, what the customer is told and
who sees identified data. None of that is loading a file.

**What may a "ready" project claim?** A readiness gate is exactly the artefact somebody quotes.
A green tick that a reader could take as *this study is complete* or *this study complies* would be
the Quality Gate's invariant 11 broken from a different direction, by a checklist instead of a rule.

## Decision

### 1. A new project role, not a permission bundle

`PROJECT_DATA_MANAGER` — *Gestor de información* / *Project Data Manager*.

The brief asked whether a bundle would be preferable. It would not, in this codebase: there is no
custom-role mechanism (`Role.system = false` is explicitly out of scope, TENANCY.md §2.3), a
permission set is only assignable by naming it, and CLAUDE.md rule 5 forbids ad-hoc booleans beside
the resolved `PermissionSet`. A "bundle" here would have been a role without a name.

The role's permissions are **code** — `PROJECT_ROLE_PERMISSIONS` in `@eia/domain` — because every
other role's are, and a set that lived half in a table and half in TypeScript is a set nothing keeps
in agreement (the argument ADR-020 makes for the quality rules). The database migration adds one
enum value and nothing else.

### 2. Two new permissions, and the line between them

| Key | Grants | Held by |
|---|---|---|
| `project.intake.read` | open *Preparar proyecto* and read the readiness report | COORDINATOR, PROJECT_DATA_MANAGER, REVIEWER, VIEWER |
| `project.intake.write` | edit the project's identity and the settings under modules that are already on | COORDINATOR, PROJECT_DATA_MANAGER |

`project.configure` is deliberately **not** granted. It is the write side of the capability
resolver, and turning a module off hides routes for everyone on the project. Preparing a project is
filling in what the product needs to run it; deciding which modules it has is a different act, and
the two are two keys.

The data manager's full set: `project.intake.read`, `project.intake.write`, `parcels.read`,
`parcels.write`, `geometry.import`, `field.read`, `documents.read`, `documents.write`,
`provenance.read`. Each because a stage of the intake needs it.

What is **absent** is the role:

- no `field.responses.read` — they never read what a household answered, and the row-level policies
  say so again underneath (SECURITY.md §10b);
- no `pii.read` / `pii.export`;
- no `social.coding.review`, `social.ai.run`, `quality.write`, `quality.review` — they settle
  nothing;
- no `portal.preview` / `portal.publish` — they make no statement to the client;
- no `project.configure`, no `project.members.manage`, nothing tenant-wide.

`field.read` *is* granted, and the distinction matters: it is the operational workflow — campaigns,
assignments, counts — which the readiness report reads. It is not `field.responses.read`, which is
the individual's answer (TENANCY.md §3.1).

### 3. Eight stages, and no workflow engine

*Proyecto · Equipo · Cartografía · Documentos · Formularios · Plantillas · Preparación ·
Activación.* One page, eight sections, one route: `/t/:tenant/p/:project/intake`.

There is no stage table, no transition graph and no stored wizard position, and that is the
decision rather than an omission. A wizard remembers where somebody got to, which is a second story
about the project — and it is the one that goes stale. These stages show **the project as it is**;
a stage the reader skipped is a part of the project they have not filled in, and *Preparación* is
the single place that says which. Nothing is left half-done anywhere but in the project itself.

The surface is registered as a workspace surface under `core.projects`, not a fifteenth capability
key: preparing a project is not a module a tenant buys. The catalogue still holds exactly the 14
approved keys (D-020's rule, applied again).

### 4. Readiness is deterministic, and says one thing

`evaluateReadiness(snapshot)` is a pure function of a snapshot the application reads in **one**
transaction. No clock, no I/O, no randomness: the same picture produces the same report, and a test
states a project in ten lines.

Seven rules, each `satisfied | blocked | not_applicable`, each `required` or `advisory`:

| Rule | Severity | Why |
|---|---|---|
| `project.identity` | required | a project a reader cannot recognise is one nobody can file a deliverable under |
| `project.coordinator` | required | somebody must be answerable: who publishes, approves and hands out work |
| `project.cartography` | advisory | a study begins before its GIS package arrives |
| `project.questionnaire` | required | a campaign resolves answers against a **published** version, for ever (ADR-006) |
| `project.capture_channel` | advisory | a project may be prepared before its first campaign exists |
| `project.offline_channel` | **required** | the D-020 gate, below |
| `project.corpus` | advisory | documents arrive over the life of a study |

Three outcomes rather than two, because a project without `field.surveys` has no questionnaire to
publish and reporting that as a gap teaches a reader to ignore the report. Two severities, because
blocking every project for the weeks a GIS package takes to arrive would do the same.

A rule returns **values**, never a sentence: the surface puts them into the reader's language
(ADR-029).

### 5. The offline gate is stated twice, on purpose

A project whose `field.surveys.offline_mode` is `required` cannot be operated on a channel that
posts to a server. `assertCaptureChannelSatisfiesOfflineMode` already **refuses** that at campaign
activation (ADR-018); `project.offline_channel` now **reports** it during preparation, before
anybody drives to a valley.

Neither is the other's substitute. The report can be read and ignored; the refusal cannot be
reached by a different caller. They share the predicate — `FIELD_OFFLINE_MODE_SEMANTICS
.allowsOnlineOnlyChannel` and `captureChannel(...).supportsOffline` — so they cannot disagree.

### 6. What readiness does **not** mean

> **EIA Studio can operate this project.**
> Not: the study is complete. Not: the study complies.

Said in the copy at the top of the stage and again beside the verdict. A readiness report is about
the *product's* prerequisites; the study's completeness is a specialist's judgement and its
consistency is the Quality Gate's, which itself declares no compliance (invariant 11, ADR-008).

### 7. Activation changes one column

`activateProject` moves `lifecycle` from `planning` to `field`. It activates no campaign, assigns
no work and publishes nothing — a lifecycle transition that silently did those things would be a
button whose blast radius nobody could read off the screen. It recomputes the readiness report
inside the use-case, so the decision rests on the server's picture rather than on whatever the
browser last rendered, and it refuses while a required rule is blocked. Pressing it twice reports
where the project is rather than pretending to move it again.

## Consequences

- Every role matrix, test and fixture gains a row. `PROJECT_ROLES`, `PROJECT_ROLE_PERMISSIONS`, the
  `app.project_role` enum, `vocabulary.projectRole` in both catalogues, and the domain test that
  asserts what the role may and may not do.
- The rail gains a ninth entry, last, because preparation is the place a reader goes *back* to.
- A technician sees that entry and is denied when they open it, which is the designed state rather
  than a 404: the surface exists for this project and the answer is about them (ADR-016).
- **Questionnaire and template *authoring* is not built**, and no permission is minted for it. The
  *Formularios* and *Plantillas* stages report what exists and say plainly that editing arrives
  later; a disabled editor would imply it is one release away, and an unread permission is a switch
  that appears to do something and does not (TD-088).
- The *object storage available* readiness rule the brief lists is **not** in this set: the storage
  adapter lands in the next PR, and a rule whose input nothing can produce would be a green tick
  with nothing behind it. It joins the set with the adapter.
