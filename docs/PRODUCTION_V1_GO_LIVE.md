# Production V1 — the road to 15 October 2026

> The commercial project is approved: **eight rural-road projects**, in production, with an
> operational go-live of **15 October 2026**. This page is the honest state of that: what exists,
> what each wave added, and what still stands between here and a production deployment.
>
> Nothing here authorises a production deploy. Production remains manual and gated
> (`docs/DEPLOYMENT.md` §6, CLAUDE.md rule 20).

## 1. What Wave 1 delivered

**EIA Field**, a first-party Android/iOS application for offline capture, and the server half that
makes it safe (ADR-028). The invariant it was built to satisfy:

> sign in → download → lose all connectivity → close and reopen → capture → submit on the device →
> reconnect → synchronise → the same work appears in EIA Studio → synchronise again → **zero
> duplicates**.

`field.surveys.offline_mode = required` is now a policy a project can actually set: `EIA_FIELD_MOBILE`
is the first capture channel that declares `supportsOffline: true`, and it earns the claim.

## 1a. What Wave 2 delivered (17 September 2026)

Five merged changes, each with its own ADR. The theme is **a product eight studies can be loaded
into**, rather than one study a developer seeded.

| | What | ADR |
|---|---|---|
| The product is bilingual | English beside Spanish, from one catalogue, on the web and on the phone. A bilingual questionnaire is **one** `SurveyVersion`: translations are rows keyed by question and option id, so an answer still points at a code | ADR-029 |
| A project is prepared, not scripted | *Preparar proyecto*: eight stages over the project as it is, a `PROJECT_DATA_MANAGER` role that loads files without reading households' answers, and a readiness report that is a pure function of one snapshot | ADR-030 |
| A delivered file is stored | Object storage behind one port, keys that carry **no filename**, an upload verified against the provider rather than the browser, and versioning where a corrected delivery is v2 and v1's words stay | ADR-031 |
| A photograph is evidence | Field media on the phone and the server: captured offline, uploaded when there is signal, and the local file released **only** when the server acknowledges the row | ADR-032 |
| A file is read | PDF and DOCX extraction in the worker, with page locators for one and heading trails for the other, and `REQUIRES_OCR` for a scan rather than a document with three words in it | ADR-033 |

Closed along the way: **TD-037** and **TD-080** (field media), **TD-056** (no real text source),
**TD-089** (no storage readiness rule), **TD-094** (the stand-in text hash).

Measured on merged `main`: unit **551**, integration **518**, Playwright **241**. Ten migrations,
0034 … 0043, every one additive and forward-only.

## 1b. What Wave 3 delivered (17 September 2026)

Four merged changes, two ADRs, and one blocker closed.

| | What | ADR |
|---|---|---|
| A delivered file comes back down | *Descargar original* as a permission-checked, audited 303 to a five-minute presigned GET; and the upload → storage → **separate worker process** → chunk → citation path exercised end to end for the first time | ADR-034 |
| An AI candidate is not a finding | A model reads the project's own passages and **proposes**; a candidate has no `requirement_key`, cannot become a `quality_finding`, is coded `IA-001`, and is headed *Candidato generado por IA*. Retrieval-first, no passage → no claim, no citation → no candidate, and a corpus with one unclassified document is **refused in full** | ADR-035 |
| A template prints only what this product will say | A firm's own `.docx`, versioned and validated against a **closed placeholder vocabulary**; an unknown tag blocks activation, an absent value prints *Dato no disponible* and never `0`, and every generated document says it is a draft | ADR-036 |
| Study #2, through the product | *Nuevo proyecto* on the Portfolio, then *Preparar proyecto* — the path a firm takes for roads #2…#8, with no seeder. Plus a registry test that fails the moment a project-scoped table forgets the project | — |

**Migrations 0034 … 0047 are applied to staging**, and `pnpm test:staging` passes 99 assertions
against it (`STAGING_OPERATIONS.md` §0). That closes blocker 5's database half and most of what
§2 called "staging has never seen Wave 2".

Nothing in Wave 3 enables a live model: `DOCUMENT_REVIEWER` is unset everywhere, as
`SOCIAL_CLASSIFIER` and `ASSISTANT_GENERATOR` are.

## 2. What is *not* done, and is needed before eight real projects run on this

These are the honest blockers, in the order they block.

