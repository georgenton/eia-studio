# Slice 6 — Document intelligence and the scoped assistant

> What was built on `feat/slice-6-document-intelligence`, what was deliberately left out, and every
> place the implementation departs from the approved architecture. Companion to
> `docs/SLICE_1_REPORT.md` … `docs/SLICE_5_REPORT.md`.

## 1. The journey this slice delivers

A coordinator opens Documents and sees the project's file: six excerpts of the concluded study, each
labelled as a hand transcription. They ask *predios con afectación*. Back come the passages that
contain those words — quoted verbatim, each naming its document, its **version**, its page and its
passage number — with a line saying there is no narrative paragraph because no model is configured
here, and a line saying the search is lexical rather than semantic.

They open **QG-001** in the Quality Gate. The evidence it was raised with now links to the passage
it was transcribed from. The finding was never rewritten.

## 2. The one thing this layer must not do

A citing assistant that cites wrongly is worse than no assistant: it lends the authority of a
reference to a sentence nobody checked. Three rules make that impossible rather than unlikely.

- **A citation names a version, and versions are immutable.** A corrected file is a new version with
  its own chunks; the old one keeps its words and its chunk ids. `document_chunk` refuses UPDATE and
  DELETE — grant *and* trigger — so text can never change under a citation. The cascade from its
  version is the one legitimate route, and `pg_trigger_depth() = 0` is what distinguishes it.
- **A generated answer may cite only what was retrieved.** The generator receives numbered passages
  and cites by index; an index it did not receive is a **failed** answer, never a dropped citation.
  Dropping one leaves the sentence standing and looking sourced.
- **The quote is the passage's own words.** Never a paraphrase, never generated. A citation whose
  quoted text was written by a model is precisely the artefact this layer exists to prevent.

## 3. Retrieval is full-text, and says so (ADR-021)

No embedding provider is configured anywhere (TD-049). The brief's three instructions —
build the abstraction with deterministic adapters, do **not** populate staging with fake embeddings,
and full-text may serve as a deterministic fallback if it adds value and stays simple — have exactly
one consistent resolution.

**One retrieval implementation ships**: a generated `tsvector` on `document_chunk` with the
`spanish` configuration and a GIN index, queried with `websearch_to_tsquery` and ranked by
`ts_rank_cd`. There is **no pgvector, no `vec` schema, no embedding column and no fake embedder** —
not built-and-empty, not built-with-a-stand-in: absent. A vector filled by a deterministic stand-in
is indistinguishable from one a model produced, which is the artefact IG4-001 exists to prevent, one
slice later and in a column. An isolation test asserts the column and the schema do not exist, so
adding pgvector later has to come past it deliberately.

Retrieval sits behind a `DocumentRetriever` port whose result carries a `strategy`, and the surface
prints what that strategy means in words: *the passages contain these words, not this meaning*. The
limit is visible rather than implied (TD-057).

## 4. The assistant separates finding evidence from writing prose

Retrieval, citation and the "no evidence found" outcome are complete with no model at all. Only the
narrative paragraph needs a generator, and where none is configured the surface shows the cited
passages and states which of the three IG4-001 reasons applies — governed by the *same* domain rule
as the Social classifier, extended to a second adapter rather than duplicated. That rule moved from
`domain/social/` to `domain/ai/` for the same reason: there must be exactly one of it.

`quality.rag_assistant` is nevertheless AVAILABLE. A capability is about whether the functionality
exists here, not about whether an external provider happens to answer; tying one to a credential
would make the rail flicker with somebody else's outage.

Nothing generated is persisted. An answer is a read — storing generated prose as project content
needs a provenance record marking it `DERIVED` with `validation_status = pending`
(AI_GOVERNANCE.md §8), and no surface in this slice would render such a record honestly (TD-059).

## 5. The corpus, and what it honestly is

Six short excerpts transcribed by hand from the concluded study's documents, in the project fixture.
The original PDFs are external source material and are **not** in this repository or in the system:
there is no file upload, no PDF parser and no OCR (TD-056). Every version is labelled
`RECONSTRUCTED_EXCERPT`, its provenance is `HISTORICAL_OBSERVED / IMPORTED_DOCUMENT /
RECONSTRUCTED`, and the surface repeats it beside every citation.

