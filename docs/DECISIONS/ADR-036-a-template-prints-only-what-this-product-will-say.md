# ADR-036 — A template prints only what this product is willing to say, and never turns absence into a number

- Status: Accepted
- Date: 17 September 2026
- Related: ADR-022 (the snapshot is the deliverable), ADR-031 (object storage, namespaces, the
  verified upload), ADR-033 (reading an untrusted archive), ADR-029 (a stored value is never
  rendered; a label for it is), ADR-013 (reviewed SQL), CLAUDE.md rule 23 (a new dependency needs
  an ADR naming the slice requirement).
- Amends `docs/SECURITY.md` §7/§7a (two new storage namespaces) and `ARCHITECTURE.md` §9 (a new
  runtime dependency, and one `pnpm` override).

## Context

Eight studies will be delivered in the consultancy's own Word formats: their cover, their heading
hierarchy, their legal phrasing, their register. Regenerating those formats inside this product
would produce documents the firm did not write and would nonetheless have to sign. So the product
has to fill in **their** `.docx`.

That is a templating problem, and templating a Word file is not string substitution. Word splits a
run whenever anything about the text changes — a spell-check mark, a language tag, an edit somebody
made three years ago — so a file that reads `{{project.name}}` on screen usually holds `{{`, `pro`,
`ject.na`, `me}}` in four `<w:r>` elements. A regular expression sees none of it.

It is also a **trust** problem, in two directions that are easy to confuse:

1. the template is a file somebody outside this product wrote, so it is untrusted input;
2. the template decides what gets printed into a deliverable, so it is also a *question about what
   this product is willing to assert*.

## Decision

### 1. `easy-template-x`, after an audit, and not a code-evaluating engine

**Selected: `easy-template-x@7.2.8`, MIT.** Dependencies: `@xmldom/xmldom`, `json5`, `jszip`,
`lodash.get`. Requires Node ≥ 20; this repository runs Node 24.

Rejected:

- **`docx-templates`** — it evaluates JavaScript embedded in the template. A consultancy uploading
  their cover page would be uploading code this product runs. That is not a configuration to be
  careful with; it is the wrong shape.
- **A home-grown OOXML renderer** — run fragmentation, tables, repetition and formatting
  preservation are a parser problem, not a substitution problem, and go-live is in October.

### 2. What the audit checked, and what it found

Every item below was **verified against the installed package**, not read from a README.

| Question | Finding |
|---|---|
| Licence | MIT, in `LICENSE` and in the manifest |
| Maintained | latest 7.2.8, published within the month; the project is seven years old and still moving |
| Does it execute code from a template? | **No.** Zero occurrences of `eval(`, `new Function`, `vm.` or `child_process` in the distributed ESM bundle |
| Split-run placeholders | **Works.** `{{` `pro` `ject.na` `me}}` across five `<w:r>` elements substitutes correctly |
| A manifest of what a template contains | `parseTags` returns every tag with its disposition, **including** the plugin-prefixed forms (`@raw`, `%image`, `*link`) under their literal names |
| Repetition / tables | `LoopPlugin` repeats a container; verified over a two-element list |
| Configurable delimiters | Yes — fixed here to `{{` / `}}`, never read from the file |
| Configurable plugin set | Yes — replaced with **text and loop only**, so `{{@rawXml}}` renders nothing. Verified |
| Configurable data resolution | Yes — `scopeDataResolver` **replaces** the default `lodash.get` traversal entirely |

**One finding required action.** The package pins `@xmldom/xmldom@0.8.13`, which carries **ten open
advisories**, including two high-severity injection bypasses and several quadratic-time and
quadratic-memory parsing issues. The parser is what reads an uploaded template's `word/document.xml`
— untrusted input — so the DoS advisories are directly reachable. `0.8.15` is advisory-clean, so a
workspace-wide `pnpm.overrides` lifts it there. `pnpm audit` reports no `@xmldom/xmldom` finding
afterwards.

`fflate` was bumped from `0.8.2` to `0.8.3` in the same change: its `unzipSync` infinite-loop
advisory is reachable from exactly this kind of file, and this PR adds a second caller of it.

### 3. The template can do one thing, and four mechanisms hold it there

| Risk | Mechanism |
|---|---|
| Code in a template | no evaluation in the library; `.docm` refused by declared type; **`word/vbaProject.bin` refused inside the archive**, because a `.docm` renamed `.docx` presents the same `PK\x03\x04` signature |
| A container that is not a Word document | `word/document.xml` must be present — the magic bytes prove only that it is a ZIP |
| An archive that expands beyond a document | ADR-033's `ARCHIVE_LIMITS`, against **declared** sizes as the central directory is walked |
| Raw XML, images, charts or links from a template | the plugin list is replaced with text and loop |
| The template choosing what it reads | `closedVocabularyResolver` answers only from the registry; the data object handed to the library is **empty** |

### 4. A closed placeholder vocabulary, not object traversal

The obvious implementation hands the renderer a data object and lets a tag name be a path into it.
Then whatever is in that object is reachable, and the next person to add a field silently widens
what a template may print.

