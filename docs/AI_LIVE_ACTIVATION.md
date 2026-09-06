# Activating live AI, when the owner decides to

> What is configured, what would leave this system, what it would cost, how to try it small, and
> how to turn it off. **This document is not an authorisation.** No model provider is configured in
> any environment as it is written, no paid call has been made, and activating one is an owner
> decision that also depends on the privacy and vendor review of `docs/SECURITY.md` §10a.
>
> Related: ADR-019 (rules calculate, AI proposes, a human validates), ADR-021 (retrieval is
> full-text and says so), ADR-022 (the snapshot is the deliverable), IG4-001 / SECURITY.md §10c.1
> (explicit configuration, no default, no fallback), `docs/AI_MODEL_SELECTION.md` (which model, and
> why), `docs/AI_GOVERNANCE.md`.

## 1. Three features, two selectors, one credential

| Feature | Surface | Selector | Model variable | What is lost when it is off |
|---|---|---|---|---|
| Assisted coding | Análisis social · respuestas abiertas | `SOCIAL_CLASSIFIER` | `SOCIAL_CLASSIFIER_MODEL` | proposals. Tabulation, denominators, validated themes and the queue keep working |
| Document assistant's paragraph | Documentos | `ASSISTANT_GENERATOR` | `ASSISTANT_GENERATOR_MODEL` | the paragraph. Retrieval and its citations *are* the answer and need no model (ADR-021) |
| Report chapter's prose | Informes | `ASSISTANT_GENERATOR` (shared) | `ASSISTANT_GENERATOR_MODEL` | the prose. The snapshot is the deliverable and is complete without it (ADR-022) |

`AI_GATEWAY_API_KEY` is the single credential, read by the AI SDK and never by our code — we check
only that it is present. `APP_ENV` decides whether a deterministic stand-in is permitted at all.

Each selector takes exactly two values: `fake` (deterministic, in-process, no network) and
`ai-gateway` (live, AI SDK v7 through the Vercel AI Gateway). **There is no default and no fallback
in either direction.**

## 2. The resolution matrix

One domain function decides for the web app, the worker and the operator scripts alike
(`resolveAiAdapterAvailability`, `packages/domain/src/ai/availability.ts`).

| `APP_ENV` | selector unset | `fake` | `ai-gateway`, no credential | `ai-gateway`, no model id | `ai-gateway`, both |
|---|---|---|---|---|---|
| `local`, `test` | `NOT_CONFIGURED` | **available** (not live) | `BLOCKED_EXTERNAL_CONFIG` | `BLOCKED_EXTERNAL_CONFIG` | **available (live)** |
| anything else | `NOT_CONFIGURED` | `FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT` | `BLOCKED_EXTERNAL_CONFIG` | `BLOCKED_EXTERNAL_CONFIG` | **available (live)** |

Three properties are deliberate and must survive any change to this table:

- **Unknown environments are persistent.** The predicate names `local` and `test`; a misspelt
  `APP_ENV` loses assisted coding rather than gaining a fake one.
- **Unavailable is not an outage, and never a startup failure.** A deployment does not refuse to
  boot over a feature it may not use.
- **A model id must be provider-qualified** (`anthropic/claude-haiku-4.5`). Without the provider
  the gateway would resolve something other than what the run records, and the run's
  `requested_model` would be a fiction.

## 3. The invariant to preserve: no provider, no fabrication

With every selector unset, the product does everything except three things, and says so on screen
in each place. What must **never** happen instead:

- no deterministic stand-in writing rows a reader would take for a model's work (IG4-001 — a fake
  proposal and a real one are the same row once stored);
- no `ClassificationRun` created that nothing can process (`startClassificationRun` refuses before
  it reads a single answer, so the queue never shows work that will not move);
- no silent degradation: each surface names which of the three reasons applies.

`pnpm demo:doctor` reports both adapters' state, and reports fake-written rows in a persistent
environment as a **FAIL**.

## 4. Turning it on

1. The owner authorises it, in writing, referencing the privacy and vendor position of §10a.
2. Choose the model from `docs/AI_MODEL_SELECTION.md` (which is a reading of the gateway's live
   catalogue, not a memory).
3. Set on **staging only**, as environment variables, never in the repository:
   `SOCIAL_CLASSIFIER=ai-gateway`, `SOCIAL_CLASSIFIER_MODEL=<id>`, `AI_GATEWAY_API_KEY=<value>` on
   both `apps/web` and `apps/worker` — the worker is what actually calls the model, the web app
   only needs to know whether the feature is available.
4. Run the smoke of §7 — two answers — and read what it recorded.
5. Only then consider the assistant's `ASSISTANT_GENERATOR`, which is a second decision.

Nothing about this is a deployment: no code changes, and no migration.

## 5. What would actually leave this system

Asserted, not intended: `packages/application/test/ai-outbound-boundary.test.ts` fails if any of
these widens.

### 5a. Assisted coding

| | |
|---|---|
| Sent | one answer's text, delimited; the taxonomy version's codes, labels and definitions |
| Not sent | the respondent, the technician, the parcel, the visit, coordinates, any other answer, any identifier — the classifier's input type **has nowhere to put them** |
| Gate | `assertAiProcessingAllowed` refuses any answer whose regime is not `DEMO_SIMULATION`, checked when the run is created **and** again in the worker at the moment the text would leave. A specialist with every permission cannot send a `HISTORICAL_OBSERVED` answer |
| Prompt injection | the text is delimited and declared to be data; the output schema admits only codes of one published version; an invented code **fails** the classification and is never coerced to `OTHER` |
| Not requested, not stored | chain of thought, and the raw provider response body |
| Recorded | model id, provider, input/output/total tokens, latency, prompt version and a hash of the exact instruction, on every classification |

