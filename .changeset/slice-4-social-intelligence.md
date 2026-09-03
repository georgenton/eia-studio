---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/contracts": minor
"@eia/web": minor
"@eia/worker": minor
---

Slice 4 — Social Intelligence: deterministic tabulation, AI proposals, human validation.

The first slice in which a language model is part of the product, governed by one rule: **rules
calculate, AI proposes, a human validates, and the system preserves all three** (ADR-019).

**Deterministic tabulation.** Closed-question counts and percentages over submitted responses only,
computed in SQL and shaped by pure arithmetic, with the denominator declared in words beside every
question — including that multi-choice shares can sum past 100 %. Versions are tabulated separately
and never added together. No figure on this half is ever asked of a model.

**A versioned, immutable coding scheme.** `Taxonomy` → `TaxonomyVersion` → `TaxonomyCategory`, with
a published version and its categories frozen by database trigger and v2 getting its own category
rows. A classification and a review each name the exact version they were made against, and a
category of any other version is refused. The demo scheme is a reconstruction and is labelled
DEMO / RECONSTRUIDA: no official taxonomy has been provided.

**Proposals that stay proposals.** `ClassificationRun` fixes the taxonomy version, the source
question, the requested and resolved model, the prompt version and its hash; `AIClassification`
records one proposal per answer with its confidence heuristic, tokens and latency. A specialist's
`HumanReview` is the validated coding — one per proposal, final once submitted, with the decision
derived from the label sets rather than sent by the client — and it never overwrites the proposal
it corrects. Validated theme distributions count human labels only; the AI's own distribution is
shown separately, labelled provisional, with its own base.

**The AI boundary.** Only `DEMO_SIMULATION` answers may leave for a model, checked in the use-case
and again in the worker; a non-demo answer is refused whatever the caller's role. The classifier is
one narrow port with no tools, no retrieval and no browsing; its input type has nowhere to put a
respondent, a technician, a parcel or a coordinate; its output admits only category codes of one
published version, and an invented code is a failed classification rather than an `OTHER`. No
reasoning and no raw provider body is stored. Confidence is an uncalibrated heuristic and
AI-versus-human coincidence is labelled agreement, never accuracy.

**Background execution without `BYPASSRLS`.** The queue is the `ai_classification` table itself.
`app.claim_classification` claims one row with `FOR UPDATE SKIP LOCKED` and returns four uuids —
never content — and the worker then works inside an ordinary RLS transaction as the user who
started the run.

**Configuration, not code, names the model — and nothing defaults.** `SOCIAL_CLASSIFIER`
(`fake` | `ai-gateway`) and `SOCIAL_CLASSIFIER_MODEL`, with no fallback in either direction: a
gateway configured without a key
fails rather than fabricating codings. CI runs entirely on the deterministic fake and needs no
credential.

Tenancy-impact: eight new tables, each tenant- and project-scoped with composite FKs, RLS ENABLE +
FORCE and provenance FKs; codings inherit the `field.responses.read` boundary that already governs
the responses they describe. Two new project permissions (`social.ai.run`, `social.coding.review`);
Social analytics require `field.responses.read` even for aggregates (TD-045). One new SECURITY
DEFINER pair for job claiming, owned by `eia_policy`, returning identifiers only.

Schema-impact: migrations 0016 (tables) and 0017 (RLS, immutability and version triggers, job
helpers). Additive; no backfill; rollback is dropping the new objects.
