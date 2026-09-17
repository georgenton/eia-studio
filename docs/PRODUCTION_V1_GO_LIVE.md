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

## 2. What is *not* done, and is needed before eight real projects run on this

These are the honest blockers, in the order they block.

| # | Blocker | Why it blocks | Owner |
|---|---|---|---|
| 1 | **The compliance review** (SECURITY.md §10a) | Eight real projects means real households answering real questionnaires, and now also **photographs** and **delivered documents** that may hold personal data. Until the LOPDP review passes, this product's own rule is that data stays synthetic, anonymised or aggregated | owner + counsel |
| 2 | **An object-storage bucket** (TD-090) | Wave 2 built the whole path and there is no bucket in staging or production. The deployment reports `NOT_CONFIGURED` and says so on screen; **no document can be uploaded and no photograph can leave a phone** until five environment variables are set. An account, a paid subscription and a credential — `docs/OBJECT_STORAGE.md` §7 is the four-step activation | owner |
| 3 | **Native builds and distribution** (TD-082) | Wave 1 verified the JavaScript bundle for both platforms and generated no signed artefact; Wave 2 added a camera to a bundle nobody can install. Android and iOS development builds need a machine with the SDKs; distribution needs Apple and Google accounts, which are paid actions nobody has authorised | owner |
| 4 | **Production hosting and recovery** | Staging's database has no backups and no point-in-time recovery, and is explicitly disposable (`docs/DEPLOYMENT.md` §4b). Production cannot inherit that — and now there are **objects as well as rows** to recover | owner + dev |
| 5 | **A second project** | The profile mechanism has run one project. Eight will find what is pilot-shaped in it; the intake surface makes preparing one an ordinary act, so the fastest way to know is to prepare the second | dev |
| 6 | **A correction workflow** | A submitted response is immutable by design, and so now are a photograph's declaration (TD-097) and a document version. Eight projects will produce corrections, and there is no reviewed path for one (TD-060 is the same gap for reports) | dev |
| 7 | **Real device testing at distance** | `docs/FIELD_MOBILE_OFFLINE_UAT.md` is reproducible and has not been run on a handset in a corridor with no signal — §7's photograph procedure least of all, because no photograph has been taken on real hardware (TD-096). That is a field test, not a laboratory one | owner + dev |
| 8 | **Questionnaire authoring** (TD-088) | Eight studies will not all use the pilot's questionnaire, and publishing a `SurveyVersion` is still a provisioning-tool act. The intake's *Formularios* stage reports what exists and says plainly that editing arrives later | dev |

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
