# Onboarding a road: the intake sheet

> One sheet per road, filled in by the people who have the answers, before anybody touches the
> product. Eight copies of §2 are what the programme needs. Related: `docs/PROJECT_INTAKE.md` (the
> surface that consumes this), `docs/SURVEY_AUTHORING.md`, `docs/GIS_IMPORT_CONTRACT.md`,
> `docs/CONSULTANCY_TEMPLATE_REQUEST.md`.

## 0. Status

| | |
|---|---|
| Roads with real metadata received | **0 of 8** |
| Road projects on **staging** | **1 of 8** — the pilot, and it is **operable**. Measured 18 September 2026 with `pnpm go-live:doctor` against the staging database |
| What is blocking | **client data**, not engineering. Every field in §2 is somebody else's to supply |

**No fake road projects have been created.** Eight rows in a table would make a screenshot and
prove nothing; the product already demonstrates that a second project can be created through its own
surfaces (`e2e/second-project.spec.ts`), which is the part that was ours to prove.

Until a sheet arrives, that road's line reads **WAITING FOR CLIENT DATA**.

## 1. How to use this

1. Copy §2 into a new file or a message, one per road. Fill in what is known; leave the rest.
2. A field nobody can answer stays **WAITING FOR CLIENT DATA**. Do not guess — a guessed canton or a
   guessed corridor length becomes a figure in a deliverable.
3. When the sheet is complete enough for stages 1–3, somebody with `projects.create` creates the
   project on the Portfolio and works through *Preparar proyecto*.
4. The **readiness report** in that surface, not this sheet, says whether the product can operate
   the project. This sheet is what you need in order to fill it in.

**Order matters for exactly one thing.** Cartography before the questionnaire is convenient;
questionnaire before campaign is **required**, because a campaign resolves its answers against a
published version for ever (ADR-037). Everything else can arrive in any order.

## 2. The sheet

### Road *N* — ____________________

#### 2.1 Project

| Field | Value | Notes |
|---|---|---|
| Official title of the study | | The full title as it appears on the deliverable. It reaches the cover page |
| Internal name | | Short, what people say out loud. Shown in the rail and the switcher |
| URL slug | | Lower case, hyphenated, permanent. Appears in every link people share |
| Programme / reference | | e.g. the IDB operation number and the contract reference |
| Canton | | |
| Province | | |
| Estimated start | | |
| Estimated end | | |

#### 2.2 Team

One person may hold more than one role; a role may be held by more than one person. **A coordinator
is required** — the readiness report blocks without one.

| Role | Person(s) | Email | Notes |
|---|---|---|---|
| Coordinator *(required)* | | | Publishes the questionnaire, activates campaigns, decides what the client sees |
| Project data manager | | | Loads files and prepares the project. **Reads no responses** |
| GIS specialist | | | Imports cartography |
| Social specialist | | | Reads responses, codes open answers, requests corrections |
| Field technicians | | | One line each. They need a device |
| Reviewer | | | Settles quality findings; checks a publication before it goes out |

#### 2.3 Cartography

| Field | Value | Notes |
|---|---|---|
| Alignment / corridor | | File, format, and who provides it |
| Parcels | | Count if known, and the source |
| Influence areas | | Direct and indirect, if delivered as geometry |
| Source CRS | | The EPSG code the data **arrives** in |
| Analysis CRS | | A **projected** code for metric work. Never assumed (ADR-017) |
| Licence / provenance | | Who owns it and what the terms permit. §2.6 of the privacy checklist asks |
| Import status | ☐ not received ☐ received ☐ imported ☐ active | |
| Personal attributes | | **Must be removed before import** (ADR-023). Owner names and contact details are not imported |

#### 2.4 Documents

| Field | Value | Notes |
|---|---|---|
| Source corpus | | What the firm is handing over: study, annexes, minutes, PGAS chapter |
| Privacy classification | | Every version defaults to `REVIEW_REQUIRED`, meaning *nobody has looked*. Somebody must |
| Contains identified data? | | An attendance register does |
| Scanned or digital | | A scanned PDF becomes `REQUIRES_OCR`, **contributes no passage and can never be cited**. OCR is not built (TD-098) |
| Extraction status | ☐ not uploaded ☐ queued ☐ ready ☐ requires OCR ☐ failed | |
| Storage available? | | **No bucket exists anywhere yet.** Until one does, no document can be uploaded at all |

