# Production privacy checklist

> **This document draws no legal conclusions.** It is the technical record a responsible person and
> a legal adviser need in order to reach their own, and every question that is theirs to answer says
> so in those words: **OWNER / LEGAL REVIEW REQUIRED**. Nothing here is filled in with a guess.
>
> Related: `docs/SECURITY.md` §10a (the compliance gate), `docs/DATA_CLASSIFICATION_MATRIX.md` (the
> technical classification this is built on), `docs/PRODUCTION_V1_GO_LIVE.md` blocker 1,
> ADR-027 (the client portal), ADR-031/032/033 (files, photographs, extraction), ADR-035 (AI review),
> ADR-038 (corrections).

## 0. What this document is for, and what it is not

Before this product holds **any real personal data**, Ecuador's personal-data framework (LOPDP and
its regulation and authority) requires a specific review. This product cannot perform that review
and must not pretend to: a codebase that asserted compliance would be the single most dangerous
artefact in the repository.

What it can do is answer, precisely and checkably, the questions such a review asks: *what is
collected, where does it sit, who can reach it, what is written down about who reached it, what
leaves the building, and what happens when somebody wants it corrected or gone.* That is §2.

What it cannot answer — the lawful basis, the retention period, who is controller and who is
processor, whether a given field may be collected at all — is marked and left empty. **An empty
field here is the document working correctly.**

| | |
|---|---|
| Reviewed by | — |
| Date | — |
| Version of the product reviewed | commit `______`, migration ledger `______` |
| Outcome | ☐ approved for real data ☐ approved with conditions ☐ not approved |

Until that table is filled in and signed (§4), the product's own rule stands: **demo and test data
remain synthetic, anonymised or aggregated**, and `SOCIAL_CLASSIFIER`, `ASSISTANT_GENERATOR` and
`DOCUMENT_REVIEWER` remain unset in every environment.

## 1. The state today, stated plainly

Four facts a reviewer should know before reading anything else.

1. **No real personal data has ever been loaded.** The pilot's cartography was imported with its
   personal attributes removed (ADR-023); the demonstration questionnaire collects no names, no
   identity numbers, no phone numbers, no health data, no individual income and no household
   coordinates; every survey answer in every environment is labelled `DEMO_SIMULATION`.
2. **The `pii` schema described in `SECURITY.md` §10 does not exist.** It is specified and not
   built. There is today **no place in this database designed to hold identified respondent data**,
   which is a deliberate consequence of point 1 and a decision this review must confirm or change.
3. **No model has ever been given real content.** All three AI selectors are unset everywhere. The
   social classifier additionally refuses, in the use-case *and* again in the worker, any answer
   whose provenance regime is not `DEMO_SIMULATION`.
4. **There is no object storage bucket.** No document and no photograph has ever been stored in any
   deployed environment, because storage is not configured (TD-090).

A review that assumes data is already flowing would be reviewing a different product.

## 2. The data classes

Each class answers the same twelve questions. *Personal-data character* is a **technical
observation about what the field can contain**, never a legal classification.

---

### 2.1 Respondent identity

| | |
|---|---|
| **Description** | The identity of the person who answered a questionnaire: name, identity number, contact details, signature |
| **Stored where** | **Nowhere.** There is no respondent entity and no `pii` schema. `survey_instance.respondent_user_id` is a **misleading column name**: it holds the *technician's* user id — the person who captured the response — not a household member (TD-117) |
| **Personal-data character** | Would be identified personal data if it existed |
| **Access** | n/a |
| **Encryption / control** | n/a. The design control is that the field does not exist |
| **Auditability** | n/a |
| **Portal eligible?** | **No.** The publication payload is composed from a closed allowlist and has nowhere to put a person (ADR-027) |
| **AI eligible?** | **No** |
| **Mobile retention** | n/a — never downloaded, because it is never stored |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** — and the prior question is whether respondent identity should be collected at all |
| **Correction / deletion** | n/a today. If identity is introduced, erasure per subject is feasible because everything else keys on pseudonymous ids |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Does the programme need to identify respondents? If yes: lawful basis, consent record, and whether the `pii` schema is built before go-live |

---

### 2.2 An individual survey response (closed question)

