---
"@eia/domain": minor
"@eia/application": minor
"@eia/contracts": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/worker": minor
"@eia/web": minor
---

AI document review: an AI candidate is not a finding, and the corpus it may read is refused rather
than filtered (ADR-035).

A model reads passages of this project's own documents and **proposes** things a specialist might
want to check. It detects nothing and concludes nothing. *Rules calculate. AI proposes. A human
validates. The system preserves all three.*

**Four tables of its own, and no path into `quality_finding`.** A finding carries a
`requirement_key` naming a deterministic rule in versioned code (ADR-020); a model's suggestion has
no rule, so writing one there would mean inventing a requirement key and attributing a finding to a
rule that never ran. A candidate lives in `document_review_candidate`, is coded `IA-001` rather than
`QG-001`, sits on its own page, and is headed **“Candidato generado por IA”** — never *“Error
detectado por IA”* — in both languages.

**Retrieval first, so the model is not always called.** Seven bounded lenses, each carrying its own
full-text probes (ADR-021: still PostgreSQL full-text, still no embeddings, still says so on
screen). **No passage, no claim**: with nothing retrieved, no model is called and the run reports
`NO_PASSAGES`, which a reader can tell from `NO_CANDIDATES`. **No citation, no candidate**: every
candidate names passage indices resolved against what was actually retrieved, and one that cannot be
grounded is refused *and counted on the run*, never dropped. **No compliance conclusion**: invariant
11's forbidden vocabulary, in both languages, over every field of every candidate.

**The privacy gate refuses the whole run rather than filtering it.** Only a version classified
`NO_PERSONAL_DATA_KNOWN` may be read by a model; `REVIEW_REQUIRED` — the default for every upload —
means nobody has looked. A mixed corpus stops the run entirely and the surface **names every
document that blocked it**, because reviewing the rest would make "no candidates in the social
chapter" come to mean "the social chapter was never read". The refusal is audited in its own
transaction.

**Two sides, or it stays a suggestion.** A candidate resting on one passage has made an assertion
rather than shown a disagreement: it can be dismissed and **cannot be accepted**.

**Both halves are preserved.** The model's words are write-once — a trigger permits only `state` to
change — and every decision, including a dismissal, is append-only with a mandatory justification.
A candidate cannot be deleted at all.

`quality.write` starts a review and `quality.review` settles a candidate: the Quality Gate's own
split between checking and deciding, reused rather than duplicated. No permission is minted and the
catalogue still holds exactly 14 keys — `quality.rag_assistant`'s **meaning widens** from *ask the
corpus* to *ask the corpus and have it reviewed*.

`DOCUMENT_REVIEWER` is the third adapter under the same no-default rule (IG4-001), resolved by the
same domain function: unset means unavailable, `fake` is refused outside `local` and `test`, and a
gateway without its credential is `BLOCKED_EXTERNAL_CONFIG` rather than a quiet demotion. Every run
records its adapter, model and prompt version. **No live provider is enabled anywhere.**

Migrations 0044 (five tables) and 0045 (grants, FORCE RLS, immutability triggers, the mandatory-
justification CHECK, and `app.claim_document_review` — four uuids and no content), additive and
forward only. New docs: `docs/AI_DOCUMENT_REVIEW.md`; `SECURITY.md` §10f; `AI_GOVERNANCE.md` §8a.
