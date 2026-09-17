# Data classification matrix

> What this product holds, where each kind lives, who may read it, and what is still a decision
> somebody has to make. Related: `docs/SECURITY.md` §10, §10a–§10f, `docs/TENANCY.md` §3,
> `docs/PROVENANCE.md`, `docs/AI_GOVERNANCE.md`.
>
> **This document draws no legal conclusion.** It records what the architecture does so that the
> compliance review of `SECURITY.md` §10a has something concrete to assess. Every retention period
> and every legal basis below reads **OWNER / LEGAL REVIEW REQUIRED** until the owner supplies it,
> and no code treats the presence of a row here as approval.

## 0. How to read the columns

| Column | Means |
|---|---|
| **Stored where** | schema and table, or storage namespace. Not "the database" |
| **Who may read** | the permission that gates it, and the row-level condition when there is one |
| **Retention** | a decision, not a setting: what is deleted or anonymised, when, and on whose authority |
| **AI eligible?** | whether this may ever reach a model provider, and what enforces it |
| **Client portal eligible?** | whether it may appear in a published client view, and what enforces it |
| **Risk / note** | what goes wrong if the row above is got wrong |

## 1. The matrix

### 1.1 An individual survey answer (closed question)

| | |
|---|---|
| Stored where | `app.survey_answer`, `app.survey_answer_option` |
| Who may read | `field.responses.read` — **and** the row-level condition of SECURITY.md §10b: *this row is mine, or I hold the permission*. A `FIELD_TECHNICIAN` and a `GIS_SPECIALIST` hold neither |
| Retention | **OWNER / LEGAL REVIEW REQUIRED.** The tenant setting in the prototype is *anonymise N months after project close*; no job runs today |
| AI eligible? | **Only `DEMO_SIMULATION`.** `assertAiProcessingAllowed` refuses any other regime, in the use-case *and* again in the worker (SECURITY.md §10c) |
| Client portal eligible? | **No.** The publication payload is composed from a closed allowlist and has nowhere to put a respondent or an answer (ADR-027) |
| Risk / note | The demo questionnaire collects no personal data by design. A real one will, and that is what §10a's review is for |

### 1.2 An open-text answer

| | |
|---|---|
| Stored where | `app.survey_answer.value_text` |
| Who may read | as 1.1 |
| Retention | **OWNER / LEGAL REVIEW REQUIRED** |
| AI eligible? | **Only `DEMO_SIMULATION`**, and then only the text itself: the classifier's input type has nowhere to put a respondent, a technician, a parcel code, a coordinate or another answer |
| Client portal eligible? | **No** |
| Risk / note | Free text is where identified data arrives unannounced — a name in a comment. This is the single most likely route to unintended PII, and the demo-only gate is what stands in front of it |

### 1.3 A technician's GPS position

