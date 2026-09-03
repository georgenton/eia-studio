# ADR-019 — Three layers of truth for social coding: rules calculate, AI proposes, a human validates

- Status: Accepted (Slice 4)
- Date: 2026-09-03
- Related: ADR-005 (faceted provenance), ADR-007 (versioned taxonomy, AI proposes), ADR-008,
  AI_GOVERNANCE.md, SECURITY.md §10b and §14, PRODUCT.md invariants 8–10, FEATURES.md §2

## Context

Social Intelligence is the first surface where three different kinds of claim appear on one screen:
a count of closed answers, a model's guess about an open answer, and a specialist's decision about
that guess. They look alike — all three end up as a number or a chip — and the product's
credibility depends on their never being confused.

The design bundle already fixed the principle (invariant 8: IMMUTABLE SOURCE / AI SUGGESTED /
HUMAN VALIDATED are three layers). This ADR records how the implementation keeps them apart, and
the choices that were genuinely open.

## Decision

**Three layers, three storage locations, no overwriting.**

| Layer | Where it lives | Who may produce it | What reads it |
|---|---|---|---|
| Deterministic result | computed on read from `survey_answer` | SQL and `packages/domain/src/social/tabulation.ts` | the Tabulación tab |
| AI proposal | `ai_classification` + `ai_classification_category` | a `ClassificationRun` | the queue, the *provisional* distribution, evaluation |
| Validated coding | `human_review` + `human_review_category` | a specialist, per proposal | the validated distribution, and any future report |

Four consequences follow, and each is enforced rather than documented:

1. **A correction never edits the proposal.** `submitHumanReview` writes new rows and touches
   `ai_classification` not at all. The pair "what was proposed / what was decided" is what makes
   any later comparison meaningful; collapsing it into one value would destroy the only record
   that a disagreement happened.
2. **A review is final.** One review per proposal (unique key), and the `human_review_final`
   trigger refuses UPDATE and DELETE. A superseding re-review is a future, audited workflow
   (TD-041), not an in-place edit.
3. **Validated metrics count human labels only.** The provisional distribution exists, is
   computed separately, is labelled *Provisional · sin validar*, and never shares a denominator
   with the validated one.
4. **No deterministic figure is ever asked of a model.** Counts, percentages, denominators,
   totals, agreement and override rates are arithmetic in SQL and TypeScript.

**The decision is derived, not declared.** `decideReview` compares the two label sets and returns
ACCEPTED or CORRECTED; the client cannot send it. A client that could send `ACCEPTED` could record
a correction as an agreement — and that number is precisely what an evaluation would rest on.

**Agreement is not accuracy.** The reviewer decides *while looking at the proposal*, so the rate at
which the two coincide measures how often a specialist let a suggestion stand. It is labelled
"Coincidencia IA · especialista" in the UI, with the reason in visible text, and the word
*accuracy* appears nowhere. A gold standard would need independent, blinded coding and
adjudication, which this slice deliberately does not implement (TD-044).

**The model's confidence is a heuristic.** Stored as given, used to order review, labelled
"Confianza del modelo" with a note saying it is not a calibrated probability and not a percentage
of correctness. It never gates anything automatically.

## Alternatives considered

**One `coding` table with a `source` column (AI or human).** Fewer tables, and the shape most
codebases reach for. Rejected: the two are not the same kind of thing with a different author. A
proposal has a run, a model, a prompt and a latency; a decision has a reviewer, a moment and a
comparison. Merging them makes "what did the model actually say" a query over history rather than
a row, and makes overwriting a one-line accident.

**Let the human edit the proposal in place, keeping an audit trail.** Rejected for the same
reason: an audit log is a record *that* something changed, not a preserved value that analytics and
evaluation can both read. The audit log is still written; it is not the mechanism.

**Store the model's rationale.** Rejected (§14 of the slice brief, and on its own merits). A
plausible machine-written justification for a coding of what a person said about a road project is
exactly the artefact that would later be quoted as if it were reasoning. The structured output
carries labels, a confidence heuristic and a review flag; nothing else is requested or persisted.

**Compute the validated distribution over all responses, extrapolating from the reviewed ones.**
Rejected: that is a projection presented as a measurement. The unreviewed count is shown beside the
distribution instead.

## Consequences

- Two tables and two link tables where one pair might have done, and a read model that carries both
  distributions. The cost is real and small; the guarantee is the product's central claim.
- Any future report generator must read `human_review_category`, and cannot silently widen to
  proposals: the validated read model is the only one that reports a validated figure.
- The evaluation data a thesis needs — answer, taxonomy version, model, prompt hash, proposed
  labels, final labels, decision, latency, tokens, elapsed review time — is a by-product of this
  shape rather than an extra subsystem.
- `HumanReview` is **not** a gold standard, and this ADR is the place that says so, so a later
  slice cannot quietly promote it to one.
