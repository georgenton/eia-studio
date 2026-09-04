# ADR-024 — The PGAS is a document with a shape, not a compliance workflow

- Status: Accepted
- Date: 4 September 2026
- Related: ADR-003 (core + profile extension), ADR-005 (faceted provenance), ADR-008 / ADR-020
  (the Quality Gate never declares compliance), ADR-021 (documents), ADR-022 (the report snapshot).
- Amends: `docs/FEATURES.md` §2 — the `compliance.pma` catalogue entry.

## Context

The consultancy delivered *Cap 11 — Plan de Gestión Ambiental y Social* as a **Word document**, not
the workbook the brief anticipated. Read read-only (`docs/REAL_DATA_INTAKE.md`), it has a very
regular shape:

- **9 plans**, eight of which carry a code (`PPMI-01`, `PMD-01`, `PCCE-01`, `PRC-01`, `PC-01`,
  `PMA-01`, `PRAA-01`, `PCA-01`) and one — *Seguridad Industrial y Salud Ocupacional* — carries none;
- **22 programme groupings**, of which 2 are absent: in two plans the measures sit directly under
  the plan with no programme banner;
- **86 measures**, each a row in a nine-column matrix.

The nine columns, verbatim:

```
N° | ASPECTO AMBIENTAL | IMPACTO IDENTIFICADO | MEDIDAS PROPUESTAS | INDICADORES |
MEDIO DE VERIFICACIÓN | RESPONSABLE | FRENCUENCIA | PLAZO
```

`FRENCUENCIA` is spelled that way in eight of the nine tables. The ninth uses `No.`,
`IMPACTO AMBIENTAL`, `ACTIVIDAD PLANTEADA` and `INDICADOR` for the same concepts, and spells
`FRECUENCIA` correctly. A third variant exists where Word's formatting split `RESPONSABLE` into
`RESPONSAB LE` mid-word.

There is **no budget column, no per-measure location and no per-measure phase**. The chapter's last
heading, `CRONOGRAMA VALORADO DEL PLAN DE MANEJO AMBIENTAL Y SOCIAL`, is followed by a sentence
about the approximate nature of its figures and **no table**.

And there is **no stable measure identifier**. `N°` runs 1–68 across the chapter but skips 11–33,
repeats 1–9 and 37, and is blank twice.

## Decision

### 1. Three tables, because the document has three levels — and a programme is not an entity

`pgas_import_run` → `pgas_plan` → `pgas_measure`.

A **programme is a banner row**, not an object: it has a title and nothing else — no code, no
objective, no responsible party, no dates. Giving it a table would invent an entity the document
does not contain, and would make "a measure with no programme" — which happens twice — an
awkward null foreign key instead of a plain null. It is therefore `programme_title` and
`programme_ordinal` on the measure, and a read groups by them.

`PgasIndicator` and `PgasVerificationRequirement` are **not** tables either. In this document an
indicator is one cell of text and a means of verification is another. Promoting a cell to an entity
because the domain vocabulary has a word for it is how a model stops describing its source.

### 2. The columns are stored as the document states them, and normalised on read

Nine text columns per measure, plus the stated `N°` **as text**, because it is not a number this
product can rely on. The ninth plan's different column names are mapped to the same fields by the
importer — that mapping is a fact about this workbook family and lives in the importer, declared
and tested, not in the schema.

### 3. This product mints the measure identifier the document lacks

`measure_code` = plan code (or a slug of the plan title where there is none) + programme ordinal +
row ordinal — for example `PPMI-01.02.04`. It is **deterministic**: re-importing the same document
produces the same codes.

It is also **visibly ours**. The surface says so, because a reader must not mistake it for a
reference they can quote back to the consultancy. The document's own `N°` is displayed beside it,
unchanged, including where it repeats.

### 4. An import is a version, and re-importing the same file changes nothing

`pgas_import_run` records the source file name, its **SHA-256**, the import instant and the counts.
Re-running with the same hash is a no-op. A changed document creates a new run whose plans and
measures supersede the previous run's, which stay queryable — the same shape as a
`SpatialDatasetVersion` (ADR-023) and for the same reason: a figure quoted from the old plan must
remain explainable.

### 5. Completeness is shown on the surface; only genuine disagreements become Quality Gate findings

The temptation is to route every PGAS check through the Quality Gate. Most of them do not fit, and
the misfit is informative rather than inconvenient.