| | |
|---|---|
| Stored where | `app.field_visit` (the visit's location outcome and coordinates) |
| Who may read | `field.responses.read`, with the same row-ownership condition |
| Retention | **OWNER / LEGAL REVIEW REQUIRED.** It is an employee's location, which is a different category from a respondent's |
| AI eligible? | **No.** No code path sends it anywhere near a model |
| Client portal eligible? | **No** |
| Risk / note | It is the **technician's own** position at the moment of a visit, never a household's address, and it is recorded as `denied` or `unavailable` rather than fabricated (SECURITY.md §10b) |

### 1.4 A field photograph

| | |
|---|---|
| Stored where | `app.field_media` (the declaration) + object storage namespace `field-media` (the bytes) |
| Who may read | `field.responses.read` or ownership, per the select policy; **declaring** one has no such escape — a caller may only declare in their own name |
| Retention | **OWNER / LEGAL REVIEW REQUIRED.** Photographs are the longest-lived and least reviewable content this product holds |
| AI eligible? | **No.** Prevented by a type, not by a rule: nothing in the AI path accepts an image (ADR-032 §3) |
| Client portal eligible? | **No**, and asserted by a test |
| Risk / note | A photograph of a parcel can contain a person, a house number or the inside of a home. Four kinds exist and deliberately **no `document` and no `signature`**: photographing an identity card is collecting identified data nobody authorised. EXIF is **not** stripped at capture — a device that altered evidence would be producing something the technician did not take — so stripping belongs at export (SECURITY.md §7) |

### 1.5 A delivered document containing identified data

| | |
|---|---|
| Stored where | `app.source_document` / `app.document_version` (metadata) + namespace `documents` (bytes); passages in `app.document_chunk` |
| Who may read | `documents.read` with ordinary project access |
| Retention | **OWNER / LEGAL REVIEW REQUIRED.** It is the client's document, and the firm's obligations about it may outlive the engagement |
| AI eligible? | **No**, unless somebody has classified it `NO_PERSONAL_DATA_KNOWN`. `REVIEW_REQUIRED` is the default and means *nobody has looked*; a mixed corpus is **refused entirely**, naming every blocking document (ADR-035 §6) |
| Client portal eligible? | **No.** The portal issues no statement against a document |
| Risk / note | A document flagged `contains_pii` is refused for ingestion, not redacted: the deidentification pipeline does not exist, and chunking an unredacted document hoping nobody retrieves the wrong paragraph is not a control |

### 1.6 A non-PII technical document

| | |
|---|---|
| Stored where | as 1.5 |
| Who may read | `documents.read` |
| Retention | **OWNER / LEGAL REVIEW REQUIRED** — shorter than 1.5 in most regimes, which is why it is a separate row |
| AI eligible? | **Yes, when classified `NO_PERSONAL_DATA_KNOWN`** — and the classification is a claim a person made, recorded per version and recorded again on the run that read it (`document_review_source.privacy_classification_at_run`) |
| Client portal eligible? | **No.** A published figure may be *derived* from one, but the document itself is not published |
| Risk / note | This is the only row where "AI eligible" is ever yes, and it is yes because somebody said so — not because the product decided |

### 1.7 An aggregate metric

| | |
|---|---|
| Stored where | `app.metric_snapshot`, with a `provenance_id` carrying its four facets |
| Who may read | project access; **aggregate social analytics additionally require `field.responses.read`** (TD-045) because RLS would otherwise return a plausible, silent zero |
| Retention | follows the project; no personal data, so no anonymisation step |
| AI eligible? | **Not applicable** — nothing sends metrics to a model. They are computed, not generated |
| Client portal eligible? | **Yes, when explicitly published.** `assertPublishableRegime` refuses `DEMO_SIMULATION` outright and admits `LIVE_OPERATIONAL` only as an aggregate somebody declared publication-safe |
| Risk / note | The regime matters more than the figure: a demo simulation published as client progress is the failure ADR-027 was written to prevent |

### 1.8 A derived AI candidate

| | |
|---|---|
| Stored where | `app.document_review_candidate` + `app.document_review_evidence` (the passages it cites), with `app.document_review_decision` beside them |
| Who may read | `quality.read` with project access. Deciding one is `quality.review` |
| Retention | follows the project. **A dismissal is kept**: a study that could lose the record of somebody deciding something was nothing would be a study whose review history is whatever survived |
| AI eligible? | it **is** the model's output. Nothing sends it back to a model |
| Client portal eligible? | **No**, and there is nowhere in the payload to put one |
| Risk / note | It is a **proposal**, never a finding. It has no `requirement_key`, cannot become a `quality_finding`, is coded `IA-001` rather than `QG-001`, and is headed *Candidato generado por IA* (ADR-035). A candidate resting on one passage cannot even be accepted |

### 1.9 A generated report or document

| | |
|---|---|
| Stored where | `app.report_version` (snapshot + prose) and `app.generated_document` + namespace `generated` (bytes) |
| Who may read | `reports.write` / `reports.review` with project access |
| Retention | **OWNER / LEGAL REVIEW REQUIRED.** A draft handed to somebody is a record of what was said on a date |
| AI eligible? | **No.** A generated document is not sent anywhere; when a model wrote prose into one, the row records which model and which prompt version |
| Client portal eligible? | **No.** A client publication is composed separately from a closed vocabulary; it is never a rendering of a report |
| Risk / note | Every one says **BORRADOR — NO ES UN ENTREGABLE APROBADO**, because there is no approval workflow (TD-060) and a Word file detached from the screen that made it carries no other context |

### 1.10 A client-facing aggregate (published)

| | |
|---|---|
| Stored where | `portal.client_publication`, in its own schema, immutable |
| Who may read | `portal.preview` to check, `portal.publish` to decide. There is **no external client session** and `eia_portal` is granted nothing (TD-005) |
| Retention | follows the project; a withdrawal is immediate and a publication is never edited |
| AI eligible? | **No** |
| Client portal eligible? | it **is** the client view, and is the only thing that is |
| Risk / note | Composed from an allowlist rather than filtered from a record, so there is nowhere to put a respondent, a parcel code, a technician, a proposal or a confidence score. A second scan refuses a forbidden concept smuggled into free text |

## 2. What is still an owner decision

| # | Decision | Blocks |
|---|---|---|
| 1 | **Legal basis** for each personal-data category (consent, contract, legitimate interest, legal obligation) under Ecuador's LOPDP | ingesting any real personal data |
| 2 | **Retention period** per row of §1 marked *OWNER / LEGAL REVIEW REQUIRED* | the retention job, which is designed and not built |
| 3 | **Whether a technician's GPS** is employee monitoring under the applicable regime, and what that requires | nothing today; the data is already minimal |
| 4 | **Processor assessment** for every external vendor: the model gateway, the storage provider, the hosting provider, and OCR if it is ever adopted (TD-098) | enabling any live AI on real data, and a production storage account |
| 5 | **Data-residency** requirement, if any | the production hosting decision (`PRODUCTION_RECOVERY.md` §3) |
| 6 | **A DPIA**, if the regime requires one for this processing | production ingestion |
| 7 | **Whether photographs of parcels** constitute personal data in this context, and under what conditions | nothing today; §1.4 already treats them as if they do |

Until 1, 2 and 4 are answered, this product's own rule stands: demo and test data remain synthetic,
anonymised or aggregated (`SECURITY.md` §10a), `SOCIAL_CLASSIFIER` stays demo-only, and
`DOCUMENT_REVIEWER` stays unset.

## 3. What the architecture already supports for the review

Not as a claim of compliance — as an inventory of what the reviewer will find (DATA_MODEL.md §3.9):
`DataInventoryEntry`, `ProcessingPurpose`, `RetentionPolicy`, `ProcessorRegistryEntry`,
`LegalBasisRecord` / `ConsentRecord`, `RiskAssessmentRecord`, `DataSubjectRequest`, and an
append-only `audit.log` carrying every PII read, export and anonymisation with its reason.

**The code base must not assert compliance, compute a legal conclusion, or treat the presence of any
of these records as approval.** The compliance owner decides; the product records.
