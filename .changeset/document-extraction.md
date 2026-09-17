---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/worker": minor
"@eia/web": minor
"@eia/testing": minor
---

Document extraction: a locator is not always a page, and a scan is not a document with three words
in it (ADR-033). Closes TD-056 and TD-094.

An uploaded PDF or DOCX is read in the worker, chunked, and indexed for the lexical retrieval that
already existed. The queue is the `document_version` table claimed with `FOR UPDATE SKIP LOCKED`
through `app.claim_document_extraction` — four identifiers and no content — and the job runs under
the uploader's RLS, so the worker needs no `BYPASSRLS`.

**A chunk declares what its locator is.** `PAGE` for a PDF, whose pages a reader can turn to;
`SECTION` for a DOCX, which has no page model this product could know — its pagination is computed
by whatever renders it. `page_from`/`page_to` become nullable, a `section_path` carries the
document's own heading trail, and a database CHECK refuses a row whose locator disagrees with
itself. A DOCX chunk never spans two sections.

**A scanned PDF is `REQUIRES_OCR` and contributes no chunk**, so it can never be cited. Two
conditions decide — enough characters, and enough pages carrying any — because a born-digital cover
in front of 200 scanned pages would pass a total-only test. OCR is not built and is now TD-098.

Nothing is executed: `pdf.js` runs without eval, a worker or network fonts, and a DOCX's archive is
bounded against every entry's declared size *as the central directory is walked*, before anything is
expanded. Only `word/document.xml` and `word/styles.xml` are ever decompressed.

`UPLOADED` and `QUEUED` are different observable states; the upload asks for the read as a separate
last step, and a `FAILED` or `REQUIRES_OCR` version can be asked for again. A `READY` one cannot:
chunks are immutable, and a corrected file is a new version.

Migrations 0042 (locator columns, nullable pages, queue columns) and 0043 (the claim and release
functions, and the locator CHECK), additive and forward only. New dependencies: `pdfjs-dist` and
`fflate` in `@eia/application`.