| | |
|---|---|
| **Description** | One household's answer to one closed question: a chosen option, a number, a date, a yes/no |
| **Stored where** | `app.survey_answer`, `app.survey_answer_option` |
| **Personal-data character** | Not identified on its own. Becomes personal data **in combination**: a response is linked to a parcel, and a parcel is a place where somebody lives |
| **Access** | `field.responses.read` — **and** the row-level rule of SECURITY.md §10b: *this row is mine, or I hold the permission*. A `FIELD_TECHNICIAN`, a `GIS_SPECIALIST` and a `PROJECT_DATA_MANAGER` hold none of it |
| **Encryption / control** | TLS in transit; encrypted at rest on the device (SQLCipher); FORCE RLS; write-once after submission by grant **and** trigger |
| **Auditability** | `field.survey.submitted` records the response's identifiers and counts. **Never an answer's value** |
| **Portal eligible?** | **No** (ADR-027) |
| **AI eligible?** | **Only `DEMO_SIMULATION`**, refused twice otherwise (SECURITY.md §10c) |
| **Mobile retention** | Held in the encrypted local database until sign-out or uninstall. A technician holds **their own captures only** |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED.** The prototype's tenant setting is *anonymise N months after project close*; **no retention job exists** |
| **Correction / deletion** | Correction is a **new response** that supersedes the old one; both are kept (ADR-038). There is **no deletion path at all** — a subject-erasure request cannot be satisfied today without a manual database operation |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED** — retention period, and whether erasure must be a product feature before go-live |

---

### 2.3 An open-text response

| | |
|---|---|
| **Description** | What a person said, in their own words, transcribed verbatim and never edited |
| **Stored where** | `app.survey_answer.text_value` |
| **Personal-data character** | **The highest unannounced risk in the product.** Free text is where a name, a phone number or a health detail arrives without anybody deciding to collect it |
| **Access** | As 2.2 |
| **Encryption / control** | As 2.2. No redaction, no filtering, no truncation: the text is stored as spoken, deliberately |
| **Auditability** | As 2.2. The text never reaches a log line or an audit row |
| **Portal eligible?** | **No** |
| **AI eligible?** | **Only `DEMO_SIMULATION`**, and then only the text — the classifier's input type has nowhere to put a respondent, a technician, a parcel code, a coordinate or another answer |
| **Mobile retention** | As 2.2 |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** |
| **Correction / deletion** | As 2.2 |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Is free text acceptable at all under the chosen lawful basis, and what is said to a respondent before they speak? |

---

### 2.4 A technician's GPS position

| | |
|---|---|
| **Description** | Where the **technician** was when a visit started. Never a household's address |
| **Stored where** | `app.field_visit.location`, `location_accuracy_m`, `location_captured_at`, `location_outcome` |
| **Personal-data character** | **An employee's location**, which is a different category from a respondent's and often a different legal question |
| **Access** | `field.responses.read`, with the same row-ownership rule |
| **Encryption / control** | Captured only with the device's permission; recorded as `denied` or `unavailable` when there is none, **never fabricated** |
| **Auditability** | The visit row itself is the record. Coordinates never reach a log line or an audit row |
| **Portal eligible?** | **No** |
| **AI eligible?** | **No.** No code path sends it near a model |
| **Mobile retention** | On the device until the visit syncs and the outbox drains |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED.** Employee location may carry a shorter duty than study data |
| **Correction / deletion** | A visit is immutable. A correction revisit produces a **new** visit with its own position; the original stays |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Is staff location processing agreed with the technicians and with whoever employs them? Who is controller for it — EIA Studio's tenant, or the consultancy? |

---

### 2.5 A field photograph

| | |
|---|---|
| **Description** | A photograph of a parcel, an affectation or an access, taken at a visit |
| **Stored where** | `app.field_media` (the declaration) + object storage namespace `field-media` (the bytes). **No bucket exists, so no photograph has ever been stored** |
| **Personal-data character** | **Can contain anything in front of the lens** — a person, a house number, the inside of a home. Unreviewable at scale and the longest-lived content the product holds |
| **Access** | `field.responses.read` or ownership. **Declaring** one has no such escape: a caller may only declare in their own name |
| **Encryption / control** | Camera only, never the photo library (`photosPermission: false`); four kinds and deliberately **no `document` and no `signature`**; nothing is altered on capture — no re-encode, no resize, no EXIF strip; the local file is released only when the server acknowledges the row |
| **Auditability** | `field.media.declared` records the visit and the kind. **Never the note and never the coordinates** |
| **Portal eligible?** | **No** — prevented by a type, not a rule: the publication payload has nowhere to put an image (ADR-032 §3) |
| **AI eligible?** | **No** — same mechanism: nothing in the AI path accepts an image |
| **Mobile retention** | In the application's own documents directory, not the camera roll, until the server acknowledges |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED.** This is the row most likely to outlive its purpose |
| **Correction / deletion** | **A photograph cannot be removed once declared, by anybody** (TD-097). EXIF, including GPS, is retained as taken |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** What are technicians told to photograph and not photograph? Is a deletion path required before go-live? Is EXIF GPS acceptable in stored evidence? |

