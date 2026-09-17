# ADR-033 — A locator is not always a page, and a scan is not a document with three words in it

- Status: Accepted
- Date: 17 September 2026
- Related: ADR-020 (no citation nobody can check), ADR-021 (retrieval is full-text), ADR-031
  (object storage and document upload), ADR-012 (long work is a job), IG4-001 (an unset provider is
  not a fake one), `docs/DOCUMENT_EXTRACTION.md`.
- Closes: TD-056, TD-094.

## Context

ADR-031 gave this product real files: a PDF or a DOCX reaches a bucket, is verified, and becomes a
`DocumentVersion` in `UPLOADED` with `PENDING_EXTRACTION` as its text source. Nothing reads it. The
corpus the Quality Gate and the assistant work on is still the pilot's hand-transcribed excerpts.

Reading the file is the last piece, and the question it forces is not *how do I get the text out* —
that is a library — but **what may a citation claim?** Slice 6 built the whole document layer around
one sentence: a citation names a version and a passage, and a reader can check it. ADR-020 refused
page numbers in quality evidence for precisely that reason, when no document had been ingested.

Three things had to be decided.

**What does a DOCX citation point at?** A PDF has printed pages. A DOCX does not: its pagination is
computed by whatever renders it — from the fonts installed, the paper size, the printer driver — so
two readers of the same file disagree about what is on page 7.

**What happens to a scanned PDF?** Eight studies arrive as folders of files, and some of those files
will be photographs of paper. A text extractor run over one returns a handful of characters.

**Where does this run?** A 90 MB study is minutes of work and megabytes of intermediate text.

## Decision

### 1. A chunk declares what its locator *is*

`locator_kind` is `PAGE` or `SECTION`. `page_from` and `page_to` become **nullable**; a `SECTION`
chunk carries `section_path` — the document's own heading trail, *6. Plan de Manejo › 6.2 Programa
de manejo de desechos* — and no page number at all.

A database CHECK refuses a row whose locator disagrees with itself: a `PAGE` without pages, or a
`SECTION` with them. That constraint, not a convention, is what stops a future extractor inventing a
page for a DOCX.

Numbering chunks 1, 2, 3 and calling those pages would have been easy and would have produced
citations that *look* verifiable. That is the fabrication this ADR exists to refuse.

### 2. A PDF chunk may span pages; a DOCX chunk may not span sections

A page number is a physical fact either way, so a chunk crossing a page boundary names *no* page —
Slice 6's existing rule, unchanged.

A heading trail is a different kind of claim: it says *what this passage is part of*. A passage that
began under 6.2 and ran into 7 is part of neither, and labelling it with whichever heading it
started under would send a reader to the wrong part of the document. So each section is chunked on
its own.

### 3. A scanned PDF is `REQUIRES_OCR`, and nothing is indexed

Two conditions, both of which must pass for a file to count as carrying native text: **enough
characters overall**, because a 90-page study with 40 characters in it is a scan with a header
stamp; and **enough pages carrying any text**, because a born-digital cover in front of 200 scanned
pages would pass a total-only test on the strength of its title.

`REQUIRES_OCR` is terminal and honest. The file stays available, the surface says why with the
numbers rather than a verdict, and **no chunk is written** — so a scan can never be cited.

**OCR itself is not built.** It means an external service or a large local model, a cost, and — for a
study containing personal data — a vendor the compliance gate of SECURITY.md §10a has not assessed.
Recorded as TD-098, not implied by the state's name.

### 4. It runs in the worker, and the queue is the table

`app.claim_document_extraction`, `FOR UPDATE SKIP LOCKED`, exactly as Slice 4 queued
classifications. No broker, no Redis, no second store that can disagree with the database about what
work exists. The claim returns four identifiers and no content; the worker then opens an ordinary
RLS transaction **as the uploader**, so it needs no `BYPASSRLS`, and a revoked membership makes the
job fail safely rather than read a file the person may no longer reach.

A claim older than fifteen minutes returns to the queue: one lost process must not strand a
document. An attempt counter bounds a crash loop.

**A worker with no usable storage never claims** — IG4-001's rule, one layer across. Claiming and
then failing at the first fetch would drain the queue and mark every document `FAILED` over a
missing environment variable.

### 5. `UPLOADED` and `QUEUED` are different states, and the difference is observable

`UPLOADED` means *the file is stored and nobody has asked for it to be read*. The upload action asks,
as a separate last step; a version whose enqueue failed sits in `UPLOADED` and a person can ask
again. Collapsing the two would leave a document that looks queued and is not.

### 6. Nothing is executed, and the archive is walked before it is expanded

`pdf.js` runs with `isEvalSupported: false`, no worker, no font fetched from a network. A DOCX's
macro project is never decompressed; only `word/document.xml` and `word/styles.xml` are.

`ARCHIVE_LIMITS` are checked against every entry's **declared** size as the central directory is
walked, before anything is expanded — which is where a zip bomb lies. The DOCX is therefore read by
hand rather than through a converter: a converter decides for itself what to decompress, and throws
away the heading trail, which is the only checkable locator the format has.

### 7. Extraction does not repair the document

A delivered study's own spellings, its broken tables and its missing sections survive. The rule Wave
C set for the management plan, for the same reason: those are findings to report, not defects to fix
on the way in.

## Consequences

- **TD-056 closes**: a real text source exists, and `TEXT_SOURCES` gains `PDF_TEXT` and `DOCX_TEXT`
  as things that actually happen rather than as anticipated values.
- **TD-094 closes**: a `READY` version's `content_hash` is the hash of its extracted text, and
  therefore differs from `file_sha256`. Until extraction ran the first held the second.
- Lexical search now runs over uploaded documents as well as transcribed excerpts, with no change to
  the retriever: a chunk is a chunk (ADR-021 stands, and retrieval is still full-text and still says
  so on screen).
- `renderCitation` gained a branch. A citation reads a page when there is one, a heading trail when
  the source has no pages, and neither when a passage spans two pages — in which case the passage
  number is what the reader checks.
- The pilot's transcribed corpus is untouched: every existing chunk keeps its page numbers and is
  `PAGE`, which is what it already claimed.

## Alternatives considered

**Number DOCX chunks and call them pages.** Rejected; it is the reason this ADR exists.

**Render the DOCX to PDF to get pages.** Rejected: the page numbers would be *our renderer's*, not
the document's, and a citation to page 7 would send a reader to a different page 7 than the one on
their screen. It also means shipping a rendering engine.

**Use a DOCX→HTML converter.** Rejected: it throws away the heading trail and decides for itself
what to decompress.

**Index a scan's few characters and mark the document "partial".** Rejected: a searchable document
that answers nothing is worse than a document that says it needs OCR.

**Run extraction in the upload request.** Rejected: long work is always a job (ARCHITECTURE §9.1),
and an upload that timed out on a large PDF would lose the file as well as the extraction.

**Re-extract a `READY` version in place.** Rejected: chunks are immutable, and a second set over the
same bytes makes every citation of the first ambiguous. A corrected file is a new version.