#### 2.5 Field

| Field | Value | Notes |
|---|---|---|
| Questionnaire | | Does this road use the same instrument as another, or its own? |
| Written in the product? | ☐ yes ☐ to be written | *Preparar proyecto → Formularios* (ADR-037) |
| Published version | | `v1`, `v2` … A campaign names one for ever |
| Languages | ☐ es-EC only ☐ es-EC + en | English is **complete or absent**; a half-translated version cannot be published |
| Offline required? | ☐ disabled ☐ optional ☐ **required** | `required` refuses a capture channel with no offline support — which the web channel is |
| Technicians assigned | | Each needs a device and an account |
| Campaign | ☐ not created ☐ draft ☐ active ☐ closed | |
| Devices | | **No build exists yet** (G6). Until one does, capture is web-only and therefore online-only |

#### 2.6 Templates

| Field | Value | Notes |
|---|---|---|
| Required deliverables | | Which documents this road must produce |
| Official template versions | | The firm's `.docx`, per deliverable. **None has been received** — `docs/CONSULTANCY_TEMPLATE_REQUEST.md` |
| Template activated in the product? | ☐ no ☐ yes, version ____ | Activation is a decision behind `deliverables.approve` and freezes the version |

#### 2.7 Storage

| Field | Value |
|---|---|
| Object storage available for this environment? | ☐ no ☐ yes, bucket configured |
| If no | Documents, photographs, templates and generated files are all unavailable. **This blocks §2.4 and §2.6 entirely** |

#### 2.8 Readiness

Filled in **from the product**, not by hand — *Preparar proyecto → Preparación* computes it from the
project as it is. This table is where the answer is recorded for the programme.

| Rule | Severity | Outcome |
|---|---|---|
| `project.identity` | required | |
| `project.coordinator` | required | |
| `project.questionnaire` | required | |
| `project.offline_channel` | required | |
| `project.cartography` | advisory | |
| `project.capture_channel` | advisory | |
| `project.corpus` | advisory | |
| `project.storage` | advisory | |

| | |
|---|---|
| **Operable?** | ☐ yes ☐ no |
| Blockers | |
| Activated (out of planning)? | ☐ no ☐ yes, on ____ |

**What "operable" means, and what it does not.** It means *EIA Studio can operate this project*. It
does **not** mean the study is complete, that its documents agree, or that anything complies. Those
are a specialist's conclusions and a Quality Gate's findings (invariant 11).

## 3. The programme roll-up

Kept here; `pnpm go-live:doctor` prints the live version of the last two columns.

| # | Road | Slug | Sheet received | Project created | Operable |
|---|---|---|---|---|---|
| 1 | Puente del Amor – Los Hachos *(pilot)* | `puente-del-amor` | partial — the study's own data | **yes** | see the doctor |
| 2 | | | WAITING FOR CLIENT DATA | no | — |
| 3 | | | WAITING FOR CLIENT DATA | no | — |
| 4 | | | WAITING FOR CLIENT DATA | no | — |
| 5 | | | WAITING FOR CLIENT DATA | no | — |
| 6 | | | WAITING FOR CLIENT DATA | no | — |
| 7 | | | WAITING FOR CLIENT DATA | no | — |
| 8 | | | WAITING FOR CLIENT DATA | no | — |

## 4. What blocks a road, and in which order

| Blocker | Blocks | Owner |
|---|---|---|
| The sheet in §2 | **Everything.** A project cannot be created without a name and a slug | Carlos / the consultancy |
| No coordinator | Readiness, therefore activation | The consultancy |
| No object storage | Documents, photographs, templates, generated files | Jorge (account + bucket) |
| No questionnaire | Readiness, therefore any campaign | The consultancy (content) + a data manager (writing it) |
| No mobile build | Offline capture. **Not** online web capture | Jorge (Expo account) |
| No templates | Generated deliverables. Nothing else | Carlos |
| Privacy review not signed | **Real data of any kind** | Jorge + legal |

The last row is the one that gates the other seven for **real** data. Everything above it can be
prepared with synthetic data first, and should be.
