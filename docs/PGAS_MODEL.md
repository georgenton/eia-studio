# The management plan (PGAS)

> Related: ADR-024 (the PGAS is a document with a shape), ADR-005 (faceted provenance), ADR-020
> (the Quality Gate never declares compliance), ADR-021 (documents), `docs/REAL_DATA_INTAKE.md`.
> Implemented in `packages/domain/src/pgas`, `packages/application/src/pgas`,
> `packages/db/src/schema/pgas.ts`, migrations 0027–0028, and the `/pgas` surface.

## 1. What this module is, in one sentence

It reads the study's *Plan de Gestión Ambiental y Social* chapter and shows what the plan
**proposes**, in the document's own words, with the identifiers this product had to mint clearly
marked as ours.

It is not a compliance tracker. The road has not been built; nobody is executing these measures.
A screen that offered a tick box, or a column that could hold *cumplida*, would assert something
nobody has said — the same class of claim invariant 11 and ADR-022 exist to prevent.

## 2. What the delivered document looks like

Cap 11 arrived as a Word file, not the workbook the brief expected. Read read-only in the intake
workspace, its shape is regular:

| | |
|---|---|
| Plans | **9** — eight with a code (`PPMI-01`, `PMD-01`, `PCCE-01`, `PRC-01`, `PC-01`, `PMA-01`, `PRAA-01`, `PCA-01`), one without |
| Programmes | **22** banner rows; in two plans the measures sit directly under the plan |
| Measures | **86**, each a row of a nine-column matrix |
| Columns | `N° · ASPECTO AMBIENTAL · IMPACTO IDENTIFICADO · MEDIDAS PROPUESTAS · INDICADORES · MEDIO DE VERIFICACIÓN · RESPONSABLE · FRENCUENCIA · PLAZO` |
| Absent | no budget column, no per-measure location, no per-measure phase; the *cronograma valorado* is announced and has no table |

Six of the nine columns are named more than one way across the plans: `FRENCUENCIA` in eight tables
and `FRECUENCIA` in the ninth, `N°` / `N °` / `No.`, `IMPACTO IDENTIFICADO` / `IMPACTO AMBIENTAL`,
`MEDIDAS PROPUESTAS` / `ACTIVIDAD PLANTEADA`, `INDICADORES` / `INDICADOR`, and `RESPONSABLE` split
mid-word by Word's formatting into `RESPONSAB LE`.

`N°` runs 1–68 across the chapter, skips 11–33, repeats 1–9 and 37, and is blank twice.

None of that is repaired on import. The importer maps the *variant names* onto the nine concepts —
that mapping is a fact about this document family, declared and tested in code — and stores every
cell exactly as written.

## 3. The model

```
PgasImportRun ── one delivery of the chapter, identified by its SHA-256
     │
     └── PgasPlan ── one of the nine plans; `code` nullable, `column_headings` as this plan wrote them
              │
              └── PgasMeasure ── one row of the matrix: nine text columns + the document's `N°` + our code
```

Three tables, and the absences are decisions:

- **A programme is not an entity.** In this document it is a banner row with a title and nothing
  else — no code, no objective, no responsible party, no dates. It is `programme_title` and
  `programme_ordinal` on the measure, and the read groups by them. A table would have forced the
  two plans whose measures carry no programme to hold a synthetic one.
- **An indicator is not an entity either.** It is one cell of text, and a means of verification is
  another. Promoting a cell because the domain vocabulary has a word for it is how a model stops
  describing its source.
- **Nothing records execution.** There is no compliance state, no evidence table, no obligation.
  An integration test asserts it over `information_schema`, so the absence survives a future
  migration written in a hurry.

### 3.1 The identifier the document does not have

`measure_code` = plan code (or a slug of the plan title where there is none) · programme ordinal ·
row ordinal — `PPMI-01.02.04`, and `PSISO.01.12` for the plan with no code. It is deterministic, so
re-importing the same chapter produces the same codes and a link made last month still resolves.

It is **ours**, and the surface says so in as many words: the table shows *N° del documento* beside
*Código EIA Studio*, and the footnote states that the second is generated here and is not a
reference the consultancy would recognise. The document's own numbering is displayed unchanged,
repeats included.

### 3.2 An import is a version

`pgas_import_run` records the file name, its SHA-256, the import instant and the counts.

- Re-importing the **same** hash is a no-op: nothing is written, and the use-case says `unchanged`.
- A **different** document becomes a new run; the previous run steps down to `is_active = false`
  in the same transaction, and its plans and measures stay queryable, so a figure quoted from last
  month's plan is still explainable.
