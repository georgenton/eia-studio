# Document extraction

> Related: ADR-033 (this layer's decisions), ADR-031 (object storage), ADR-021 (retrieval is
> full-text), ADR-020 (no citation nobody can check), `docs/DOCUMENT_UPLOAD_AND_VERSIONING.md`.

## 1. What extraction is for

A citation. Everything else this layer does — reading a PDF's pages, walking a DOCX's paragraphs,
chunking, indexing — exists so that a specialist can be shown *the passage that says this* and can
open the file and check it.

That is why the interesting decisions here are all refusals.

## 2. The pipeline

```
UPLOADED ──asked──▶ QUEUED ──claimed──▶ PROCESSING ──▶ READY
                                                    ├─▶ REQUIRES_OCR
                                                    └─▶ FAILED
```

| State | Means |
|---|---|
| `UPLOADED` | the file is stored and **nobody has asked for it to be read**. A real state, not a formality: a version whose enqueue failed sits here and a person can ask again |
| `QUEUED` | waiting for a worker |
| `PROCESSING` | claimed. A claim older than 15 minutes returns to `QUEUED` — one lost process must not strand a document |
| `READY` | read and chunked; its passages can be cited |
| `REQUIRES_OCR` | **terminal and honest**: the PDF carries no meaningful native text |
| `FAILED` | the file could not be read: corrupt, encrypted, or beyond the limits |

`FAILED` and `REQUIRES_OCR` can be asked for again; `READY` cannot. Chunks are immutable, so a
second set over the same bytes would make a citation ambiguous — and a corrected file is a new
version, which is the whole point of versions.

**The queue is the `document_version` table**, claimed with `FOR UPDATE SKIP LOCKED` through
`app.claim_document_extraction`. No broker, no Redis, no second store that can disagree with the
database about what work exists — the shape Slice 4 established for classifications. Two workers
against one database never claim the same version.

The claim returns **four identifiers and no content**. The worker then opens an ordinary RLS
transaction *as the person who uploaded the file*, so it needs no `BYPASSRLS` and sees exactly what
they see. If their project access was revoked in between, that transaction sees nothing and the job
fails safely.

## 3. A locator is not always a page

| Kind | Produced by | What a citation reads |
|---|---|---|
| `PAGE` | PDF | `DOC-014 v1 · p. 37 · pasaje 2` |
| `SECTION` | DOCX | `DOC-014 v1 · 6. Plan de Manejo › 6.2 Programa de desechos · pasaje 2` |

**A DOCX has no page model this product could know.** Its pagination is computed by whatever renders
it — the fonts installed, the paper size, the printer driver — so two readers of one file disagree
about what is on page 7. Numbering chunks 1, 2, 3 and calling those pages would produce citations
that look verifiable and are not, which is exactly the fabrication ADR-020 refused when it kept page
numbers out of quality evidence.

So `page_from` and `page_to` are **nullable**, a chunk declares its `locator_kind`, and a database
CHECK refuses a row whose locator disagrees with itself — a `PAGE` with no pages, or a `SECTION`
with them. That constraint is what stops a future extractor inventing a page.

Two consequences worth stating:

- **A PDF chunk may span two pages**, and a citation of one then names *none* — the rule Slice 6
  already set. A page number is a physical fact either way.
- **A DOCX chunk never spans two sections.** A heading trail is a claim about *what this passage is
  part of*, and a passage that began under 6.2 and ran into 7 has no single place a reader could
  turn to. Each section is chunked on its own.

## 4. A scanned PDF is not a document with three words in it

Extracting a scan yields a handful of characters of header noise. Chunked and indexed, that becomes
a document that **appears searchable and answers nothing** — under a citation somebody would quote.

`REQUIRES_OCR` is the honest terminal state. Two conditions, and both must pass:

| | |
|---|---|
| enough characters overall | a 90-page study with 40 characters in it is a scan with a header stamp |
| enough **pages** carrying any text | a born-digital cover in front of 200 scanned pages would pass a total-only test on the strength of its title |

The thresholds are deliberately generous: this decides between *reading a document* and *telling a
person to OCR it*. Being wrong cautiously costs a re-run; being wrong the other way puts noise in
the corpus under a citation.

**OCR itself is not built** and is not implied. It means an external service or a large local model,
a cost, and — for a study containing personal data — a vendor the compliance gate has not assessed
(TD-098).

## 5. What is read, and what is never executed

| Format | Read with | Bounded by |
|---|---|---|
| PDF | `pdf.js` (Mozilla's, the one Firefox uses), legacy build, text only | 2 000 pages, 12 M characters |
| DOCX | the archive opened directly, `word/document.xml` and `word/styles.xml` | `ARCHIVE_LIMITS`, checked **while the archive is walked** |

**Nothing is executed.** `isEvalSupported: false`, no worker, no font fetched from a network, no
external resource resolved. A DOCX's macro project is not decompressed at all; only two entries
ever are.

The archive limits are checked against every entry's **declared** size as `fflate` walks the central
directory, before anything is expanded. That is where a zip bomb lies: a 40 KB archive whose
directory says one entry becomes a gigabyte.

The DOCX is read by hand rather than through a converter for two reasons: a converter throws away
the heading trail, which is the only checkable locator the format has, and a converter decides for
itself what to decompress.

## 6. What extraction never does

- **It does not repair the document.** A delivered study's own spellings, its broken tables and its
  missing sections survive — the rule Wave C set for the management plan, for the same reason: those
  are findings to report, not defects to fix on the way in.
- **It does not call a model.** Nothing in this path is AI. Retrieval remains PostgreSQL full-text
  and says so on screen (ADR-021).
- **It does not put a document's text in a log line.** The worker logs identifiers, a state and
  counts; a `processing_note` is bounded operational text a consultant reads, never a stack trace.

## 7. Two hashes, and when the second arrives

`content_hash` is the hash of the **extracted text** and `file_sha256` of the delivered bytes. Until
extraction runs the first holds the second, because the empty string's digest would be a value every
unprocessed version shared (ADR-031 §7). Extraction writes the real one, and a `READY` version's two
hashes therefore differ — which closes TD-094.

## 8. Running it

The worker starts the extraction consumer only when it has a database **and** a usable store. A
worker with no storage never claims: claiming and then failing at the first fetch would drain the
queue and mark every document `FAILED` over a missing environment variable (the rule IG4-001 set
for the classifier).

**The e2e suite does not exercise extraction end to end**, and the reason is the same topology
point: it runs the web application and no worker, over the in-memory store. What it does prove is
the half that belongs to a person — that an upload leaves the version `En cola` rather than
`Cargado`, which is the distinction `UPLOADED` and `QUEUED` exist to make. The pipeline itself is
proved by the integration suite, against real PDFs, a real database and real MinIO (TD-100).

One thing to know about topology: **the in-memory store is per process.** A web process that
accepted an upload into it holds bytes the worker cannot see, so `memory` is useful for a laptop
running both in one process and for tests, and is refused outside `local` and `test` anyway. In a
real deployment both processes point at the same bucket (TD-100).
