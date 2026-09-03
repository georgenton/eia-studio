# ADR-021 — Document retrieval is PostgreSQL full-text until embeddings can be real

- Status: Accepted (Slice 6)
- Date: 2026-09-03
- Amends: ARCHITECTURE.md §5 and §9 (the `vec` schema and pgvector for retrieval), AI_GOVERNANCE.md §8
- Related: ADR-005 (faceted provenance), ADR-019 (three layers of truth), ADR-020 (evidence is data),
  SECURITY.md §8 and §10c.1, TD-049

## Context

Slice 6 gives the product a document evidence layer and an assistant that answers from it with
citations. The architecture has always said retrieval would be pgvector in the same database, with
`vec.document_chunk_embedding` under the same RLS predicates. Building it exposed a sequencing
problem that is not about pgvector at all.

**There is no embedding provider.** `AI_GATEWAY_API_KEY` is configured in no environment (TD-049),
and IG4-001 settled what to do about that: an environment without a real provider does not get a
fake one, because a fabricated artefact is indistinguishable from a real one once it is a row.
An embedding is exactly such an artefact — a vector column populated by a deterministic stand-in
looks identical to one produced by a model, and every retrieval result computed from it would carry
the authority of "semantic search" while being a hash.

The slice brief anticipates this and gives three instructions that have to be read together:
build the retrieval abstraction with deterministic adapters if credentials are absent; **do not
populate persistent staging with fake embeddings masquerading as real ones**; and *"keyword /
PostgreSQL full-text retrieval may provide a deterministic fallback if it adds genuine value and
remains simple — do not build multiple retrieval stacks for elegance."*

Those constraints have exactly one consistent resolution.

## Decision

1. **One retrieval implementation ships: PostgreSQL full-text search.** A generated `tsvector`
   column on `document_chunk` with the `spanish` configuration and a GIN index; queries are
   `websearch_to_tsquery`, ranked with `ts_rank_cd`, and every result carries its own locator. It is
   deterministic, it needs no credential, it works on staging with the real corpus today, and its
   results are honestly describable: *these passages contain these words*.

2. **No pgvector, no `vec` schema, no embedding column, no fake embedder.** Not "built and left
   empty" and not "built with a stand-in adapter": absent. A vector column that exists and is either
   empty or filled with a hash is a promise the product cannot keep, and the second stack the brief
   forbids.

3. **Retrieval is a port** (`DocumentRetriever`), so the semantic implementation is an added adapter
   rather than a rewrite. The port's result type already carries a `score` and a `strategy` label, so
   a surface can say which retrieval answered and a future evaluation can compare the two. That is
   the whole extent of the accommodation: an interface and a label, not an unused subsystem.

4. **The assistant separates finding evidence from writing prose.** Retrieval, citation and the
   "no evidence found" outcome are complete and usable with no model at all. Only the narrative
   paragraph needs a generator, and where none is configured the surface says
   `BLOCKED_EXTERNAL_CONFIG` and shows the cited passages — which is most of the value and all of
   the traceability. The same availability rule as IG4-001 governs it, extended to a second adapter
   rather than duplicated.

5. **A citation names a version, not a document.** A chunk belongs to exactly one
   `DocumentVersion`; a new file is a new version with its own chunks, and an existing citation keeps
   resolving to the version it was made against. Re-chunking a version is impossible rather than
   discouraged: chunks are immutable once written, and the chunking strategy and its version are
   recorded on the version row.

## Consequences

- The assistant is genuinely useful today and does not pretend to be semantic. The surface says
  which strategy answered, in words, beside the results.
- Recall is lexical. A question phrased with different words than the document will miss, and that
  is the honest limit of what is shipped (TD-057).
- When an embedding provider is configured, the work is: a migration adding `vec` and the embedding
  column, an `Embedder` port implementation, a second `DocumentRetriever`, and a decision about
  whether to combine the two. Nothing shipped here has to be undone.
- `ARCHITECTURE.md` §5's schema list and §9's "Vector / RAG" row are amended: pgvector remains the
  intended semantic store and is not installed in this slice. SECURITY.md §8's isolation
  requirements are unchanged and already satisfied — the chunk table carries `tenant_id` and
  `project_id`, has FORCE RLS, and the retriever filters by both in addition.

## Alternatives rejected

- **pgvector with a deterministic fake embedder.** The exact artefact IG4-001 exists to prevent, one
  slice later and in a column instead of a table.
- **pgvector installed and left empty.** A retrieval path that silently returns nothing, plus a
  surface that has to explain why. All of the cost, none of the value.
- **Both stacks, hybrid-ranked.** Two retrieval systems, one of which cannot run, ranked together by
  weights nobody can tune without a provider.
- **Defer the whole slice until a credential exists.** The document layer, immutable versions,
  deterministic chunking, citation integrity and the Quality Gate's evidence lineage are all
  independent of embeddings, and every one of them is needed before report generation.
