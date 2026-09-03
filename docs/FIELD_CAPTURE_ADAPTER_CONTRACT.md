# Field capture adapter contract

> Status: **specification only. No adapter is implemented, and none is planned for a named slice.**
> This document exists so that the day one is built, the boundary it must respect is already
> written down — decided while nobody is under delivery pressure to soften it.
>
> Related: ADR-018 (offline capture is configuration), FEATURES.md §1, DATA_MODEL.md (field
> tables), SECURITY.md §7 and §10, PROVENANCE.md, docs/AI_GOVERNANCE.md (not applicable here, but
> the same "record what actually happened" discipline).

## 1. What an adapter is, and what it is not

EIA Studio captures surveys through a **capture channel**. Slice 3 built exactly one,
`NATIVE_WEB`: a responsive browser form that posts to the server and has no offline queue.

An adapter is a second channel — an external field-data tool such as ODK Collect, KoboToolbox or
another XLSForm-based client — that collects answers on a device and delivers them to EIA Studio.
Two properties make it worth considering at all: those tools have solved offline capture properly,
and technicians in this domain often already use them.

An adapter is **not**:

- a plugin system. There is no channel registry an administrator can add rows to, no adapter
  interface with methods nobody calls, and no dynamic loading. `CAPTURE_CHANNELS` is a list in
  `packages/domain/src/field/capture-channel.ts`; adding a channel is a code change, reviewed like
  any other.
- a second source of truth for the questionnaire. EIA Studio's `SurveyVersion` is the definition.
- a reason to relax any rule below. If an external tool cannot satisfy one of them, the answer is
  that this tool is not a supported channel — not that the rule bends for it.

## 2. Boundary rules

These are the conditions any adapter must meet. They are numbered so a future PR can be reviewed
against them one by one.

**A1 · The questionnaire is exported, never imported.** EIA Studio publishes a `SurveyVersion`;
the adapter renders that definition into the external tool's format (XLSForm, or whatever it
uses). A questionnaire authored in the external tool and pushed into EIA Studio is out of scope:
it would make an external system the owner of a definition that answers, provenance and the whole
Social slice depend on.

**A2 · Every submission names the version it answers.** The mapping carries the `SurveyVersion`
UUID and its `definition_hash`. On arrival both are checked: a submission whose hash does not match
the version it claims is **rejected**, not coerced. A definition that changed under a device is
exactly the failure `SurveyVersion` exists to make impossible, and silently accepting it would
undo that in the one path that is hardest to audit.

**A3 · Answers land in the same typed model.** `survey_answer` with its mutually exclusive typed
columns, `survey_answer_option` for multi-choice, options resolved to `survey_option` rows **of
that version**. No JSONB passthrough, no "raw payload" column that later becomes the real data.
An answer the mapping cannot express is a mapping bug to fix, not a blob to store.

**A4 · Submitted stays submitted.** An external tool that re-sends a submission does not edit one:
the ingestion is idempotent by the external submission id, and a second delivery of an id already
recorded is a no-op, not an update. Correction remains what it is everywhere else — a reviewed
workflow that records who changed what, and never an in-place edit.

**A5 · Identity is resolved on our side.** The device tells us who it claims to be; EIA Studio
decides. An external user identifier maps to a `ProjectMembership` through an explicit, audited
link table. An unmapped identifier is a rejected submission, never an auto-created member and
never an assignment reassigned to fit.

**A6 · Assignment ownership is re-verified.** A submission naming an assignment that does not
belong to the mapped technician is rejected and audited. The external tool's own permission model
is not evidence about ours.

**A7 · Tenancy comes from the ingestion context, not from the payload.** The job carries
`{tenantId, projectId, actor}` and opens its transaction with the usual RLS settings. A tenant or
project id inside a submission is validated against that context and otherwise rejected —
the same rule as every other entry point.

**A8 · Ingestion is a job, never a request.** Deliveries can be large and bursty. The endpoint
records the delivery and enqueues; the worker maps and writes. Progress lives on the run row.

**A9 · Provenance is honest about the origin.** Records ingested through an adapter carry
`origin = FIELD_CAPTURE` with the channel, the external system, its version and the delivery id in
the provenance record's source fields. They are never labelled as if captured in EIA Studio, and a
synthetic or test delivery keeps its regime.

**A10 · Media follow the same path as answers.** Attachments go to object storage under the
tenant/project prefix, referenced by key, with EXIF handled by the existing rules (kept as field
evidence, stripped before any export). No public URLs, ever.

**A11 · PII rules are unchanged.** A question flagged `PERSONAL` or `SENSITIVE` in the version is
still stored under the PII rules regardless of how it arrived, and the external tool's storage of
it is a matter for the processor registry (SECURITY.md §10a) before any real data flows.

**A12 · The offline promise becomes true only when the channel makes it true.** A channel may set
`supportsOffline: true` only if a technician can complete a survey with no connectivity and have
it arrive later, end to end, demonstrably. That flag is what lets a project with
`field.surveys.offline_mode = required` activate a campaign (ADR-018); setting it aspirationally
would cost someone a day of field work.

## 3. What would have to be built

Sketch, not a plan, and deliberately unestimated:

| Piece | Note |
|---|---|
| Definition export | `SurveyVersion` → XLSForm (or equivalent), covering the eight question types this product has. Types the target format cannot express are a blocking gap, not a lossy mapping. |
| Delivery endpoint | Authenticated, capability-guarded, records the delivery, enqueues the job. |
| Ingestion job | Mapping, the A2–A7 checks, typed answer writes, media, audit, provenance. |
| Identity link table | External subject ↔ `ProjectMembership`, audited, tenant-scoped. |
| Channel entry | One row in `CAPTURE_CHANNELS` plus its descriptor. |
| Operational surface | Deliveries, their state, and what was rejected and why — a rejected submission that nobody can see is a lost survey. |

## 4. Why this is not being built now

Slice 3's job was the foundation: campaigns, assignments, visits, versioned questionnaires, typed
answers, and the authorization that keeps one technician's responses out of another's hands. An
adapter is a second delivery path over that foundation, and it is only worth building when a real
project needs offline capture and a real device profile is known. Writing the contract now costs
one document and prevents the version of this feature that arrives as a JSON blob endpoint with a
"we'll normalise it later" comment.