---

### 2.6 A parcel and its link to a response

| | |
|---|---|
| **Description** | The territorial unit: a project-minted code, a sector label, a side, a chainage, a frontage, a geometry — and the fact that a response belongs to it |
| **Stored where** | `app.parcel`, `app.parcel_geometry`, and the `assignment → parcel` link reached from `app.survey_instance` |
| **Personal-data character** | **The parcel itself holds no owner name** — the import removed personal attributes (ADR-023) and there is no owner column. But a geometry is a *place*, and *place + response* is the combination that makes 2.2 personal |
| **Access** | `parcels.read` for the parcel; the **response** link needs `field.responses.read` |
| **Encryption / control** | FORCE RLS; the composite project foreign key; geometry stored in EPSG:4326 |
| **Auditability** | Imports are recorded as runs with provenance; reads are not audited |
| **Portal eligible?** | **A parcel code is not publishable** and the allowlist has nowhere to put one. Generalised outlines of influence areas are published; individual parcel geometry is not |
| **AI eligible?** | **No** |
| **Mobile retention** | The device holds, for the technician's own assignments only: parcel code, sector, chainage, side. **No geometry and no coordinate** |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** — cadastral data may carry its own obligations independent of the survey |
| **Correction / deletion** | A dataset version is superseded, never edited. Removing a parcel would orphan the responses that name it |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Under whose licence does the cartography arrive, and does that licence permit this processing and this retention? |

---

### 2.7 An uploaded document that contains identified data

| | |
|---|---|
| **Description** | A delivered study, annex, minute or attendance register that names people |
| **Stored where** | `app.source_document` → `app.document_version` → `app.document_chunk`; bytes in namespace `documents`. **No bucket exists** |
| **Personal-data character** | **Identified, and arriving in bulk.** An attendance register is a list of names and signatures |
| **Access** | `documents.read`. A version carries `privacy_classification`, whose default for every upload is `REVIEW_REQUIRED` — meaning *nobody has looked* |
| **Encryption / control** | Object keys carry **no filename** — six segments, four UUIDs (ADR-031). The name is kept on the row, under RLS, and restored on the download link. Nothing is executed when the file is read (ADR-033) |
| **Auditability** | `document.version.uploaded`, `.extracted`, and **every** `document.version.download_issued` — not only for files somebody flagged. None carries a filename |
| **Portal eligible?** | **No** |
| **AI eligible?** | **Only when classified `NO_PERSONAL_DATA_KNOWN`.** One ineligible version **refuses the whole run** and names the document; the refusal is audited in its own transaction (ADR-035) |
| **Mobile retention** | **Never downloaded.** The device has no document surface |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** |
| **Correction / deletion** | A corrected delivery is **v2**; v1 keeps its words and its chunks. There is no deletion path |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Who classifies a document's privacy, on what criteria, and by when? A corpus left at the default is a corpus nobody has reviewed |

---

### 2.8 A non-PII technical document

| | |
|---|---|
| **Description** | A methodology, a legal framework, a technical annex with no personal data |
| **Stored where** | As 2.7 |
| **Personal-data character** | None, **once somebody has said so.** The classification is a human claim, not a derivation |
| **Access** | `documents.read` |
| **Encryption / control** | As 2.7 |
| **Auditability** | As 2.7 |
| **Portal eligible?** | **No.** A publication cites nothing from the corpus directly |
| **AI eligible?** | **Yes**, when classified `NO_PERSONAL_DATA_KNOWN` and the capability and selector allow it |
| **Mobile retention** | Never downloaded |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** — likely contractual rather than data-protection |
| **Correction / deletion** | As 2.7 |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Does the client's contract permit a study's text to leave for a model provider at all, independently of whether it contains personal data? |

---

### 2.9 An aggregate metric

