# AI document review

> The map of the feature ADR-035 decides. Related: `docs/AI_GOVERNANCE.md` §8a, `docs/SECURITY.md`
> §10f, `docs/DOCUMENT_EXTRACTION.md` (where the passages come from), `docs/AI_LIVE_ACTIVATION.md`
> (how a live provider is turned on, and why it is not).
>
> **Nothing in this repository enables a live provider.** `DOCUMENT_REVIEWER` is unset everywhere,
> so the surface reports `NOT_CONFIGURED` and offers no run.

## 1. What it is, in one sentence

A model reads passages of this project's own documents and **proposes** things a specialist might
want to check. It detects nothing, concludes nothing, and writes nothing into a report.

> Rules calculate. AI proposes. A human validates. The system preserves all three.

## 2. The shape of a run

```
a person picks a lens and a corpus
  → privacy gate: every version must be NO_PERSONAL_DATA_KNOWN, or the whole run is refused
  → the run is written QUEUED, with its corpus as rows and its adapter and model as text
  → a worker claims it (four uuids, no content)
  → the lens's probes retrieve passages — full-text, over the declared versions only
  → no passages ⇒ no model call, and the run says NO_PASSAGES
  → the model returns candidates; each is grounded against what was actually retrieved
  → a candidate that cannot be grounded is refused and counted
  → a specialist accepts or dismisses, with a mandatory justification
```

## 3. The seven lenses

A lens is one bounded comparison and is the candidate's whole classification. There is no second
taxonomy, and deliberately **no lens meaning "review the study"**: an unbounded question produces
unbounded plausible text.

| Key | Looks for |
|---|---|
| `numerical_consistency` | figures about the same thing that do not match |
| `dates_chronology` | dates and sequences that do not fit |
| `project_identity` | the project named, coded or scoped differently in two places |
| `locations_institutions` | places and institutions that do not correspond |
| `social_conclusions_support` | a social conclusion without a passage that supports it |
| `management_plan_application_area` | a measure whose place of application does not match the area described |
| `general_cross_document` | two documents that cannot both be describing the same reality |

Each carries **short** full-text probes. They are short on purpose: `websearch_to_tsquery` ANDs
every term, so a probe written as a sentence matches almost nothing. Two or three words per probe
and several probes per lens is what actually retrieves; the results are merged, de-duplicated and
capped before the model sees them.

## 4. The tables

| Table | Holds | Mutability |
|---|---|---|
| `document_review_run` | one execution of one lens over a declared corpus | status advances; corpus, adapter and model never change |
| `document_review_source` | which versions the run was allowed to read, and their classification at the time | write-once |
| `document_review_candidate` | one suggestion, and the state a person put it in | only `state` may change, by trigger |
| `document_review_evidence` | the passages it rests on, quoted | write-once |
| `document_review_decision` | a person's accept/dismiss, with a mandatory reason | append-only, by grant *and* trigger |

All five: FORCE RLS, tenant and project columns, composite foreign key to `project`, no `DELETE`
grant.

## 5. What a candidate does not have

**No severity** — that would be a model deciding how much attention a study deserves. **No
confidence** — Slice 4 records one because a classifier returns a likelihood over a closed taxonomy;
a number attached to *"these two paragraphs might not agree"* would be a model's opinion of its own
prose, and ordering a specialist's queue by it would be worse than ordering it by nothing.

## 6. Why it is not the Quality Gate

| | Control de consistencia | Revisión asistida |
|---|---|---|
| What produced it | a deterministic rule, named and versioned | a language model |
| Reproducible by hand | yes | no |
| Code | `QG-001` | `IA-001` |
| Table | `quality_finding` | `document_review_candidate` |
| Re-run | reconciles on a fingerprint; a decided finding stays decided | a second run, kept beside the first |
| Words | *posible inconsistencia* | *Candidato generado por IA* |

A candidate has no path into `quality_finding`, because a finding carries a `requirement_key` and a
model's suggestion has no rule. Minting one would attribute a finding to a rule that never ran.

## 7. Two sides, or it stays a suggestion

A finding in this product is a disagreement between **two named sources**. A candidate resting on
one passage has made an assertion, which a model is not entitled to. It is kept, shown, explained
and dismissible — and cannot be accepted.

## 8. Who may do what

| Act | Grant |
|---|---|
| read the candidates and the run history | `quality.read` |
| start a review | `quality.write` |
| accept or dismiss a candidate | `quality.review` |

The same split the Quality Gate makes between running a check and settling a finding. No permission
was minted, and the capability catalogue still holds exactly 14 keys: the surface is gated by
`quality.rag_assistant`.

## 9. Turning it on

`DOCUMENT_REVIEWER` = `fake` | `ai-gateway`, with `DOCUMENT_REVIEWER_MODEL` and the shared
`AI_GATEWAY_API_KEY`. **No default and no fallback** (IG4-001): unset means the feature is
unavailable and says so, `fake` is refused outside `local` and `test`, and a gateway without its
credential is `BLOCKED_EXTERNAL_CONFIG` rather than a quiet demotion to the stand-in.

Turning on a live provider is meaningless until two other things are true:

1. the compliance review of `docs/SECURITY.md` §10a has assessed that vendor as a processor of a
   client's delivered documents;
2. somebody has actually classified the corpus — every uploaded version defaults to
   `REVIEW_REQUIRED`, and a run over one is refused.

## 10. What is not built

- **No embeddings.** Retrieval is PostgreSQL full-text and the surface says so (ADR-021).
- **No cross-project review.** A run reads one project's corpus, as every query here does.
- **No automatic runs.** A person picks a lens and a corpus; nothing schedules a review.
- **No promotion into a report.** An accepted candidate is a specialist's note about the study, not
  a fact a report snapshot may cite (ADR-022 admits five typed sources, and this is not one).
