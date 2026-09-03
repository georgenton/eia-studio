# Slice 4 — Social Intelligence / human-in-the-loop

> What was built on `feat/slice-4-social-intelligence`, what was deliberately left out, and every
> place the implementation departs from the approved design bundle. Companion to
> `docs/SLICE_1_REPORT.md`, `docs/SLICE_2_REPORT.md` and `docs/SLICE_3_REPORT.md`.

## 1. The journey this slice delivers

A social specialist opens Social Intelligence and sees the **deterministic tabulation** of the
closed questions of one survey version, with its denominators stated in words. On the second tab
they see the **open responses** that were submitted, start a **classification run**, and watch a
background worker turn each response into a **proposal** — labelled provisional, carrying the
model's confidence heuristic. They open one, agree with it, and it becomes a **validated coding**;
they open the next, change two labels, and it becomes a **correction**. The proposal is still
there, unedited, beside the decision. The validated theme distribution counts only what they
decided; the AI's own distribution sits in its own panel with its own base.

## 2. Rules calculate, AI proposes, a human validates

Three kinds of claim, three storage locations, and no overwriting — the subject of **ADR-019**.

| Layer | Produced by | Stored in | Read by |
|---|---|---|---|
| Deterministic | SQL counts + `tabulation.ts` arithmetic | nothing — computed on read | Tabulación tab, workflow counts |
| AI proposal | a `ClassificationRun` through the classifier port | `ai_classification` (+ categories) | the queue, the provisional distribution, evaluation |
| Validated coding | a specialist, one review per proposal | `human_review` (+ categories) | validated themes, and any future report |

Four rules make it hold rather than describe it:

- a correction writes new rows and **never touches** the proposal;
- a submitted review is final — one per proposal, no UPDATE, no DELETE (database triggers);
- validated figures count `human_review` labels only, and the provisional distribution never shares
  a denominator with them;
- no deterministic number is ever asked of a model.

The review **decision is derived**, not sent: `decideReview` compares the two label sets. A client
that could send `ACCEPTED` could record a correction as an agreement, and that is exactly the
figure an evaluation would rest on.

## 3. Deterministic tabulation, and its denominators

Counts come from SQL over **submitted** responses only — drafts never participate — and the shares
are computed by `tabulateQuestion`, which also decides and names the rule:

| Rule | Meaning | Where |
|---|---|---|
| `submitted` | responses submitted for this survey version: the universe | every question's header |
| `answered` | responses that answered *this* question; shares sum to 100 % | single choice, boolean, numeric |
| `answered_multi` | responses that answered this question, where one person may choose several — **shares can exceed 100 %**, and the screen says so | multi-choice, and the multi-label theme distributions |

Three counts are computed separately rather than inferred from one another (`submitted`,
`answered`, per-option tallies), because deriving "answered" from the sum of option counts is
wrong for multi-choice and is the single commonest way to publish a false percentage. A denominator
of zero yields `—`, never a division.

**Versions are not added together.** Tabulation groups by `SurveyVersion` and offers a chooser.
Aggregating across versions needs a declared mapping between their questions; matching on question
text would be a guess dressed as a result (TD-039 stays open).

## 4. The coding scheme is versioned, and its versions are immutable

`Taxonomy` → `TaxonomyVersion` (`DRAFT` → `PUBLISHED` → `RETIRED`) → `TaxonomyCategory`. A
published version and its categories cannot be edited or deleted; refinement publishes v2, and **v2
gets its own category rows** even where a code is unchanged. A classification and a review each
name the exact version they were made against, and a constraint trigger refuses attaching a
category of any other version.

That is the whole point: a coding means what the scheme said when the coding was made.
`slice4-taxonomy-versioning.integration.test.ts` proves it end to end — v1 published, a proposal
and a review made against it, v2 published with changed categories, and afterwards v1's rows are
untouched, both codings still resolve to v1, and every attempt to blur the two is refused.

## 5. The demo taxonomy is a reconstruction, and says so

The consultancy has **not** provided an official coding scheme. The fixture's
`road_social_concerns_demo` v1 is eight categories reconstructed from the themes the demo
questionnaire can produce, carrying `sourceNote` "DEMO / RECONSTRUIDA · derivada de los temas del
cuestionario demo, no de un esquema entregado por la consultora", its own provenance record
(`DEMO_SIMULATION` / `SYSTEM_GENERATED` / `RECONSTRUCTED`), and a `DEMO / RECONSTRUIDA` badge on
screen.