`PLACEHOLDERS` inverts it: a tag is a **key somebody declared**, with a declared type, a declared
source and a declared behaviour when the value is missing. What is *absent* from the list is
therefore checkable rather than intended — no personal data, no individual survey answer, **no AI
classification and no AI review candidate**, no open finding stated as settled, no storage key, no
internal UUID. A unit test asserts those absences against every key.

A tag that is not in the registry is not a placeholder; it is an error that **blocks activation**.
It is not ignored and not rendered blank, because a template silently printing nothing where its
author expected a figure is how a deliverable goes out with a hole in it.

### 5. Snapshot-first, one layer further out

ADR-022's rule was *the snapshot is the deliverable and the prose is a rendering of it*. A template
is another renderer, so:

```
validated data → deterministic binding → template → .docx
```

`buildTemplateBinding` is the only place values are assembled. **The renderer has no database
access, the template has no database access, and no model is anywhere on this path.** Every value is
a deterministic read: a project's own identity columns, a `metric_snapshot` somebody measured with
its provenance record, the management plan's own rows of the active import.

### 6. Absence is not zero

A project that has not measured its corridor has **no** corridor length.

- `BLOCKS` — a document that names this placeholder is **not generated** without it. A cover cannot
  say *Proyecto:* followed by nothing.
- `DECLARED` — the document is generated and the placeholder prints an explicit, localized *no
  value*: never `0`, never an empty space that reads as deliberate, and never a model's guess.

It is a property of the **placeholder**, declared in code. A template that could choose its own
tolerance would be choosing this product's honesty rule. Which placeholders printed *no value* is
**recorded on the generated document**, so a reader of the archive can tell a blank the project
genuinely had from one a later change created.

### 7. Every generated document says it is a draft

`generation.draft_banner` is a **required** placeholder: activation refuses a template without it,
and generation refuses a rendered document whose text does not contain it.

Two checks rather than one because they catch different failures — the first that the placeholder is
in the file, the second that it actually rendered. The banner's words are this product's
(`BORRADOR — NO ES UN ENTREGABLE APROBADO`, and the English equivalent), never the author's.

The alternative considered was **injecting a paragraph** into the author's `word/document.xml` after
rendering. Rejected: it puts this product in the business of laying out somebody else's deliverable,
and the author is the one who knows where a banner reads properly. A firm that hides the banner in
white 2pt text has defeated it — and would equally have deleted an injected paragraph. What is
guaranteed is that the product never produces a document without it.

### 8. Validation is a fact; activation is a decision

`UPLOADED` → `VALIDATED` → `ACTIVE` → `SUPERSEDED`.

Parsing tells you which placeholders a file carries. Deciding that client documents may be produced
from it is somebody putting their name to the format a client receives, so it is a separate act
behind `deliverables.approve` — and it **freezes** the version: a deliverable can name it from that
moment, and *which template produced this?* has to stay answerable. A corrected template is the next
version; activating it supersedes the previous one for that template and locale.

### 9. ES and EN are different versions, never a translation

A consultancy's Spanish deliverable carries their register and their legal phrasing. Machine
translating it would produce a document the firm did not write and would have to sign. The two
locales version **independently** (`v1` Spanish and `v1` English are unrelated files), and the
product renders the one asked for. This is ADR-029's rule — project source material is not
translated — applied to the format rather than to the content.

### 10. Namespaces are not mixed

`templates` holds a firm's own `.docx`; `generated` holds what this product produced from them.
Neither is `documents`, which is a delivered study. Three things with different formats, different
readers and different retention questions — and a generated draft must not be reachable by a query
written for the corpus.

`StoragePort` gains `put`, the first write that is not a client PUT: the bytes of a generated
document exist in this process and there is no client to hand them to. It is only ever called with
bytes this product rendered, and the `generated` namespace accepts no upload intent.

## Consequences

- Three new tables (`report_template`, `report_template_version`, `generated_document`), two
  migrations (0046 additive tables, 0047 grants/RLS/triggers), FORCE RLS and composite foreign keys
  on all three, **no `DELETE` grant on any of them**, and a trigger that refuses to change which
  file a version is.
- One new runtime dependency and one `pnpm` override, both audited above.
- Two new storage namespaces and one new port method.
- Synthetic templates in `@eia/testing` — a well-formed one, a macro-enabled one, and a ZIP that is
  not a Word document. **They are not any consultancy's templates**; no real delivered template has
  been received (TD-110).

## What this does not do

- **It is not a Word scripting language.** Seven registry keys' worth of values, one repetition
  construct, and a bounded tag count. There is no expression syntax, no conditional and no format
  specifier, and adding one would be adding a language a consultancy could write programs in.
- It does not produce a chapter. `generated_document` can point at a `ReportVersion` and record its
  snapshot digest, and the chapter generator of ADR-022 is unchanged; wiring a chapter's prose into
  a template is a later decision (TD-109).
- It does not approve anything. There is still no approval workflow (TD-060), which is exactly why
  the banner is mandatory.