| # | Blocker | Why it blocks | Owner |
|---|---|---|---|
| 1 | **The compliance review** (SECURITY.md §10a) — now packaged as `docs/PRODUCTION_PRIVACY_CHECKLIST.md`, thirteen data classes with an owner sign-off appendix | Eight real projects means real households answering real questionnaires, and now also **photographs** and **delivered documents** that may hold personal data. Until the LOPDP review passes, this product's own rule is that data stays synthetic, anonymised or aggregated | owner + counsel |
| 2 | **An object-storage bucket** (TD-090) | Wave 2 built the whole path and there is no bucket in staging or production. The deployment reports `NOT_CONFIGURED` and says so on screen; **no document can be uploaded and no photograph can leave a phone** until five environment variables are set. An account, a paid subscription and a credential — `docs/OBJECT_STORAGE.md` §7 is the four-step activation | owner |
| 3 | **Native builds and distribution** (TD-082) — audited 18 Sep 2026 in `FIELD_MOBILE_BUILDS.md` §7: no Expo account, no EAS project, no Android SDK, no JDK, no handset. The cheapest path is an Expo account (free) and a cloud APK | Wave 1 verified the JavaScript bundle for both platforms and generated no signed artefact; Wave 2 added a camera to a bundle nobody can install. Android and iOS development builds need a machine with the SDKs; distribution needs Apple and Google accounts, which are paid actions nobody has authorised | owner |
| 4 | **Production hosting and recovery** — decided on paper in `docs/PRODUCTION_INFRASTRUCTURE_DECISION.md`, including the one hard blocker: Railway can give PostGIS **or** PITR, not both. The restore *procedure* is now drilled and passed on synthetic data; a **provider** restore is still NOT EXECUTED | Staging's database has no backups and no point-in-time recovery, and is explicitly disposable (`docs/DEPLOYMENT.md` §4b). Production cannot inherit that — and now there are **objects as well as rows** to recover. Wave 3 wrote the specification the hosting decision has to satisfy: `docs/PRODUCTION_RECOVERY.md` — RPO, RTO, restore order, verification, the field-device outbox problem, and secret rotation. **No backup exists and no restore has been tested** | owner + dev |
| ~~5~~ | ~~**A second project**~~ **Closed in Wave 3.** A project is created on the Portfolio and prepared in the intake, by the product; `e2e/second-project.spec.ts` drives it and asserts isolation from the pilot on every surface, and `docs/GENERALISATION_AUDIT.md` records that no pilot constant reached product code | — |
| ~~6~~ | ~~**A correction workflow**~~ **Closed in Go-Live Wave A.** A submitted response is corrected by capturing a **new** one on a revisit assignment, with `survey_correction` recording which response it replaces, why and who asked; the submitted rows stay immutable and history keeps both. One resolver — `app.effective_survey_instance` — decides which response every analytic counts, and a test fails if a second implementation appears (ADR-038, `docs/SURVEY_CORRECTIONS.md`). A photograph's declaration (TD-097) and a document version are still immutable with no correction path, and a `HumanReview` still has none (TD-041) | — |
| 7 | **Real device testing at distance** — the procedure now also covers protocol version 3 and a correction revisit (`FIELD_MOBILE_OFFLINE_UAT.md` §4a). Still **PREPARED**, never **PASSED** | `docs/FIELD_MOBILE_OFFLINE_UAT.md` is reproducible and has not been run on a handset in a corridor with no signal — §7's photograph procedure least of all, because no photograph has been taken on real hardware (TD-096). That is a field test, not a laboratory one | owner + dev |
| ~~8~~ | ~~**Questionnaire authoring**~~ **Closed in Go-Live Wave A.** A `SurveyVersion` is written in the intake's *Formularios* stage, behind `field.instruments.author`, and published behind `field.instruments.publish`; a published version stays frozen and a correction is the next version (ADR-037, `docs/SURVEY_AUTHORING.md`). The contract test runs author → publish → Field Pack → offline answer → sync → tabulation with no seeder | — |

Items 1, 2, 3 and 4 are **owner decisions with lead times this product does not control**. Item 2 is
new since Wave 1 and is the cheapest of them: it is five environment variables behind an account.

## 3. What each wave deliberately left alone

**Wave 1**: bilingual rollout, project intake, document upload, AI document review and template
generation.

**Wave 2**: AI candidate review of documents, vector embeddings, template `.docx` automation, and
production deployment — the wave's own stop line. Also deliberately not built:

- **OCR** (TD-098). A scanned PDF is `REQUIRES_OCR`, contributes no chunk and can never be cited.
  OCR means an external processor handling a study's documents, which the compliance review of §2
  has not assessed, and a mediocre local one would be worse than the honest state because its output
  is indistinguishable from real text once it is a chunk.
- **AI document review.** Nothing in Wave 2 calls a model. Retrieval is still PostgreSQL full-text
  and still says so on screen (ADR-021); `LIVE_AI` remains `BLOCKED_EXTERNAL_CONFIG` (TD-049).
- **Downloading an uploaded file from the workspace** (TD-093). The link is permission-checked and
  tested; no button calls it, and the audit line an issued link should write does not exist yet.
- **Content scanning of uploads** (TD-091). The gate is an allowlist of two formats per namespace
  checked by extension, declared type and file signature. That is a gate, not antivirus, and does
  not pretend otherwise.

## 4. Where the go-live date actually sits

The parts that could not be bought and could not be faked are built and tested: the offline capture
pipeline, the bilingual boundary, the intake, the storage path, the media path and the extraction
pipeline. Between them and eight production projects, what remains is still mostly **not
engineering**.

Four of the eight blockers above are somebody's decision — a compliance review, a storage account,
two developer accounts, a hosting decision — and each has a lead time this product does not control.

The date remains achievable for the engineering. Whether it is achievable for everything around it
is the owner's call, and that call is better made against this list than against a summary.
