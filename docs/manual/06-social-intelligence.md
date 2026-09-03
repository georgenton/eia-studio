# 06 · Social Intelligence

`/t/…/p/…/social`, signed in as `especialista@demo.invalid`.

The surface has two tabs because it holds two different kinds of claim, and a reader should never
have to work out which one a figure came from.

## Tabulación — what the rules calculate

Counts and percentages over **submitted** responses only, computed in SQL and shaped by pure
arithmetic. No number here is ever asked of a model.

Every question states its **denominator in words**:

| Rule             | Meaning                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `submitted`      | responses submitted for this survey version — the universe                             |
| `answered`       | responses that answered _this_ question; shares sum to 100 %                           |
| `answered_multi` | one person may choose several, so **shares can exceed 100 %** — and the screen says so |

Versions are tabulated separately and **never added together**: aggregating across two published
versions needs a declared mapping between their questions, and matching on question text would be a
guess dressed as a result (TD-039).

## Respuestas abiertas — what a model proposes and a specialist decides

1. **Start a run.** Only a `SOCIAL_SPECIALIST` may. It records the taxonomy version, the source
   survey version and question, the requested model, the prompt version and its hash.
2. **The worker classifies.** Each response becomes a **proposal**, labelled provisional, carrying
   the model's confidence.
3. **You decide.** Accept the proposal, or change the labels. Either way the proposal stays where
   it is, unedited, beside your decision.

Three things the screen is careful about:

- **Confidence is a heuristic, not a probability.** It is labelled "Confianza del modelo" with
  visible text saying it is neither calibrated nor a percentage of correctness. It orders your
  queue and gates nothing.
- **Agreement is not accuracy.** You decided while looking at the proposal, so the rate at which
  you and the model coincide is operational concordance. The figure says so beside itself.
- **Validated figures count human labels only.** The AI's own distribution sits in its own panel
  with its own base, and the two never share a denominator.

## When assisted coding is unavailable

The Tabulación tab is unaffected — deterministic analytics do not need a model. The coding tab
states which of three reasons applies: nothing configured here, a test classifier that must not run
in this environment, or an external provider configuration that is incomplete. **It never silently
substitutes the deterministic test classifier**, because its proposals would be indistinguishable
from a real model's once they were rows (SECURITY.md §10c.1).

On staging today, assisted coding is unavailable: no model provider credential is configured
(TD-049). The proposals visible in a local demo come from the deterministic test classifier, which
is only permitted locally and in tests.

## What cannot be done

- **A submitted review is final.** No re-review, no reopen, no supersede (TD-041).
- **A published taxonomy version cannot be edited.** Refinement publishes v2, which gets its own
  category rows even where a code is unchanged; existing codings keep resolving to v1.
- **Only demo data may be sent to a model.** The gate is on the _data_, not on you: a specialist
  with every permission cannot send a historical or live answer. It is checked when the run is
  created and again in the worker at the moment the text would leave.

## The demo taxonomy is a reconstruction

`road_social_concerns_demo` v1, eight categories, badged **DEMO / RECONSTRUIDA**. It was derived
from the themes the demo questionnaire can produce, not supplied by the consultancy.
