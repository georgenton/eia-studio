# The pilot workspace, surface by surface: what is the study's and what is ours

> Related: `docs/DEMO_ZAMORA.md` (how a real project enters without shaping the core),
> `docs/REAL_DATA_INTAKE.md` (what the consultancy delivered and how it was read),
> ADR-023 (the real package decides the shape), ADR-024 (the management plan), ADR-025 (the
> product's language), `docs/PROVENANCE.md`, invariant 4.
>
> Written for whoever opens this workspace and has to know, screen by screen, which numbers they
> could put in a document and which they could not.

## 1. The one rule this document exists to keep

**Realistic experience, honest provenance.** The project is real:

> *Actualización de Estudios Socioambientales con lineamientos BID para el proyecto de asfaltado de
> la vía Puente del Amor – Los Hachos, cantón Yantzaza, provincia de Zamora Chinchipe* ·
> PROVIAL 2 · EC-L1289

Its cartography, its chainages, its management plan and its published aggregates are the
consultancy's own. The day-to-day operation of the study — visits, revisits, productivity, the
projected close, the coding queue — **never happened in this system**, and no amount of realism is
allowed to turn a reconstruction into history. Every figure carries the facets that say which it is,
and the badge on screen says it in words: *Dato histórico*, *Dato calculado*,
*Agregado sin datos personales*, *Simulación operativa*.

## 2. Screen by screen

| Surface | The study's own | Ours, and labelled | What a reader could quote |
|---|---|---|---|
| **Portfolio** | the project, its official title and programme reference | the portfolio's progress chips, which read simulated metrics | the title; not the progress |
| **Centro de control** | 7,4 km · 141 predios · 119 levantamientos · 185 participantes, all from the concluded study | visited/pending/productivity/forecast, and the activity feed | the four aggregates, each badged *Dato histórico* |
| **Cartografía y predios** | the centreline (7 361,3 m measured), 141 parcels with the codes the field sheet uses, 70 affected areas, four areas of influence, the chainage table | nothing on the map is ours; the *selection* and the derived areas are computed | the geometry, the areas, the chainages |
| **Ficha del predio** | code, side, chainage, area, affected share, the package's own status | the visit history, which belongs to the demonstration campaign | everything except the visits |
| **Trabajo de campo** | nothing | the current operation: 12 assignments spread along the corridor, 4 submitted responses, the questionnaire itself — plus any earlier operation, closed and labelled *Operativo anterior* | nothing; it is a simulation and says so |
| **Análisis social** | the tabulation *method* and the historical 119 as an aggregate | the answers being tabulated, the taxonomy, every coding | the historical aggregate; never the frequencies |
| **Control de calidad** | the assertions, read by hand from the study's own documents | the rule catalogue and the run | the disagreements it reports, as disagreements |
| **Documentos** | the passages, transcribed by hand from the study | the chunking and the retrieval | the passages, with their version |
| **Plan de Manejo** | all of it — 9 plans, 22 programmes, 86 measures, verbatim | the `measure_code` beside each row, which the surface says is ours | every cell of the matrix |
| **Informes** | the figures it quotes, each with its typed source | the chapter itself, marked BORRADOR | nothing until a person approves it, and nothing approves it here |

### 2.1 One operation is the current one

A project keeps the field operations that ran (ADR-026). Exactly one is *Operativo actual*: it is
what the Command Center's progress, the tabulation's denominator and a report snapshot count. Any
earlier one is *Operativo anterior*, closed and complete — every assignment, visit and submitted
response still there and still readable — and it takes no part in today's figures.

The pilot's persistent environment has one of each, and the reason is worth knowing: when the
demonstration campaign's parcels moved along the corridor, the operation that had already run was
closed rather than rewritten. Its twenty-two assignments and six responses are the record of what
that environment actually did.

## 3. The four things that are deliberately *not* repaired

The delivery disagrees with itself in places. None of it is corrected on import, because a product
that quietly fixes its source stops being able to tell anyone what the source said.

| What | Kept as | Why |
|---|---|---|
| `042a` beside `042A` | two parcels | the package contains both spellings; merging them would invent a decision |
| Reversed chainage ranges (`080A` runs 2 583 → 2 557) | as delivered, with no ordering constraint | saying two sources disagree is the Quality Gate's job, not the importer's |
| An affected area whose parcel code does not exist (`090`) | not imported, and counted in the import report | the row is real; the parcel is not |
| `FRENCUENCIA`, `RESPONSAB LE`, a plan with no code, a `N°` that repeats | exactly as written, and reported on the surface | they are findings about the document, not defects of the load |

## 4. What is missing, and what that means for the demonstration

| Not delivered | Consequence |
|---|---|
| The socioeconomic sheet (the editable instrument) | the questionnaire is **reconstructed**; its themes come from the corpus, its wording is ours |
| A coding taxonomy | the eight categories are **reconstructed** from what the demo questionnaire can produce |
| The individual survey records | the 119 stays an aggregate; there are no household records in this system, and none may be added before the compliance gate (SECURITY.md §10a) |
| A base map | none is drawn, and the legend does not claim one (TD-029) |
| The `CRONOGRAMA VALORADO` table | announced in the chapter and absent from it; the surface says so |

## 5. What personal data is in here

**None.** The parcels layer arrived with 18 attributes naming owners, deeds, purchase records,
surveyors and field notes, and the affectations layer with 19; every one was removed before the
file entered the repository, and the geometry was not touched (`docs/REAL_DATA_INTAKE.md`). The
management plan names institutions and roles — *Contratista*, *Fiscalización*, the GAD — and no
individuals. The demonstration questionnaire collects no names, identity numbers, phone numbers,
health data or household coordinates. The synthetic identities live on a reserved invalid domain.

The raw archive, the geodatabase and the Word file are **not** in this repository, have not been
uploaded anywhere, and have never been sent to a model.

## 6. How to walk it

`docs/manual/10-demo-walkthrough.md`, which is also a test: `e2e/mvp-journey.spec.ts` walks the same
path and asserts the seams between the surfaces.