| | |
|---|---|
| **Description** | A count, a percentage, a tabulation, a denominator — computed from responses |
| **Stored where** | `app.metric_snapshot` where stored; otherwise computed on read |
| **Personal-data character** | **Not automatically anonymous.** A tabulation over a small denominator can identify: *one household in this sector answered X* |
| **Access** | `social.read` **and** `field.responses.read`, because the counts are computed from response rows under RLS and a caller who cannot see the rows would be shown plausible **zeros** rather than a denial (TD-045) |
| **Encryption / control** | Denominators are declared, never inferred; corrected responses count **once** (ADR-038) |
| **Auditability** | Calculation runs carry method text and input edges |
| **Portal eligible?** | **Yes, selectively** — composed into the publication from a closed vocabulary, never filtered out of a record |
| **AI eligible?** | Not sent. The report generator reads the **snapshot**, and a model only renders prose from it |
| **Mobile retention** | Not downloaded |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** — an aggregate may legitimately outlive the responses under it, which is a decision, not a default |
| **Correction / deletion** | Recomputed from effective responses. A stored snapshot is immutable |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Is there a minimum cell size below which a figure must be withheld? The product does not enforce one today |

---

### 2.10 An AI classification proposal (social coding)

| | |
|---|---|
| **Description** | A model's suggested category for an open-text answer, with an uncalibrated score |
| **Stored where** | `app.ai_classification`, `app.ai_classification_category` |
| **Personal-data character** | **It is a statement about a person's words**, so it inherits their character |
| **Access** | `field.responses.read` — reused rather than duplicated, because it is the same datum (TENANCY.md §3.2) |
| **Encryption / control** | Insert-only. Never overwrites the answer; never enters a validated figure without a human decision. **No chain-of-thought is requested or stored**, and neither is the raw provider response |
| **Auditability** | `social.classification_run.started` — the run, the model, counts. Never a word of what was said |
| **Portal eligible?** | **No** |
| **AI eligible?** | It *is* the AI output. Its **input** is gated: `DEMO_SIMULATION` only |
| **Mobile retention** | Never downloaded |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** |
| **Correction / deletion** | A proposal is never edited; a human review sits beside it. When a response is corrected, the coding of the superseded answer **stops counting** and is never reused (ADR-038) |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Which provider, in which region, under which contract, with which data-retention terms? `ProcessorRegistryEntry` is modelled and **no vendor has been assessed** |

---

### 2.11 An AI document-review candidate

| | |
|---|---|
| **Description** | A model's suggestion that two passages of a delivered study disagree, with its citations |
| **Stored where** | `app.document_review_run`, `_source`, `_candidate`, `_evidence`, `_decision` |
| **Personal-data character** | Inherits the passages'. The corpus gate is what keeps it low |
| **Access** | `quality.read`; deciding needs `quality.review` |
| **Encryption / control** | **No citation → no candidate**, refused and counted rather than dropped. A candidate resting on one passage can be dismissed and **cannot be accepted**. The model's words are write-once; every decision, including a dismissal, is append-only with a mandatory justification |
| **Auditability** | `documents.review.run_started`, `.run_refused`, `.candidate_decided`. The refusal is audited **in its own transaction** so it survives the refusal it records |
| **Portal eligible?** | **No** |
| **AI eligible?** | The run is the AI act. Its corpus is gated: `NO_PERSONAL_DATA_KNOWN` only, and one ineligible document stops the whole run |
| **Mobile retention** | Never downloaded |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** |
| **Correction / deletion** | Nothing is edited. A re-run is a new run |
| **Open decision** | As 2.10, plus: does the client agree that their delivered study may be read by a third-party model at all? |

---

### 2.12 A generated report or document

| | |
|---|---|
| **Description** | A `ReportVersion` snapshot and its prose; a `.docx` produced from a consultancy template |
| **Stored where** | `app.report_version`, `app.report_section`, `app.report_section_source`; `app.generated_document` + namespace `generated` |
| **Personal-data character** | **Whatever the facts it carries carry.** The placeholder registry is a closed 13-key vocabulary with no personal data in it, asserted by a test |
| **Access** | `reports.write` / `reports.review` |
| **Encryption / control** | Written once (REVOKE **and** trigger). Every fact carries a typed source; a fact without one is unrepresentable. Every generated document says **BORRADOR — NO ES UN ENTREGABLE APROBADO**, required in the template and verified in the rendered text |
| **Auditability** | `reports.version.generated`, `.downloaded`, `templates.document.generated`, `.download_issued`. Never the text, never a filename, never a printed value |
| **Portal eligible?** | Not directly. A publication is composed separately |
| **AI eligible?** | Prose is generated **from the snapshot**, never from the database, and a paragraph stating a figure its section did not compute **fails the generation** |
| **Mobile retention** | Never downloaded |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** — a deliverable's retention is usually contractual and longer than the data under it |
| **Correction / deletion** | A version is never edited; regenerating produces a new one. **A report generated before a correction keeps its figures** |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** Who may download a draft deliverable, and does an unapproved draft leaving the firm create an exposure? |