Categories: comunicación e información · empleo local · acceso al predio, cerramientos y linderos ·
molestias de la construcción · seguridad vial y uso de la vía · mecanismo de quejas y reclamos ·
apoyo al proyecto y beneficios esperados · otro tema (residual). No category concerns health,
disability or any other special-category personal characteristic.

## 6. The AI boundary

**Demo data only, enforced twice.** `assertAiProcessingAllowed` refuses any answer whose provenance
regime is not `DEMO_SIMULATION` — when the run is created, and again in the worker at the moment
the text would leave. It is a check on the *data*, not the caller: a specialist with every
permission cannot send a historical answer. The integration test asserts the classifier port was
**never invoked** for a refused run.

**Data minimisation by type.** `ClassificationInput` carries the response text and the taxonomy
definition. There is nowhere in it for a respondent, a technician, a parcel code, a coordinate, a
visit or another answer.

**Injection boundary.** Response text arrives inside a delimited block; the instruction states that
nothing inside it can redefine the task; the structured output admits only category codes of one
published version. An invented code — `ADMIN`, or prose — is a **failed classification**, never
coerced to `OTHER`. `OTHER` is a category a classifier may choose, not a landing pad.

**No agency, no reasoning stored.** The classifier has no tools, no retrieval, no browsing, no
filesystem, no database. Chain-of-thought is neither requested nor persisted, and neither is the
raw provider body: the product stores labels, a confidence heuristic and a review flag.

**Confidence is a heuristic.** Labelled "Confianza del modelo", with visible text — not a tooltip —
saying it is not a calibrated probability and not a percentage of correctness. It orders review and
gates nothing.

**Agreement is not accuracy.** The reviewer decided while looking at the proposal, so the rate at
which the two coincide is operational concordance. The UI says so in words beside the figure.

## 7. Runs, models and reproducibility

A `ClassificationRun` fixes one evaluation: taxonomy version, source survey version and question,
**requested** model, **resolved** model (what the provider says answered — they can differ),
provider, classifier kind, prompt version, prompt hash, initiator, status and timings. Changing the
model, the prompt or the scheme creates a **new run**; no "latest configuration" lookup can
reinterpret historic proposals, and the regression test proves a second run leaves the first
untouched.

What this makes reproducible is *which text, which scheme, which prompt, which model, which run,
which output*. It is not a claim that running the same model twice returns the same labels.

Per classification: status, confidence, `needs_review`, model id, provider, input/output/total
tokens, latency, attempts. Cost is deliberately not computed (TD-047).

## 8. The worker, without `BYPASSRLS`

A worker has no session and no membership, so it cannot select a queue under RLS — and giving it
`BYPASSRLS` would trade a tenancy guarantee for a scheduling convenience. Instead:

1. `app.claim_classification` (SECURITY DEFINER, owned by `eia_policy`, fixed `search_path`, no
   dynamic SQL, EXECUTE revoked from PUBLIC) claims **one** pending row with
   `FOR UPDATE SKIP LOCKED` and returns four **uuids**: the classification, its tenant, its project
   and the user who started the run. No text, no categories, no other tenant's rows. A contract
   test asserts every returned column is a uuid.
2. The worker opens an ordinary RLS transaction **as that user** and does all of its reading and
   writing there. Revoked access in the meantime means the row is invisible and the job fails
   safely.
3. The privacy gate is re-checked on the answer before the call.

Idempotency: `SKIP LOCKED` plus the status transition plus the unique key on `(run, answer)` — two
workers cannot both succeed, and the integration test claims twice concurrently to prove it. A
claim that never completes returns to `PENDING` after a bounded interval; that is the whole of the
recovery strategy, and there is no broker, no Redis and no scheduler.

The privileged-helper contract test was **amended, not loosened**: it now describes two classes —
membership predicates (boolean, `LANGUAGE sql`) and the job helpers (identifiers and counts only) —
and holds both to the same hardening rules.

## 9. Authorization

