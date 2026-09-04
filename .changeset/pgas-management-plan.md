---
"@eia/db": minor
"@eia/web": minor
---

The management plan the study proposes, read from the delivered chapter and shown in its own words.

Cap 11 of the Zamora study arrived as a Word document: nine plans, twenty-two programme groupings
and eighty-six measures in a nine-column matrix. It is now a model — `pgas_import_run` →
`pgas_plan` → `pgas_measure` (migrations 0027 and 0028) — and a surface at
`/t/:tenant/p/:project/pgas`, governed by `compliance.pma`, which moves from EXTENSION to AVAILABLE
with its meaning narrowed rather than a fifteenth key added (ADR-024).

**Nothing here records execution.** The road has not been built and nobody is carrying out these
measures, so there is no compliance state, no evidence upload and no tick box; an integration test
asserts over `information_schema` that no column could hold one. Following whether measures are
carried out remains `audit.environmental`, still an extension, and ADR-024 §7 records the seam.

**The document is stored as it was written.** `FRENCUENCIA`, `RESPONSAB LE`, six columns named more
than one way, a plan with no code, and a `N°` that repeats and skips all survive the import. The
importer maps the variant column names onto the nine concepts — that mapping is a fact about this
document family, declared and tested — and the surface reports the inconsistencies beside the plan
they belong to, quoting both spellings rather than saying the headings differ.

**One identifier is ours, and the screen says so.** The document has no stable measure reference, so
this product mints `PPMI-01.02.04` from the plan code, the programme and the row, deterministic
across re-imports. It is displayed beside the document's own number, with a footnote stating that
the consultancy would not recognise it.

An import is a version: idempotent by the file's SHA-256, and a revised chapter supersedes the
previous run instead of overwriting it, so a figure quoted from last month's plan stays explainable.