- A partial unique index (`pgas_import_run_one_active`) allows exactly one active run per project,
  so a half-finished import cannot leave two plans each claiming to be *the* plan.

Nothing here is append-only, and that is deliberate: a management plan is a document being
written, and a revision is a new delivery rather than a forbidden edit.

## 4. What the surface shows, and what it refuses to

| Shown | Not shown |
|---|---|
| The nine plans in document order, each with its objective and *lugar de aplicación* where stated | Any compliance or execution state |
| Every measure's nine cells, verbatim | A tidied-up or corrected version of a cell |
| Per-plan completeness: how many measures leave the indicator, verification, responsible, frequency or deadline blank | A judgement about whether the plan is adequate |
| Plans with no code, named | An invented code |
| Columns named more than one way, **both spellings quoted** | "the headings differ" |
| The import's provenance, one click away | A page number the document does not carry |

Today every one of the 86 measures fills all nine columns, so the completeness panel reads zero.
A panel that reports zero honestly is what makes the same panel believable when a revision does not.

The vocabulary of invariant 11 is asserted over **what this product writes** — the summary panel and
the footnote — and not over the chapter's sentences. A measure that mentions *incumplimiento* is the
study speaking; a heading that did would be us.

## 5. Why the completeness checks are not Quality Gate findings

A `QualityFinding` compares exactly two sources — a deferred constraint trigger enforces one
`SOURCE_A` and one `SOURCE_B`, because a finding never shows one side (ADR-020). *A measure has no
indicator* has one side. Admitting it would mean weakening the invariant that makes the Quality Gate
trustworthy in order to accommodate a check that is not a disagreement at all.

Two checks that **are** two-sided were drafted as rules and then withdrawn: the repeated `N°`, and
the columns spelled two ways. They are technically disagreements, but the Gate's findings are all of
one kind — *two sources of this study disagree about a fact of the project*: 71 predios against 70,
a consultation planned for one date and held on another. Routing typography through the Gate would
produce sixteen findings about spelling beside four about the study, and the four would be harder to
see. They are reported on the surface, beside the plan they belong to.

The genuinely cross-document check this material supports — a plan whose *lugar de aplicación* names
an influence area the cartography does not contain — is **TD-072**, deferred because against the
delivered data it would be silent: the AID exists, so the rule would ship without anyone having seen
it fire.

## 6. Authorization, isolation and provenance

| Concern | How |
|---|---|
| Capability | `compliance.pma`, narrowed by ADR-024 §6 to designing and checking the plan; `audit.environmental` (still hidden) keeps the execution lifecycle |
| Permission | `documents.read` — the plan is a chapter of the file, and whoever may read the file may read it |
| Route | `/t/:tenant/p/:project/pgas`, through the one surface-access policy: capability false → 404 (ADR-016) |
| Isolation | all three tables carry `tenant_id`, `project_id`, the composite FK to `project`, RLS `ENABLE` + `FORCE`, and the three-part predicate for `USING` and `WITH CHECK` alike |
| Provenance | the import run carries a `provenance_id`; the chapter is `HISTORICAL_OBSERVED` / `IMPORTED_DOCUMENT` / `ORIGINAL`, and the note states that the spelling, the heading variants and the repeated numbering were kept on purpose |
| PII | the measures name institutions and roles — *Contratista*, *Fiscalización*, the GAD — and no individuals; the screen that established that is in the intake workspace and is summarised in `docs/REAL_DATA_INTAKE.md` |

## 7. The seam with the audit module, for when it is built

```
study stage   PgasMeasure           document content — what the plan proposes
                   │  an explicit human act, in its own capability, with its own provenance
                   ▼
audit stage   ComplianceObligation  operational state — what is being done, and the evidence for it
```

One is a reading of a document. The other is a claim about the world. They share a lineage, not a
table.

## 8. Tests

| Level | File | What it holds |
|---|---|---|
| Domain | `packages/domain/test/pgas.test.ts` | the minted code is deterministic and collision-free; completeness counts absence without judging it; both spellings of a column are named; the schema refuses a shape this importer cannot honestly read |
| Integration / RLS | `packages/testing/test/rls/slice9-pgas.integration.test.ts` | tenant isolation on all three tables, forged ids refused on write, one active run per project, a superseded run stays queryable, the document's own shape (no code, repeated `N°`) survives storage, and no column can record compliance |
| e2e | `e2e/pgas.spec.ts` | the chapter renders with its counts, the copy says *propone* and never *cumplimiento*, the two identifier columns are distinguished, the inconsistencies are reported in the chapter's words, and the provenance opens |
