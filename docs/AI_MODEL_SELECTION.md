# Choosing the model, from the catalogue that exists today

> A reading of the **live** Vercel AI Gateway catalogue, taken on **6 September 2026** from
> `https://ai-gateway.vercel.sh/v1/models` (a public listing; no credential, no model invoked).
> 373 models, 251 of them language models.
>
> Model names are the fastest-moving fact in this document. **Re-read the catalogue before
> acting on this file**; a remembered model id is how a deployment ends up pinned to something
> deprecated or to something that never existed. Nothing here has been called: activating any of
> it is the owner decision described in `docs/AI_LIVE_ACTIVATION.md` §4.

## 1. What we are choosing for

Two jobs, and they are not the same job.

| | Assisted coding | Narrative (assistant paragraph, report chapter) |
|---|---|---|
| Input | one short open answer in Ecuadorian Spanish, plus 8–20 category definitions | a handful of already-computed figures, or 1–5 retrieved passages |
| Output | one to three category codes, a confidence, a review flag — **structured** | one sober paragraph per section, in Spanish |
| Volume | one call per answer; hundreds in a real project | one call per generation; a person presses a button |
| What a wrong answer costs | a specialist corrects it — the proposal is never the result | a paragraph that must be rewritten, or a failed generation |
| Therefore | cheap, fast, reliable at structured output | better at Spanish prose; cost is irrelevant at this volume |

Both are read through one narrow port and both are **proposals** (ADR-019). Neither ever produces
a number: the figures are computed before the model is asked anything.

## 2. The filters that actually eliminated models

Applied to the catalogue's own fields, in this order:

1. **`type = language`** — 251 of 373.
2. **Not deprecated** — the catalogue carries `deprecated_at`; four models have one.
3. **`zdr = "all"`** — the gateway's zero-data-retention flag, across every provider route for that
   model. `"some"` means it depends which route serves the request, which is not a property this
   product can reason about, and `"none"` means it does not apply.
4. **`no_training = "all"`** — the content is not used to train.
5. **A provider with a support relationship worth having** (Anthropic, OpenAI, Google, Mistral,
   Amazon, Meta, Cohere).

That leaves **42** models. The third filter is the one that does the work, and it eliminates more
than expected: of OpenAI's language models, only the `gpt-oss-*` and `codex` families report
`zdr = all`; Google's Gemini models report `zdr = some`. Every current Anthropic model reports
`zdr = all`, `no_training = all` and `regions: ["eu", "us"]`.

Two things this filter is **not**. It is not a legal conclusion — the compliance review of
`docs/SECURITY.md` §10a decides what may be sent, and this product does not draw that conclusion in
code or in documentation. And it is not a substitute for the demo-only gate: today only
`DEMO_SIMULATION` answers may leave, whatever a model's retention flag says.

## 3. What was chosen, and why

### Assisted coding → `anthropic/claude-haiku-4.5`

| | |
|---|---|
| Catalogue | 200 000 context · 64 000 max output · `zdr: all` · `no_training: all` · regions `eu, us` · tags include `tool-use` |
| Price | **$1,00 / M input · $5,00 / M output** |
| Why | strong Spanish; reliable structured output through the AI SDK's `Output.object`, which is what the whole path depends on (an invented code is a *failed* classification, so a model that produces malformed output produces nothing); the smallest current model of a family whose whole line reports `zdr: all` in both regions |

Cheaper options exist and were considered rather than dismissed: `amazon/nova-lite`
($0,06 / $0,24) and `mistral/ministral-8b` ($0,15 / $0,15) are five to fifteen times less. At this
product's volume the difference is not money. A run of 200 answers at roughly 700 input and 60
output tokens each is about **0,14 M input and 0,012 M output** — **≈ $0,20** on Haiku 4.5 and
**≈ $0,01** on Nova Lite. Twenty cents is not a reason to accept worse Spanish or less reliable
structured output on the one path where a malformed answer means no proposal at all.

Revisit that trade the day a project has thousands of answers rather than hundreds — the comparison
belongs in this file, not in a code comment.

### Narrative → `anthropic/claude-sonnet-5`

| | |
|---|---|
| Catalogue | 1 000 000 context · 128 000 max output · `zdr: all` · `no_training: all` · regions `eu, us` · knowledge to 2026-01 |
| Price | **$2,00 / M input · $10,00 / M output** |
| Why | the paragraph is read by a consultant and possibly quoted; the input is a few hundred words and there is one call per generation, so the cost of the better model is cents per chapter. It is also **cheaper than `claude-sonnet-4.5`** ($3,00 / $15,00), which the code's own example still names |

A chapter's five sections at ~1 200 input and ~800 output tokens is **≈ $0,01** per generated
version. Cost is not a criterion here; being read is.

## 4. The prices this document was written against

Per million tokens, from the same catalogue read, input / output:

| Model | In | Out | zdr | no_training | Context |
|---|---|---|---|---|---|
| `amazon/nova-micro` | $0,035 | $0,14 | all | all | 128 k |
| `amazon/nova-lite` | $0,06 | $0,24 | all | all | 300 k |
| `mistral/mistral-small` | $0,10 | $0,30 | all | all | 32 k |
| `openai/gpt-oss-120b` | $0,10 | $0,50 | all | all | 131 k |
| `mistral/ministral-8b` | $0,15 | $0,15 | all | all | 128 k |
| `meta/llama-4-scout` | $0,17 | $0,66 | all | all | 128 k |
| **`anthropic/claude-haiku-4.5`** | **$1,00** | **$5,00** | all | all | 200 k |
| **`anthropic/claude-sonnet-5`** | **$2,00** | **$10,00** | all | all | 1 M |
| `anthropic/claude-sonnet-4.5` | $3,00 | $15,00 | all | all | 1 M |
| `anthropic/claude-opus-4.6` | $5,00 | $25,00 | all | all | 1 M |
| `google/gemini-2.5-flash` | $0,30 | $2,50 | **some** | all | 1 M |
| `openai/gpt-5-mini` | $0,25 | $2,00 | **some** | all | 400 k |

The last two are listed because they are the models somebody will suggest. They are excluded by
filter 3, not by price or quality.

## 5. What to write where

```
SOCIAL_CLASSIFIER=ai-gateway
SOCIAL_CLASSIFIER_MODEL=anthropic/claude-haiku-4.5
ASSISTANT_GENERATOR=ai-gateway
ASSISTANT_GENERATOR_MODEL=anthropic/claude-sonnet-5
AI_GATEWAY_API_KEY=<in the platform's environment, never in the repository>
```

The id must be provider-qualified, or availability resolves to `BLOCKED_EXTERNAL_CONFIG`: the model
is recorded on every run, and a bare name would let the gateway resolve something other than what
the run says it used.

## 6. When this document is wrong

It is wrong the moment the catalogue changes, which is often. Re-derive it — the listing is public
and needs no credential:

```bash
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '
  .data[] | select(.type=="language") | select(.deprecated_at==null)
  | select(.zdr=="all" and .no_training=="all")
  | [.id, (.pricing.input|tonumber*1e6), (.pricing.output|tonumber*1e6), .context_window]
  | @tsv' | sort -k2 -n
```

Then update §3 and §4 together, and say in the change what moved: a price, a deprecation, or an
opinion.
