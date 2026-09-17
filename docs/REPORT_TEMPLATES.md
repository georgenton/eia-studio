# The template library

> The map of the feature ADR-036 decides. Related: `docs/OBJECT_STORAGE.md` (namespaces and the
> verified upload), `docs/DOCUMENT_EXTRACTION.md` (the archive limits reused here),
> `docs/DECISIONS/ADR-022-*` (the snapshot is the deliverable).

## 1. What it is, in one sentence

A consultancy uploads their own `.docx` — their cover, their annex, their chapter — and this product
fills in a **closed list of placeholders** from validated project data, refusing anything it cannot
honestly print.

## 2. The shape of the path

```
a firm's .docx  → verified upload (templates namespace)
                → parsed: which placeholders does it carry?
                → unknown placeholder ⇒ cannot be activated
                → activated by somebody with deliverables.approve ⇒ frozen
validated data  → deterministic binding (no model, no database beyond this step)
                → renderer (no database access at all)
                → .docx in the generated namespace, immutable, recorded
```

## 3. The placeholder vocabulary

Thirteen keys today. Each declares **where its value comes from** and **what happens when there is
none**. The surface prints the whole table, so a template's author can see what they may use.

| Placeholder | When there is no value |
|---|---|
| `project.name` | the document is not generated |
| `project.official_title`, `project.locality`, `project.programme_reference` | prints *Dato no disponible* |
| `territory.corridor_length_km`, `territory.parcel_universe` | prints *Dato no disponible* |
| `social.surveys_complete`, `social.consultation_participants` | prints *Dato no disponible* |
| `pgas.plans`, `pgas.programmes`, `pgas.measures` | prints *Dato no disponible* |
| `generation.date`, `generation.locale` | the document is not generated |
| `generation.draft_banner` | the document is not generated — and a template without it cannot be activated |

**Never `0`.** A corridor nobody has measured is not zero kilometres long.

What is deliberately **not** in the list: personal data, an individual survey answer, an AI
classification, an AI review candidate, an open quality finding stated as settled, a storage key, an
internal UUID. A unit test asserts those absences over every key.

## 4. Why a library, and which

Word splits a run whenever anything about the text changes, so `{{project.name}}` normally lives in
several `<w:r>` elements. A regular expression cannot see it; walking the run tree is a parser.

`easy-template-x@7.2.8` (MIT) is that parser, configured so it can do only substitution: the plugin
list is replaced with text and loop, the delimiters are fixed here, and the data resolver is
replaced so a tag is a registry key or it is nothing. `docx-templates` was rejected because it
evaluates JavaScript from the template. The full audit, including the `@xmldom/xmldom` override, is
ADR-036 §2.

## 5. Formats and what is refused

`.docx` only. `.doc` and `.docm` are refused by their declared type before a URL is issued; a
`.docm` renamed `.docx` is refused **inside the archive**, because the macro project's presence is
what makes a package macro-enabled. A ZIP with no `word/document.xml` is refused as well — the magic
bytes prove only that it is a container. ADR-033's `ARCHIVE_LIMITS` bound what is read.

## 6. Versions, locales and activation

A template is a name; a version is a file. The same bytes twice are answered, not duplicated;
changed bytes are the next version. **ES and EN version independently** and are never machine
translated into one another.

`UPLOADED` → `VALIDATED` → `ACTIVE` → `SUPERSEDED`. Activation needs `deliverables.approve`, because
it is a decision about the format a client receives, and it freezes the version.

## 7. What a generated document records

The template version, the report version and snapshot digest when there is one, the locale, the
bytes' SHA-256, which placeholders printed *no value*, who generated it and when, and — when a model
ever writes prose into one — which model and which prompt version. Written once: regenerating
produces another row, because the figures may have moved and the previous document is what somebody
was handed.

## 8. Who may do what

| Act | Grant |
|---|---|
| read the library and the generated documents | `reports.write` |
| register a template, upload a version, re-read one, generate a document | `reports.write` |
| activate a version | `deliverables.approve` |

## 9. What is not built

- **No expression language.** No conditionals, no formatting specifiers, no arithmetic. A template
  is a document with values in it, not a program.
- **No chapter prose in a template.** A generated document can name a `ReportVersion` and its
  snapshot digest; wiring the chapter generator's prose through a template is a later decision
  (TD-109).
- **No real consultancy template has been received** (TD-110). Every template in the tests is
  synthetic and says so.
- **No approval.** There is no approval workflow in this product (TD-060), which is why the draft
  banner is mandatory.
