# 08 · Document assistant

`/t/…/p/…/documents`. The project's documents, and a way to ask them questions that answers with
the passage rather than with a paraphrase.

## What is on the page

**Consulta al expediente** — a question box. Ask it something, and it returns the passages of _this
project's_ documents that bear on it, each quoted verbatim with its document code, its **version**
and its page.

**Documentos del proyecto** — the corpus. Open one to read its passages in order.

## The one thing to understand about it

**The citations are the answer.** The paragraph above them, when there is one, is a reading of those
exact passages. Without a model configured there is no paragraph — and the assistant still works,
because finding and quoting the right three paragraphs of a study's file is most of what a
specialist needs.

On staging today there is no model configured, so every answer is passages with a line saying why
there is no narrative. That is the honest state, not a broken one.

## What "búsqueda léxica" means, and why it says so

Retrieval is PostgreSQL full-text search: **the passages contain the words you typed** (with Spanish
stemming, so _afectaciones_ finds _afectación_). It is not semantic. A question phrased with
different words than the document may find nothing even though the document says it.

The screen prints this under every answer. There is no embedding-based search, and there is
deliberately no fake one: a vector produced by a stand-in would be indistinguishable from a real one
and would let the product claim an understanding it does not have (ADR-021, TD-057).

## Citations name a version, always

`DOC-002 v1 · p. 1 · pasaje 2`. The version is part of the citation because a corrected file becomes
a **new version** with its own passages — the old one stays exactly as it was, so a citation made
last month still resolves to the words it cited. Opening a superseded version says so at the top.

A passage is never edited and never deleted while its version exists. The database refuses both.

## What it will not do

- **Answer from memory.** No passages, no answer: it says _no se encontraron pasajes_ and cites
  nothing.
- **Cite something it did not retrieve.** A generated answer that references a passage outside the
  retrieved set is refused outright, not quietly stripped of the reference — a stripped citation
  leaves the sentence standing and looking sourced.
- **Read another project.** Scope is applied before retrieval and again by the row-level policies.
- **Ingest a document with personal data.** A document flagged as containing identified personal
  data is **refused**, not redacted: the deidentification pipeline does not exist yet.
- **Take instructions from a document.** A source file can contain text addressed at a model. It is
  retrieved as ordinary content and grants nothing: the generator has no tools, no search of its
  own and no way to write.

## What the corpus is, today

Six short excerpts transcribed by hand from the concluded study's file, each labelled _Extracto
reconstruido del expediente_. The original PDFs are external source material and are not in this
system — there is no file upload and no PDF parser yet (TD-056).

Those excerpts are the same text the Quality Gate's findings were built from, so a finding's
evidence now links to the passage it was transcribed from (page 07).