### 5b. The document assistant (Phase I boundary)

| | |
|---|---|
| Sent | the question the user typed, and the text of the passages retrieval already selected |
| Not sent | the chunk ids, document codes, page numbers, the corpus, the database, or anything not retrieved for this question |
| Boundary | a document flagged `contains_pii` is **refused at ingestion**, not redacted, so the corpus a passage can come from cannot contain identified personal data |
| Grounding | a generated answer may cite only what was retrieved; an invented index fails the answer rather than being dropped |
| Nothing persisted | an answer is a read, not project content. Which also means **no token record exists for this path** |
| Retrieval needs no model | PostgreSQL full-text, and the screen says so. There is no embedding, no vector column, no fake embedder (ADR-021) |

### 5c. The report chapter (Phase J boundary)

| | |
|---|---|
| Sent | the snapshot's section titles, summaries, and each fact's label, value and basis; the project name, the questionnaire version, the regimes present |
| Not sent | the responses, the documents, the database, and — asserted — the **sources** each fact rests on: chunk ids, provenance ids, review counts |
| Order | the snapshot is computed and validated **before** any prose exists; prose is generated from the snapshot and never from the database |
| Grounding | a paragraph stating a figure its section did not compute **fails the generation** rather than being trimmed |
| Draft only | the .docx says `BORRADOR — NO ES UN ENTREGABLE APROBADO`, because there is no approval workflow (TD-060) and nothing in the system can say otherwise |
| Recorded | `narrative_model` and `narrative_prompt_version` on the version. **Tokens are not recorded** (TD-075) |

One thing this table does *not* claim: that the report path sends only demo data. It sends
**already-computed figures**, and some of them rest on the study's historical numbers. The
`DEMO_SIMULATION` gate is a rule about *individual survey answers*, which is where the personal
data would be; an aggregate with its denominator is not the same object and is not governed by the
same rule. Saying otherwise would be a comfortable overstatement, and the distinction is the reason
§10a's review is about data categories rather than about features.

## 6. Cost, and the guardrails that bound it

| Path | Calls | Input size | Bounded by |
|---|---|---|---|
| Assisted coding | **one per answer** | one short answer + the taxonomy | `MAX_ANSWERS_PER_CLASSIFICATION_RUN = 200`, and an explicit `limit` |
| Document assistant | one per question asked | the question + up to the retrieval limit of passages | the retrieval limit; a person asking |
| Report chapter | one per generated version | the snapshot — a few hundred words | the snapshot's shape |

The classifier is the only path whose cost scales with the project rather than with a person
pressing a button, and it is the one that was unbounded. A run now refuses rather than truncating:

> `412 eligible responses exceeds the 200 a single run may send to a model. Say how many with an
> explicit limit; the run is not truncated for you.`

Truncating silently would leave a queue whose remainder nobody is waiting for and a distribution
computed over whichever answers sorted first. The decision is one pure function
(`selectAnswersForRun`), so the refusal is testable without a database and cannot drift between the
button and the script.

The pilot's four submitted responses make every figure here negligible; the guardrail exists for
the project after this one. Per-token prices are in `docs/AI_MODEL_SELECTION.md` §4.

## 7. The smoke procedure — **not executed**

The first live call should be two answers, deliberately, with somebody reading the result. It takes
the product's own path: the same context, the same capability and permission checks, the same
demo-only gate, the same rows.

```bash
pnpm social:run --email especialista@demo.invalid --tenant demo-consultancy \
  --project puente-del-amor --limit 2
```

Before running it: `SOCIAL_CLASSIFIER=ai-gateway`, a model id, and the credential must be set for
**both** the command and the worker; `APP_ENV` must not be `production` (the script refuses); and
the answers must be `DEMO_SIMULATION` (the gate refuses otherwise, before any row is written).

Then read, from the database rather than from the screen:

```sql
select r.requested_model, r.classifier_kind, r.prompt_version, r.status,
       count(c.*) as proposals,
       sum(c.input_tokens) as input_tokens, sum(c.output_tokens) as output_tokens,
       avg(c.latency_ms)::int as avg_latency_ms
  from app.classification_run r
  left join app.ai_classification c on c.run_id = r.id
 where r.id = '<run id>'
 group by 1,2,3,4;
```

What to check, in this order: the run's `requested_model` is the model you set; the proposals are
plausible **Spanish** codings of what the person actually wrote; `confidence` is present and is
being read as a review aid rather than an accuracy; the tokens are of the order §6 predicts; and
the specialist review path still treats the proposal as a proposal.

Then decide whether to widen. Not before.

## 8. Turning it off

Unset `SOCIAL_CLASSIFIER` (and `ASSISTANT_GENERATOR`) and redeploy. That is the whole rollback:

- no schema change to undo — the tables exist and hold what was already produced;
- proposals already written stay, correctly attributed to the model that wrote them, which is why
  the model id and prompt hash are on the run;
- validated codings are unaffected: they are a human's decision, and a coding never depended on the
  proposal it corrected;
- every deterministic figure is unchanged, because none of them ever asked a model for a number.

Removing the credential without unsetting the selector is **also** safe — it resolves to
`BLOCKED_EXTERNAL_CONFIG` and the feature reports itself unavailable — but it is the worse of the
two, because it reads like a mistake rather than a decision.

## 9. What is still true after activation

- A model output is a **proposal**. It is never the validated coding, never overwrites an answer,
  and never enters a validated figure without a human decision (ADR-019).
- A score is a model score with High/Medium/Low labels, never a calibrated probability, and
  AI-vs-human coincidence is **agreement, never accuracy** (TD-044).
- Deterministic tabulation never asks a model for a number.
- `HumanReview` is not a scientific gold standard, and nothing in the product may present it as one.
