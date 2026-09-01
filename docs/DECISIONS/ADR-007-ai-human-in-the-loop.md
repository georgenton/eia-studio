# ADR-007 — Social AI: immutable source, AI suggestion, human validation as three stores

- Status: Accepted at Gate 1 (no specific conditions raised; AI vendor governance per D-018 documented in AI_GOVERNANCE.md §4a)
- Date: 2026-09-01
- Related: AI_GOVERNANCE.md, DATA_MODEL.md §3.5, ADR-005, ADR-006

## Context

Invariants 8, 9 and 10: IMMUTABLE SOURCE / AI SUGGESTED / HUMAN VALIDATED are three separate
layers in model and UI; the original answer is immutable for every role and process; taxonomies
are versioned and AI may only propose categories; the model score is not a calibrated
probability and is shown as `model score 0,86` plus a High/Medium/Low label with per-project
thresholds. Analytics, reports and the portal consume only validated codings. AI unavailability
must not block manual coding; low confidence must not preselect.

## Decision

1. **Three tables, three mutability rules**: `answer` (immutable after submit, field module);
   `ai_classification` (insert-only, one row per answer per classification run, social module);
   `human_review` (append-only decisions). A derived `answer_coding` row per answer holds the
   current status (`unreviewed`, `low_confidence`, `disagreement`, `validated`, `rejected`) and
   the validated category, recomputed from reviews in the same transaction.
2. **AIClassification provenance** is mandatory: provider, model, model version, prompt version,
   taxonomy version, deidentification run, suggested category/subcategory, candidate list with
   scores, model score, confidence label, thresholds snapshot, rationale, created timestamp.
3. **HumanReview** records action (accept · modify · new_category · reject · second_opinion ·
   manual), validated category/subcategory, taxonomy version, reviewer, timestamp, note, and the
   classification responded to (nullable for manual coding).
4. **Score semantics**: stored as a model score; the label is derived from project thresholds
   (`social.ai_coding.score_thresholds`, defaults 0.75/0.60) in force at classification time and
   stored with the row; calibration is a later research track with its own ADR. Copy linting
   forbids probability wording.
5. **Taxonomy versioning**: `TaxonomyVersion` published rows are immutable; `CategoryProposal`
   (AI or human origin) needs human approval, which creates a new draft version published
   explicitly; codings reference the version they were validated against; metrics state it.
6. **PII boundary**: classification inputs pass through the deidentification gateway; `ai` ports
   accept only `Deidentified<T>` (AI_GOVERNANCE.md §4).
7. **Ports with a deterministic fake adapter first**; real providers are configured later and
   recorded per row.

## Consequences

- Raw AI vs validated analytics are different queries by construction; agreement metrics for
  evaluation are available without extra tables.
- Re-running classification with a new model or prompt creates new rows and never rewrites
  history; the queue shows the latest classification per answer.
- Storage grows with every run (rows are small); retention of superseded classifications is a
  configuration decision, never an overwrite.
- The keyboard workflow (J/K/A/M/N/R/S) maps to review actions; `A` persists a review and
  advances; a reload must show the validated state (persisted mutation, not view state).

## Alternatives rejected

- A `category` column on the answer updated by AI then by humans: violates invariants 8 and 9.
- One "classification" table with a `status` column flipped from suggested to validated: collapses
  the layers and loses the AI row on modification.
- Treating score as probability with a single global threshold: forbidden by invariant 10 and by
  the per-project thresholds in the spec.
