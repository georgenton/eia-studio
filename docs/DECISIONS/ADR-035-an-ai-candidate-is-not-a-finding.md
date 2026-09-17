# ADR-035 — An AI candidate is not a finding, and the corpus it may read is refused rather than filtered

- Status: Accepted
- Date: 17 September 2026
- Related: ADR-008 and ADR-020 (the Quality Gate and its rule catalogue), ADR-019 (rules calculate,
  AI proposes, a human validates), ADR-021 (retrieval is full-text and says so), ADR-031 (object
  storage and the privacy classification), ADR-033 (extraction), IG4-001 (no default adapter),
  `docs/SECURITY.md` §10c and §10f, `docs/AI_GOVERNANCE.md`.
- Supersedes nothing. Amends `docs/FEATURES.md` §2 by widening what `quality.rag_assistant` means.

## Context

The product now holds a readable corpus: delivered files, stored under keys that name nobody,
extracted into immutable passages a citation can point at. The obvious next question a consultancy
asks is *would a model notice things in this study that a person might miss?*

It is a reasonable question and it has a dangerous answer, because this product already contains a
feature that looks exactly like the answer and is not it. The **Quality Gate** compares two values
with a deterministic rule, names the rule and its version, and shows both sides; a specialist can
redo the comparison by hand. A language model reading the same documents produces text of the same
shape — a title, an observation, two quotes — and nothing about the row afterwards says which of
the two produced it.

So the decision this ADR exists to make is not *should we build AI review*. It is **how a reader,
a year later, tells a rule's finding from a model's suggestion that somebody agreed with.**

## Decision

### 1. The governing rule, restated because this is where it gets tested

> **Rules calculate. AI proposes. A human validates. The system preserves all three.**

AI is **not** an environmental auditor, a compliance authority, a legal reviewer, or a source of
project facts. It may **retrieve**, **compare**, **classify**, **suggest** and **draft**. A human
specialist decides.

### 2. Four tables of its own, and no path into `quality_finding`

`document_review_run` → `document_review_source` → `document_review_candidate` →
`document_review_evidence`, with `document_review_decision` beside the candidate.

The alternative was to write candidates into `quality_finding` with a distinguishing column. It is
rejected, and the reason is structural rather than aesthetic: `quality_finding` carries
`requirement_key` and `requirement_version`, which name a deterministic rule in versioned code
(ADR-020). An AI candidate has no rule. Writing one would mean **inventing a requirement key**, and
a study would then carry a finding attributed to a rule that never ran — which is the single most
damaging thing this product could do to its own record.

The fingerprint reconciliation is the second reason. A Quality Gate re-run finds the same
disagreement and updates the same row, because the rules are deterministic. A model is not, so the
same corpus reviewed twice would produce near-duplicates that the fingerprint could not reconcile —
and a decided finding would quietly reopen. A review run is therefore **a run**: a second opinion is
a second run, and both are kept.

### 3. What a candidate is, and what it has nowhere to put

A **title**, an **observation** of what two passages say, a **check a person might run**, and the
passages it rests on. There is nowhere in the schema for a verdict, a compliance conclusion, a
severity or a confidence.

**No severity.** That would be a model deciding how much attention a study deserves.

**No confidence score.** Slice 4 records one because a classifier returns a likelihood over a closed
taxonomy, and the surface labels it High/Medium/Low with a warning that it is uncalibrated
(invariant 10). A number attached to *"these two paragraphs might not agree"* has no such referent:
it would be a model's opinion of its own prose, and ordering a specialist's queue by it would be
worse than ordering the queue by nothing.

### 4. A reader must never have to infer which produced a row

Four mechanisms, each of which would be enough on its own and none of which is:

| Mechanism | What it does |
|---|---|
| Separate tables | a candidate cannot be read as a finding by any query |
| Separate surface | *Revisión asistida* is its own page, reached from Documentos, and says in its own copy how it differs from *Control de consistencia* |
| Separate code | `IA-001`, never `QG-001` |
| Separate words | every candidate is headed **“Candidato generado por IA”** — never *“Error detectado por IA”* — and its state reads *Propuesto por IA* / *Aceptado por especialista* / *Descartado por especialista*, in both languages |

### 5. Retrieval first, and the model is not always called

A **lens** is one bounded comparison — seven of them — and it carries its own full-text probes. The
probes run first, against the versions the run declared, using the same retriever the assistant uses
(ADR-021: PostgreSQL full-text, and the surface says so).

- **No passage, no claim.** If retrieval finds nothing, **no model is called at all** and the run
  completes saying `NO_PASSAGES`. A reader can tell that from `NO_CANDIDATES`, because *"there was
  nothing to look at"* and *"the model found nothing"* are different answers.
- **No citation, no candidate.** Every candidate names passage indices, resolved against the set
  that was actually retrieved. An index the model never received **fails that candidate** — it is
  never dropped, because a dropped citation leaves an observation standing and looking sourced. The
  refusal is counted on the run and shown, so how often it happens is visible.
- **No compliance conclusion.** `assertPermittedFindingLanguage` — invariant 11's own vocabulary,
  in both languages, the same list the rule catalogue is held to — runs over every field of every
  candidate. A candidate saying *incumplimiento* or *the system determines* is refused and counted.

