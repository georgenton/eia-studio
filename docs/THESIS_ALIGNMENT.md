# What the product preserves for the research, and what it does not

> A mapping between the artefacts this system stores and the measurements a thesis on
> human-in-the-loop coding would need. **Nothing here is an evaluation**: no accuracy is claimed, no
> protocol is implemented, and the study itself is not in scope.
>
> Related: ADR-019 (rules calculate, AI proposes, a human validates), TD-044 (no independent
> evaluation), `docs/AI_GOVERNANCE.md` §9.

## 1. The three conditions, and what each one requires

| | Condition | What it is | Status |
|---|---|---|---|
| **A** | independent manual coding | a person codes the answer **without seeing a proposal** | **not possible today** — §4 |
| **B** | model-only proposal | the classifier's output, unreviewed | **preserved** — §2 |
| **C** | model + human review | the specialist's decision after seeing the proposal | **preserved** — §3 |

The comparison the research wants is A vs B vs C. Two of the three are already recorded in full,
by ordinary operation, with no research mode and no separate store. The third is missing for a
structural reason, and the structure is the finding.

## 2. Condition B — what a model proposed, on its own

Every proposal is a row in `ai_classification`, and the row carries the conditions it was produced
under rather than only its result:

| Field | Why the research needs it |
|---|---|
| `run_id` → `classification_run.requested_model`, `classifier_kind` | which model, and whether it was the live adapter or the deterministic fake — a comparison that mixed them would be meaningless |
| `classification_run.prompt_version`, `prompt_hash` | the exact instruction, fingerprinted. Today's prompt file does not describe a coding made three months ago |
| `classification_run.taxonomy_version_id` | the coding scheme as published then. A published `TaxonomyVersion` is immutable by trigger, so the scheme cannot drift under the data |
| `ai_classification_category` | the proposed codes |
| `confidence`, `needs_review` | the model's own heuristic, and whether it asked for review |
| `model_id`, `provider`, `input_tokens`, `output_tokens`, `total_tokens`, `latency_ms`, `attempts` | cost and latency per item, and how many attempts it took |
| `status`, `error` | including the failures. A model that returned an invented code produced **no** coding, and that is data too |

What is deliberately **not** stored: the provider's raw response body and any chain of thought. A
plausible machine-written rationale for a coding of what a person said is precisely the artefact
that would later be quoted as evidence of reasoning that never happened.

## 3. Condition C — what a person decided, having seen it

Every decision is a row in `human_review`, append-only:

| Field | Why the research needs it |
|---|---|
| `classification_id` | which proposal was in front of the reviewer |
| `decision` (`ACCEPTED` / `CORRECTED`) | the outcome, as the product computes it, not as the reviewer describes it |
| `human_review_category` | the final codes, whether or not they match the proposal |
| `reviewer_user_id`, `reviewer_membership_id` | who, and under which role |
| `review_started_at`, `submitted_at` | elapsed operational time — **not** active cognitive work, and the column comment says so |
| `taxonomy_version_id` | the scheme the decision was made against |

Two properties matter more than the columns. A correction **never overwrites** the proposal it
corrects — both survive, which is what makes the pair comparable at all. And a change of mind is a
second row rather than an edit, so the sequence of decisions is recoverable.

## 4. Condition A — why it is not possible today

Two obstacles, and only the first is structural.

**A human coding cannot exist without a proposal to attach to.** `human_review.classification_id`
is `NOT NULL`, with a unique constraint of one review per classification. The table is not "a
coding"; it is "a decision about a proposal". Condition A needs a coding whose existence does not
depend on a model having run — and there is no shape in this schema for one. That is not an
oversight: the product's claim is that AI proposes and a human validates, and a table that allowed
a review with no proposal would blur exactly the boundary ADR-019 draws.

**And a reviewer currently always sees the proposal.** Even if the row existed, the surface shows
the proposed categories and the confidence before the specialist chooses. Condition A requires a
**blind mode whose server never returns the proposal** — not a hidden panel, since anything the
browser receives can be read.

What the research would therefore need, none of which is built:

1. a coding row that does not require a `classification_id` — either a nullable column with a check
   that pins its meaning, or a separate `independent_coding` table, which is the honest shape
   because it is a different act;
2. a blind assignment mode: a server response that omits proposals for the answers under study, and
   a record of which answers were assigned blind, to whom, and in what order;
3. a randomisation and adjudication procedure — who codes what, and how two independent coders'
   disagreement is settled;
4. **more than one independent expert**, which is a recruitment problem rather than a software one.

## 5. What must not be claimed

`HumanReview` is **not** a scientific gold standard, and no part of this product may present it as
one. The reviewer decided while looking at the proposal, so agreement between the two measures
**concordance, not accuracy** — an anchoring effect is exactly what Condition A exists to detect,
and using C as the reference for B would measure it away.

The product's own copy already obeys this: scores are model scores with High/Medium/Low labels,
never calibrated probabilities, and "% de acierto", "precisión del" and "probabilidad calibrada"
fail a test over the message catalogues. TD-044 records the gap and its removal trigger.

## 6. What a research slice would and would not touch

It would add the independent coding row, the blind mode, and an export. It would **not** change
`ai_classification`, `human_review` or the taxonomy: everything Conditions B and C need is already
recorded by ordinary use, which is the point of this document. A research protocol that required
re-instrumenting the product would also be a protocol whose data came from a system nobody actually
worked in.