---

### 2.13 A client-facing published aggregate

| | |
|---|---|
| **Description** | What the consultancy's customer sees: progress, milestones, a generalised corridor |
| **Stored where** | `portal.client_publication`, in its own schema |
| **Personal-data character** | **Designed to have none.** The payload is *composed* from a closed allowlist rather than filtered from a record, so there is nowhere in it to put a respondent, an owner, a parcel code, a technician, a proposal or a score |
| **Access** | `portal.preview` to read the draft; `portal.publish` to decide. **There is no external client access**: `eia_portal` is granted nothing and no client session exists (TD-005) |
| **Encryption / control** | Immutable by `REVOKE UPDATE, DELETE` **and** a trigger. A second scan refuses a forbidden concept smuggled into free text. `DEMO_SIMULATION` is refused outright |
| **Auditability** | `portal.publication.published` records the version and the figure count. **Never the payload** |
| **Portal eligible?** | It *is* the portal |
| **AI eligible?** | **No** |
| **Mobile retention** | Not downloaded |
| **Server retention** | **OWNER / LEGAL REVIEW REQUIRED** — a publication is a statement made to a customer on a date, and is probably contractual evidence |
| **Correction / deletion** | **A publication is never rewritten.** A correction changes what the *next* one says |
| **Open decision** | **OWNER / LEGAL REVIEW REQUIRED.** When external client access is built, who may be granted it, for how long, and who revokes it? |

## 3. What the architecture already supports for this review

Stated so the review does not spend time asking for things that exist.

| Question a reviewer asks | Where the answer is |
|---|---|
| Who read this, and when? | `audit.log`, append-only, written in the same transaction as the mutation |
| What is each datum's origin and regime? | `provenance_record`'s four facets on every provenance-bearing row |
| Can a datum be traced to a person? | Only through the parcel and assignment chain; there is no respondent entity |
| Can access be proven to be role-based? | The permission catalogue, plus FORCE RLS on every tenant-owned table, plus the cross-tenant test suite |
| Can one tenant reach another's data? | A registry test fails the moment a project-scoped table forgets the project |
| Is anything sent to a third party today? | No. All three AI selectors are unset everywhere |

## 4. Owner and legal sign-off

**This is an operational and legal artefact. It is deliberately not a database record**, and no
boolean anywhere in this product will be set because these boxes were ticked. A stored approval flag
would let a green tick in an interface stand in for a review nobody performed — the same reason
there is no approval workflow for a report (TD-060).

Each line is signed by the person who actually decided it, with the date.

| | Item | Decided by | Date |
|---|---|---|---|
| ☐ | Controller / processor responsibilities agreed — who is which, between the consultancy, the client GAD and EIA Studio | | |
| ☐ | Purpose of collection agreed, and written down in words a respondent would recognise | | |
| ☐ | Lawful basis reviewed for each class of §2 | | |
| ☐ | Sensitive fields reviewed — and whether §2.1 respondent identity is collected at all | | |
| ☐ | Photograph policy reviewed — what is photographed, EXIF, and whether deletion must exist before go-live (§2.5) | | |
| ☐ | GPS policy reviewed — staff location, agreed with whoever employs the technicians (§2.4) | | |
| ☐ | Device retention reviewed — what stays on a phone, and what happens when one is lost | | |
| ☐ | Server retention reviewed — a period per class, and who runs the job that does not yet exist | | |
| ☐ | User access reviewed — the role each person actually holds, against §2's access column | | |
| ☐ | Incident response contact identified — a named person, reachable, and where it is written down | | |
| ☐ | AI provider eligibility reviewed — vendor, region, contract, retention; the processor registry is empty | | |
| ☐ | Client Portal publication policy reviewed — who decides what a customer is told | | |

**Outcome**

| | |
|---|---|
| Approved for real personal data | ☐ yes ☐ yes, with the conditions below ☐ no |
| Conditions | |
| Signed | |
| Date | |

Until this is signed, the product keeps its own rule and nothing changes in configuration.

## 5. What this document does not do

- It does not assert that this product complies with anything.
- It does not choose a lawful basis, a retention period or a controller.
- It does not treat the presence of these records as approval.
- It does not claim the fields marked **OWNER / LEGAL REVIEW REQUIRED** are minor. They are the
  review.