`document_version.imported_by_user_id` is **null** for these. Nobody performed that action, and
attributing it to a demo identity would put a name on something that person did not do.

A document flagged `contains_pii` is **refused, not redacted**: the deidentification pipeline that
would make its text safe to chunk and retrieve does not exist, and chunking it while hoping nobody
retrieves the wrong paragraph is not a control.

## 6. The Quality Gate's evidence gained a link, and no finding was rewritten

ADR-020 §6 promised that a Slice 5 finding would be *enriched* rather than revised when documents
arrived. It is, and the mechanism is the reason it holds: the document reference is resolved **at
read time**, through the assertion, by the finding's read model. Findings raised before ingestion
acquired their link the moment the excerpt was seeded, without a single row of those findings being
touched.

An assertion's link to a chunk is established by the words matching — the quote appears in exactly
one passage of that version — not by proximity. Where no single passage matches, the chunk link
stays null and the version link stands alone, and the screen says so.

Migration 0021 replaced the Slice 5 CHECK accordingly. The old one forbade a `DOCUMENT_VERSION`
source outright because none could exist; the new one says a citation must be **whole** (naming a
chunk requires naming its version) and a claim must **name what it claims** (`DOCUMENT_VERSION`
requires a version). It deliberately allows a `RECONSTRUCTED_CORPUS` assertion to name both:
acquiring a link does not turn a transcription into an extraction, and `source_kind` keeps saying
which it was.

## 7. What was built

| Layer | Files |
|---|---|
| Domain | `packages/domain/src/documents/{document,chunking,retrieval,assistant}.ts`; the shared availability rule moved to `packages/domain/src/ai/availability.ts` |
| Database | migration `0020` (3 tables + the assertion columns), `0021` (grants + REVOKE, RLS, immutability triggers, the generated `tsvector` and its GIN index, the replaced CHECK) |
| Application | `packages/application/src/documents/{ingest,retriever,assistant,generator,read-models}.ts` |
| Web | `app/t/[tenant]/p/[project]/documents/{page.tsx,[code]/page.tsx}`, `components/documents/*`, `lib/document-actions.ts` |
| Fixture | `fixtures/projects/…/manifest.json` → `documents.items` (6 excerpts, linked to the Quality Gate's assertions) |
| Capabilities | `core.documents` and `quality.rag_assistant` moved from ANNOUNCED to AVAILABLE |

## 8. Verification

| Suite | Result |
|---|---|
| Unit and domain | **265 passed** (+22) |
| Integration (Testcontainers, RLS) | **320 passed** (+35: 19 isolation, 16 application) |
| End to end (Playwright) | **130 passed** (+12), nothing skipped |
| Accessibility (axe) | 3 new document states, no serious or critical violations |
| Staging (non-destructive) | **81 passed** (+11); migrations 20 → 22; 6 documents, 9 passages and 6 provenance records added; **every pre-existing id identical**; the four Quality Gate findings and their decisions untouched; no dangling references |
| Lint, format, typecheck, build | clean |

**CI calls no model.** Retrieval needs no credential at all; the generator is a deterministic
in-process fake selected explicitly by the same no-default rule as the Social classifier.

## 9. Deviations

- **pgvector is not installed** — ADR-021, which amends ARCHITECTURE.md §5 and §9 and
  AI_GOVERNANCE.md §8. Recorded as an accepted decision rather than an undocumented departure.
- **Text ingestion only.** No upload, no PDF parser, no OCR (TD-056). The port's shape means a PDF
  adapter changes nothing downstream.
- **`imported_by_user_id` is nullable**, which the specification did not anticipate. A seeded version
  has no actor, and inventing one would be a small fiction in an audit-shaped field.
- **The availability rule moved packages** (`social/` → `ai/`) and gained a general form. No
  behaviour changed; the Slice 4 tests pass unmodified.
- **One Slice 5 test was updated**, not loosened: the CHECK it asserted was replaced by migration
  0021, and it now asserts the rule that supersedes it.

## 10. Debt this slice records

TD-056 (text ingestion only), TD-057 (retrieval is lexical), TD-058 (no conversation), TD-059 (an
answer is never stored — Slice 7 is the first place that could hold one honestly).