| Act | Key | Who |
|---|---|---|
| read deterministic analytics | `social.read` | COORDINATOR, SOCIAL_SPECIALIST, REVIEWER, VIEWER |
| read an individual open response and its codings | `field.responses.read` (**reused**, not duplicated) | COORDINATOR, SOCIAL_SPECIALIST, REVIEWER |
| start a classification run | `social.ai.run` | SOCIAL_SPECIALIST |
| settle a coding | `social.coding.review` | SOCIAL_SPECIALIST, REVIEWER |

A FIELD_TECHNICIAN has none of them and is denied at the route. A coordinator watches the workflow
but neither sends text to a model nor settles a coding.

**One honest limitation.** Aggregate tabulation also requires `field.responses.read`, because the
counts are computed from response rows under RLS: a caller without it would be shown **zeros**
rather than a denial — a plausible-looking, entirely false tabulation. Denying is the correct
failure; the aggregate projection that would let a VIEWER see real totals without seeing rows is
TD-045. This was found by a test written for the opposite expectation, and the code changed rather
than the test.

## 10. Provenance

`AIClassification`: regime `DEMO_SIMULATION`, origin `SYSTEM_GENERATED`, transformation `DERIVED`,
granularity `INDIVIDUAL`, validation state `PENDING` — a proposal is explicitly not validated.
`HumanReview`: the same facets with validation state `VALIDATED`. The four canonical facets are
unchanged and no new SOURCE_TYPE enum was introduced; the badges remain derived labels.

## 11. What was built

| Layer | Files |
|---|---|
| Domain | `packages/domain/src/social/{taxonomy,classification,review,tabulation,classifier-port}.ts` |
| Database | migration `0016` (8 tables), `0017` (RLS, immutability and version triggers, the two job helpers) |
| Application | `packages/application/src/social/{prompt,classifier,use-cases,read-models,worker}.ts`, `scripts/drain-classifications.ts` |
| Worker | `apps/worker/src/classification-consumer.ts` |
| Web | `app/t/[tenant]/p/[project]/social/page.tsx`, `components/social/*`, `lib/social-actions.ts` |
| Configuration | `packages/contracts/src/env/social.ts` (`SOCIAL_CLASSIFIER`, `SOCIAL_CLASSIFIER_MODEL`, `AI_GATEWAY_API_KEY`) |

## 12. Verification

| Suite | Result |
|---|---|
| Unit and domain | **185 passed** — 31 of them the new social suite |
| Integration (Testcontainers, RLS) | **240 passed** (18 files), including the taxonomy versioning regression, the AI-gate regression and the worker concurrency test |
| End to end (Playwright) | **105 passed** across coordinator, admin, technician, second technician, specialist and anonymous projects |
| Accessibility (axe) | 16 scans, no serious or critical violations (5 of them new Social states) |
| Seeder idempotency | stable across a second pass, taxonomy reused rather than re-created |
| Lint, format, typecheck, build | clean |

**CI makes zero live model calls.** `SOCIAL_CLASSIFIER` defaults to `fake`; no API key is required
by any job.

## 13. What this slice does not do

No Quality Gate · no RAG, no embeddings, no pgvector · no report generation · no agents or tool
calling · no fine-tuning · no taxonomy editor (TD-043) · no correction of a submitted review
(TD-041) · no manual coding without a proposal (TD-048) · no cross-version aggregation (TD-039) ·
no cost computation (TD-047) · **no thesis evaluation protocol** — `HumanReview` is not a gold
standard, and ADR-019 and TD-044 say so where a later slice cannot miss them.

## 14. Deviations and notes

- **The demo fixture gained a fifth synthetic identity**, `especialista@demo.invalid`
  (SOCIAL_SPECIALIST), because no existing demo role may start a run or settle a coding. The field
  baseline — 1 campaign, 12 assignments, 4 submitted responses, 26 answers, 8 multi-choice
  selections — is unchanged.
- **Only two of the four submitted demo responses carry open text**, because the field fixture
  writes `concern_text` on alternate assignments. That was left alone rather than widened: Slice 3's
  baseline is not rewritten to make Social look busier.
- **The design bundle has no Social screens for this exact composition.** The two states it does
  define — open response, low confidence — are honoured; the surrounding layout follows the
  established panel grammar.
- **No chart library was added.** Distributions are tables with a two-element bar.
