# The words this product uses

> Related: ADR-025 (the product speaks Spanish), PRODUCT.md §8 (language and locale), CLAUDE.md
> "Product language rules", invariants 4, 10, 11 and 13. Enforced by `e2e/vocabulary.spec.ts` and
> `tooling/scripts/check-forbidden-strings.mjs`.

The reader is an environmental consultant in Ecuador who has a study to deliver. Everything below
follows from that one fact.

## 1. The three rules

1. **A stored value is never rendered; a label for it is.** `DEMO_SIMULATION` is a database value.
   *Simulación operativa* is what a person reads. Every enum that reaches a screen goes through a
   label constant declared beside its type.
2. **Say what the datum is, not how the pipeline produced it.** A reader opening the provenance
   drawer is deciding whether they may quote a figure in a document that will be submitted to an
   authority. *Cifra verificable del expediente* answers that. *Etiqueta derivada de las facetas*
   answers a question about our implementation.
3. **Mark honestly, without shouting.** Invariant 4 requires that a simulated figure be
   distinguishable from a historical one. It does not require a black **DEMO** stamp on every
   panel: a badge nobody reads twice has stopped marking anything.

## 2. The vocabulary

### Surfaces (the rail)

| Key | On screen |
|---|---|
| `command-center` | Centro de control |
| `gis` | Cartografía y predios |
| `field` | Trabajo de campo |
| `social` | Análisis social |
| `quality` | Control de calidad |
| `documents` | Documentos |
| `pgas` | Plan de Manejo |
| `reports` | Informes |

### Where a figure comes from (the four SOURCE TYPE badges, invariant 13)

| Derived key | Badge | The line beside it |
|---|---|---|
| `REAL_AGGREGATE` | Dato histórico | Cifra verificable del expediente, sin datos identificables. |
| `RECONSTRUCTED` | Dato calculado | Valor derivado de fuentes reales con un método declarado. |
| `ANONYMIZED` | Agregado sin datos personales | Agregado de registros reales, sin identificadores. |
| `SYNTHETIC` | Simulación operativa | Generado para la demostración. No es historia del proyecto. |

The four keys, and the derivation that produces them, are unchanged. These are the words.

### Map layers

Cartografía base real · Eje reconstruido · Predios simulados · Eje vial del estudio · Catastro
oficial · Levantado en campo · Capa del estudio · Área delimitada por el estudio.

Each carries a one-line note saying what the layer actually is — *levantamiento predial del estudio
· no es catastro oficial* — because the difference between a consultancy's survey and an official
cadastre is the kind of thing a reader must not have to infer.

### The provenance drawer

`ORIGEN DEL DATO` as the header · Régimen · Origen · Transformaciones · Granularidad · Fuente /
dataset · Versión · Capturado / importado · Método · Calculado a partir de · Registrado en EIA
Studio · Validación humana.

## 3. What must never appear on a screen

| Forbidden | Because | Say instead |
|---|---|---|
| `SCREAMING_SNAKE_CASE` of any kind | it is a stored value that escaped | its label |
| Command Center · Field Surveys · Social Intelligence · Quality Gate · FieldFlow · Parcel Explorer | untranslated software to the reader | the rail names above |
| DATA PROVENANCE · SOURCE TYPE · Human validation | the same, in the one place a reader goes for the truth of a number | Origen del dato · Validación humana |
| **DEMO** as a standalone stamp | marks nothing once it is everywhere | Simulación operativa |
| «% de acierto» · «precisión del» · «probabilidad calibrada» | a model score is not a calibrated probability (invariant 10) | «model score 0,86 · confianza Alta» |
| «incumplimiento» · «infracción» · «error detectado» · «no conforme» · «el sistema determina» | this product never declares compliance (invariant 11) | «posible inconsistencia» · «información faltante» · «requiere revisión de especialista» |

The last two rows predate this document and are enforced by
`tooling/scripts/check-forbidden-strings.mjs`; the first four are enforced by
`e2e/vocabulary.spec.ts` over what a browser actually renders.

## 4. What is deliberately *not* translated

- **The consultancy's own words.** The PGAS chapter is displayed verbatim, `FRENCUENCIA` included.
  A study's text is evidence, not copy.
- **Identifiers a reader uses.** `PPMI-01`, `QG-001`, `DOC-002 v1`, `EPSG:32717`, `0+000`, parcel
  code `042a`.
- **`EIA Studio`.** It is the product's name.
- **The database, the keys, the capability names and the URLs.** Renaming those would be a
  migration wearing a translation's clothes.

## 5. When you add a surface

1. Write the label in `SURFACE_DEFINITIONS`, in Spanish.
2. Give every enum that reaches the screen a label constant beside its type, as
   `REGIME_LABEL` and `SOURCE_TYPE_LABEL` are.
3. Add the surface to `SURFACES` in `e2e/vocabulary.spec.ts`. The test is the reason this document
   will still be true in six months.