A `QualityFinding` **compares exactly two sources** — a deferred constraint trigger enforces one
`SOURCE_A` and one `SOURCE_B`, because "a finding never shows one side" (ADR-020). *A measure has
no indicator* has one side. Forcing it in would mean weakening the invariant that makes the Quality
Gate trustworthy, to accommodate a check that is not a disagreement at all.

So:

| Check | Where it lives | Why |
|---|---|---|
| measure without an indicator / verification / responsible / frequency / deadline | **the PGAS surface**, as a completeness panel per plan | one source; it is an absence, not a disagreement |
| a plan with no code | the PGAS surface | one source |
| the same `N°` used by two measures | the PGAS surface | see below |
| two plans naming the same column differently | the PGAS surface | see below |
| a section announced with no content (`CRONOGRAMA VALORADO`) | the PGAS surface | the absence of a thing is not a second source |

The last two were drafted as Quality Gate rules and then **withdrawn**, which is worth recording
because the reasoning is the interesting part.

Both are technically two-sided: two measures wearing one number, two plans spelling one column
differently. But the Quality Gate's findings are all of one kind — *two sources of this study
disagree about a fact of the project*: 71 predios against 70, an institution from the wrong
jurisdiction, a consultation planned for one date and held on another. `FRENCUENCIA` beside
`FRECUENCIA` is a typographical inconsistency in one chapter, and the numbering restarting in some
plans is a formatting convention. Routing them through the Gate would produce sixteen findings
about spelling beside four about the study, and the four would be harder to see.

The surface reports both, in the place where they mean something and beside the plan they belong
to. What the Quality Gate should eventually gain from this material is the genuinely cross-document
check: a plan whose *lugar de aplicación* names an influence area the cartography does not contain.
That compares the plan against the map — two sources, one fact — and it is recorded as TD-072
rather than built while it would be silent.

Neither the surface nor the findings say the plan is deficient, non-compliant or wrong. They say
what is present and what is not, in the document's own words.

### 6. The capability is `compliance.pma`, and its meaning is narrowed rather than a fifteenth key

The catalogue holds exactly fourteen keys and this decision does not add one. `compliance.pma` —
*Plan de Manejo Ambiental* — is the approved key for this material. It moves from `EXTENSION` to
`AVAILABLE`, and its description changes from *seguimiento del plan* to what is actually built:
**designing and checking the plan the study proposes**.

The audit lifecycle — obligations, evidence, periodic checks, findings against execution — is
**not** built and is not implied by this capability. That is `audit.environmental`, still an
extension, still hidden. §7 says why the two must stay apart.

### 7. Study stage and audit stage are different products

This PGAS is a *proposed* plan inside a study that has concluded. Nobody is executing it; the road
is not built. A product that rendered 86 measures as obligations with compliance states would be
asserting that a consultancy is auditing work that has not started — the same class of claim that
invariant 11 and ADR-022 exist to prevent.

The seam, for when the audit module is built:

```
study stage   PgasMeasure          document content — what the plan proposes
                   │  an explicit human act, in its own capability, with its own provenance
                   ▼
audit stage   ComplianceObligation  operational state — what is being done, and the evidence for it
```

One is a reading of a document. The other is a claim about the world. They share a lineage, not a
table.

## Consequences

- Three tables, each project-scoped with `tenant_id`, `project_id`, the composite FK, RLS
  `ENABLE` + `FORCE`, and cross-tenant coverage.
- The importer is **for this workbook family**, not for "any PGAS". It asserts the shape it expects
  — nine columns, a header row it recognises, 9 plans — and fails loudly rather than guessing.
- The document itself is also ingested as a `SourceDocument` (Slice 6), so a measure can be cited
  in a report and the chapter can be searched. The two representations do not compete: one is text
  a reader quotes, the other is structure a rule can count.
- `compliance.pma` becoming AVAILABLE gives the pilot profile a twelfth enabled capability.

## Alternatives rejected

**A generic spreadsheet/document importer.** The brief asked for an importer for *this* workbook
family, and the request is right: a generic importer for an unknown document shape either guesses
or demands configuration nobody can supply before seeing the file.

**A `PgasProgramme` table.** It would model a banner row as an entity, and make the two plans whose
measures have no programme carry a synthetic "default programme" that the document does not contain.

**Routing completeness through the Quality Gate.** It would require a one-sided finding, and the
two-source rule is the reason a finding can be trusted.

**A fifteenth capability key.** `compliance.pma` already names this material, and the catalogue's
size is a decision (D-014), not an accident.