There is deliberately **no lens meaning "review the study"**. An unbounded question produces
unbounded plausible text, which is what a model is best at and what must not reach a deliverable.

### 6. The privacy gate refuses the whole run; it never filters it

No `DocumentVersion` leaves this system for a model unless its `privacy_classification` is
`NO_PERSONAL_DATA_KNOWN` and its document is not flagged `contains_pii`. `REVIEW_REQUIRED` — the
default for every uploaded file — means **nobody has looked**, and treating "not yet examined" as
"safe to send" would send precisely the documents nobody has checked.

**A mixed corpus is REFUSED in full**, and the refusal names every document that blocked it.

The tempting implementation is to drop the ineligible documents and review the rest. It is rejected
because it is a lie with a long fuse: the specialist asked for *this* corpus, and *"no candidates in
the social chapter"* would come to mean *"the social chapter was never read"* with nothing on screen
saying so. The surface therefore lists every document with its classification, starts the eligible
ones selected, and lets a person select an ineligible one — at which point the run is refused and
says which one.

A refusal is **audited** (`documents.review.run_refused`), in its own transaction, because a refusal
is a decision the product made about somebody's data and one that left no trace would be
indistinguishable from a run nobody attempted.

### 7. Two sides, or it stays a suggestion

A finding in this product is a **disagreement between two named sources** — that is what
`finding_evidence` enforces with exactly one `SOURCE_A` and one `SOURCE_B`. A candidate resting on
one passage has not shown a disagreement; it has made an assertion, and a model is not entitled to
one.

So a `SINGLE_SOURCE` candidate is kept, shown, explained and **dismissible — and cannot be
accepted**. The domain refuses it, the database records only what the domain wrote, and the surface
says why rather than offering a button that always fails.

### 8. Checking and deciding are different grants, reused rather than minted

`quality.write` starts a review; `quality.review` settles a candidate — the same split the Quality
Gate makes between running a check and settling a finding (TENANCY.md §3.3). No permission is
minted, and the catalogue still holds exactly the 14 approved keys: the page is gated by
`quality.rag_assistant`, the AI-over-documents capability, whose meaning widens from *ask the
corpus* to *ask the corpus and have it reviewed*.

A justification is mandatory on every decision — in the domain, and again as a database CHECK — and
**both halves are preserved**: the model's words are write-once (a trigger permits only `state` to
change), and every decision, including a dismissal, is append-only.

### 9. Which reviewer answered is recorded, and unset is not `fake`

`DOCUMENT_REVIEWER` has **no default**, resolved by the one domain function the classifier and the
assistant already share (IG4-001). The deterministic reviewer is permitted only in `local` and
`test`; a gateway without its credential is `BLOCKED_EXTERNAL_CONFIG` and is never quietly demoted.

This is the adapter where that rule matters most. A fake classification is one row saying a response
is about *access to services*; a fake review candidate is a paragraph of plausible Spanish asserting
that two chapters of a study disagree — and once a specialist has accepted it, nothing would
distinguish it from a real model's suggestion.

Every run therefore records `adapter_kind`, `requested_model` and `prompt_version`, and the surface
prints them beside every candidate.

### 10. What leaves this system, exactly

Passages of the project's own documents, and nothing else. Not the filename, not the document code,
not the uploader, not the project's name, not a survey answer, not a parcel. The reviewer has no
tools, no retrieval of its own, no browsing, no filesystem and no database: passages in, a bounded
structured object out.

Passage text arrives inside a delimited block and the instruction says nothing inside it can change
the task. As with the assistant, the part that actually holds is that the model has **no capability
to grant**: the worst a hostile paragraph inside a delivered document can achieve is a candidate a
specialist reads and dismisses, beside the passages it cites.

Logs carry identifiers and counts. A passage never reaches a log line, and neither does a
candidate's text.

## Consequences

- Five new tables, one new migration pair (0044 additive tables, 0045 grants, RLS, triggers and the
  queue), FORCE RLS and composite foreign keys on all five, no `BYPASSRLS`, nothing destructive.
- A third SECURITY DEFINER queue helper in the shape migration 0017 established:
  `app.claim_document_review` returns **four uuids** — run, tenant, project, initiator — and no lens,
  no passage and no candidate. The worker then opens an ordinary RLS transaction as the initiator.
- A third worker consumer, started only when a reviewer is actually available.
- `quality.rag_assistant` now governs two things. That is a widening of meaning, recorded here and
  in FEATURES.md, and it is preferred to a fifteenth catalogue key.
- **No embeddings.** Retrieval is still PostgreSQL full-text, there is still no `vec` schema and no
  embedding column, and the surface still says which it is (ADR-021 stands unchanged).
- **A candidate never becomes a `quality_finding`**, and an integration test asserts that a review
  run writes none.

## What this does not do

- It does not review a study. It proposes things to look at, within seven bounded lenses, from
  passages that exist.
- It does not read a document nobody has classified, and it does not silently skip one.
- It does not run against real personal data anywhere: the compliance review of SECURITY.md §10a has
  not authorised that, and the privacy gate is what makes the restriction structural rather than a
  promise.
- It does not enable a live provider. `DOCUMENT_REVIEWER` is unset everywhere this repository
  controls, which means the surface reports `NOT_CONFIGURED` and offers no run.
