---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/web": minor
---

The versioned template library: a template prints only what this product is willing to say, and
never turns absence into a number (ADR-036).

A consultancy uploads their own `.docx` — their cover, their annex — and the product fills in a
**closed list of placeholders** from validated project data. `ReportTemplate` is a name,
`ReportTemplateVersion` is a file, and `GeneratedDocument` is what came out.

**Why a library.** Word splits a run whenever anything about the text changes, so a file that reads
`{{project.name}}` on screen usually holds `{{`, `pro`, `ject.na`, `me}}` in four `<w:r>` elements.
A regular expression sees none of it. `easy-template-x@7.2.8` (MIT) is the parser, configured so it
can do **only** substitution: the plugin list is replaced with text and repetition — so `{{@rawXml}}`
reaches no handler — the delimiters are fixed in code, and the library's default `lodash.get`
traversal is **replaced** by a resolver that answers from the closed registry alone.
`docx-templates` was rejected because it evaluates JavaScript embedded in the template. The audit
also found that the package pins `@xmldom/xmldom@0.8.13`, which carries ten open advisories
including quadratic-time parsing reachable from an uploaded file, so a workspace `pnpm` override
lifts it to the advisory-clean `0.8.15`; `fflate` moves to `0.8.3` for its `unzipSync` advisory.

**A closed placeholder vocabulary, not object traversal.** A tag is a key somebody declared, with a
declared source and a declared behaviour when the value is missing. What is *absent* from the list
is therefore checkable rather than intended: no personal data, no individual answer, **no AI
classification and no AI review candidate**, no open finding stated as settled, no storage key, no
internal UUID. A tag nobody declared **blocks activation** — it is not ignored and not rendered
blank, because a template printing nothing where its author expected a figure is how a deliverable
goes out with a hole in it.

**Absence is not zero.** A corridor nobody has measured is not zero kilometres long. A placeholder
whose absence blocks stops the document; one that tolerates absence prints an explicit localized
*no value*, and which ones did is recorded on the generated document.

**Every generated document says it is a draft.** `generation.draft_banner` is a required
placeholder: activation refuses a template without it, and generation refuses a rendered document
whose text does not contain it. The banner's words are this product's, never the author's.

**Validation is a fact; activation is a decision.** Parsing says which placeholders a file carries;
deciding that client documents may be produced from it is `deliverables.approve`, and it freezes the
version — a deliverable can name it from that moment. **ES and EN version independently** and are
never machine translated into one another.

`.docx` only: `.doc` and `.docm` are refused by declared type, and a `.docm` renamed `.docx` is
refused **inside the archive**, because the macro project's presence is what makes a package
macro-enabled. A ZIP with no `word/document.xml` is refused too. ADR-033's `ARCHIVE_LIMITS` bound
what is read.

Snapshot-first, one layer out: validated data → deterministic binding → template → `.docx`. **The
renderer has no database access, the template has no database access, and no model is anywhere on
this path.**

Two new storage namespaces (`templates`, `generated`), kept apart from `documents`. `StoragePort`
gains `put` — the first write that is not a client PUT, because a generated document's bytes exist
in this process and there is no client to hand them to. Migrations 0046 (three tables) and 0047
(grants, FORCE RLS, immutability triggers), additive and forward only.
