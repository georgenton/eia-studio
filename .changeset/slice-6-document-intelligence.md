---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/contracts": minor
"@eia/web": minor
---

Slice 6 — document intelligence: an evidence layer, and an assistant that answers from it with
citations a reader can follow.

**A citation names a version, and versions are immutable.** A corrected file is a new
`DocumentVersion` with its own chunks; the old one keeps its words and its chunk ids, so a citation
made last month still resolves to what it cited. `document_chunk` refuses UPDATE and DELETE — grant
*and* trigger, so the owning role cannot either — with the cascade from its version as the one
legitimate route.

**Retrieval is PostgreSQL full-text, and the surface says so** (ADR-021, amending ARCHITECTURE.md
§5/§9 and AI_GOVERNANCE.md §8). No embedding provider is configured anywhere, and a vector column
filled by a deterministic stand-in is indistinguishable from one a model produced — the artefact
IG4-001 exists to prevent, one slice later and in a column. There is no pgvector, no `vec` schema,
no embedding column and no fake embedder, and an isolation test asserts their absence so adding one
is deliberate. Retrieval sits behind a `DocumentRetriever` port; the semantic implementation is an
added adapter, not a rewrite.

**The citations are the answer.** Retrieval and citation need no model; only the narrative paragraph
does, and where none is configured the passages appear alone with the reason stated. A generated
answer may cite **only** what was retrieved: an index the generator did not receive fails the answer
rather than being dropped, because a dropped citation leaves the sentence standing and looking
sourced. Nothing generated is persisted.

**A document with personal data is refused, not redacted**, and hostile text inside a source
document grants nothing: the generator has no tools, no retrieval of its own and no write path.

**The Quality Gate's evidence gained a link without any finding being rewritten.** The document
reference resolves at read time through the assertion, so findings raised in Slice 5 acquired their
passage link the moment the excerpt was ingested. The Slice 5 CHECK is replaced by one that says a
citation must be whole and a claim must name what it claims.

`core.documents` and `quality.rag_assistant` move from ANNOUNCED to AVAILABLE. `ASSISTANT_GENERATOR`
follows the same no-default rule as `SOCIAL_CLASSIFIER`, decided by the one domain function both
now share (moved from `domain/social/` to `domain/ai/`).
