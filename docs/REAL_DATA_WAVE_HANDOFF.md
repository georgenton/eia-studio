# Real data + productization wave — review handoff

> 4 September 2026. Six waves, five pull requests merged into `main`, no production deployment, the
> `production` branch untouched. Answers the twenty-one questions of the brief, in its order.
>
> Companion documents: `docs/REAL_DATA_INTAKE.md`, `docs/ZAMORA_WORKSPACE.md`, `docs/PGAS_MODEL.md`,
> `docs/PRODUCT_LANGUAGE_ES.md`, `docs/PERFORMANCE_BASELINE.md`,
> `docs/PRODUCT_VALUE_AND_DIRECTION.md`, `docs/DEVELOPMENT_WAVE_LOG.md`.

## 1 · Real files discovered

Two deliveries, both left where the consultancy put them and neither copied into this repository,
uploaded anywhere, or sent to a model.

| Delivery | Size | SHA-256 | Contents |
|---|---:|---|---|
| `Anexo 7. Cartografía.rar` | 1 756 754 494 B | `ef9cd4c8…205c1f` | 578 files, 2,11 GiB uncompressed: an Esri File Geodatabase with **83 live feature classes**, 66 printed map sheets, 65 ArcMap projects, 30 spreadsheets, a 194 MB ECW orthophoto, an 890 MB video |
| `PGAS EDITABLE-…zip` | 323 108 B | `7470faa9…7031ee` | *Cap 11 Plan de Gestión Ambiental y Social* — a **Word document**, not the workbook the brief anticipated |

Read without installing anything on the machine: GDAL 3.12 in a workspace-local virtualenv,
`bsdtar` for the archive, `zipfile` + `ElementTree` for the `.docx`. The working area is outside
Git (`~/Projects-local/eia-studio-data-intake/`).

## 2 · GIS inventory

83 live feature classes. Five layers were imported; the rest were inventoried and left where they
are, with the reason written down (`docs/REAL_DATA_INTAKE.md` §4–§5).

| Imported | Source layer | Features | What it is |
|---|---|---:|---|
| alignment | `EJE_VIAL` | 1 | the surveyed centreline — **7 361,3 m** measured by PostGIS against the ~7,4 km the study publishes |
| parcels | `PREDIOS` | 141 | fronting parcels with the code the field sheet uses |
| affectations | `AREAS_AFECTADAS` | 71 delivered, **70 imported** | one code has no parcel |
| chainage | `ABSCISA_PREDIO` | 282 rows | a start and an end abscissa per parcel, with the side |
| influence areas | `AID_FISICA_TOTAL`, `AII_FISICA_TOTAL`, `AISD`, `AISI` | 4 | 269 ha · 2 521 ha · 705 ha · 27 313 ha |

Ten internal disagreements were found and **recorded rather than repaired** — `042a` beside `042A`,
code `090` with an affectation and no parcel, two reversed abscissa ranges, `COMPLETA` beside
`COMPLETO`, a declared area column totalling 138 ha where PostGIS measures 550 ha, three different
parcel universes (141 / 148 / 74), and a chainage label that says `km` and holds metres. The full
table is `docs/REAL_DATA_INTAKE.md` §6.

## 3 · PII findings (no values)

The parcel layers carry **identified personal data**. Reported as fields, never as values:

- `PREDIOS`: **18 attributes** dropped — owner name, deed reference, purchase-agreement reference,
  surveyor name and role, photograph and field-sheet references, free-text field notes, dwelling
  indicators.
- `AREAS_AFECTADAS`: **19 attributes** dropped, of the same kinds.
- `COORDENADAS_PREDIOS` and `COORDENADAS_AFECTACION_P` duplicate the polygons as points **and carry
  the full personal attribute set** — not imported at all.
- The PGAS chapter names institutions and roles (*Contratista*, *Fiscalización*, the GAD) and **no
  individuals**.

The line is mechanical, not a promise: an attribute allowlist that denies by default, a second
forbidden list that overrides it so the two disagreeing fails closed, and a verification after
writing — the emitted files carry exactly fourteen property keys and a scan for person-shaped
values returns zero. **No personal value is in the repository, in any fixture, in staging, or in
this document.** The compliance gate of `SECURITY.md` §10a remains closed.

## 4 · Real GIS imported

All five layers above, sanitised to GeoJSON in EPSG:4326 from layers declared in EPSG:32717 (and
EPSG:32718 for the influence areas). Every one carries provenance `HISTORICAL_OBSERVED` /
`IMPORTED_DATASET` / `ORIGINAL → ANONYMIZED`, naming the archive, its hash and the source layer.

The import is a **supersede, not a rebuild** (ADR-023, `docs/REAL_DATA_INTAKE.md` §7): each
placeholder parcel keeps its UUID and takes the incoming code, so every field assignment, visit,
response, coding and specialist decision still points at the parcel it always did; each old boundary
is deactivated rather than deleted. That is what made it safe to run against persistent staging.

Three model changes the real package forced, each in ADR-023: geometry became **multi-part** (a plot
split by the road is two polygons), chainage became a **range**, and the influence areas became a
layer of their own.

## 5 · GIS datasets kept external

| Left out | Why |
|---|---|
| `VIA1F.ecw`, 194 MB, ~5 cm orthophoto | proprietary codec; needs a tiling pipeline and object storage the product does not have. A base map, if ever wanted, is an external tile service referenced by URL |
| 66 PDF map sheets (762 MB) | printed output; a few could later be document evidence, none is geodata |
| 65 ArcMap `.mxd` (316 MB) | symbology, not geometry |
| One 890 MB MP4 | not cartography |
| Geopedology (8 561), ecosystems (7 067), rivers (6 967), land cover | valuable context, no consumer today, and large |
| `COORDENADAS_PREDIOS`, `COORDENADAS_AFECTACION_P` | duplicate geometry **and** carry the full personal attribute set |

## 6 · PGAS structure, as delivered

A Word document with a very regular shape: **9 plans** (eight with a code, one without), **22
programme groupings** (two plans have none), **86 measures**, each a row of a nine-column matrix:

```
N° | ASPECTO AMBIENTAL | IMPACTO IDENTIFICADO | MEDIDAS PROPUESTAS | INDICADORES |
MEDIO DE VERIFICACIÓN | RESPONSABLE | FRENCUENCIA | PLAZO
```

Six of the nine columns are named more than one way across the plans (`FRENCUENCIA` in eight tables
and `FRECUENCIA` in the ninth; `N°` / `N °` / `No.`; `RESPONSABLE` split mid-word into
`RESPONSAB LE` by Word's formatting). `N°` runs 1–68, skips 11–33, repeats 1–9 and 37, and is blank
twice. There is **no budget column, no per-measure location and no per-measure phase**, and the
chapter's last heading — `CRONOGRAMA VALORADO` — is followed by a sentence and no table.

## 7 · PGAS model and import

Three tables, because the document has three levels: `pgas_import_run` → `pgas_plan` →
`pgas_measure` (migrations 0027, 0028; ADR-024; `docs/PGAS_MODEL.md`).

- **A programme is a banner row, not an entity** — a title and nothing else, so it is two columns on
  the measure rather than a table that would force the two plans without one to hold a synthetic
  programme.
- **Nine text columns, stored as the document writes them**; `N°` as text, because it repeats.
- **This product mints `measure_code`** (`PPMI-01.02.04`) because the document has no stable
  reference. It is deterministic across re-imports, shown *beside* the document's own number, and
  the footnote says the consultancy would not recognise it.
- **An import is a version**, idempotent by the file's SHA-256; a revision supersedes and the old
  rows stay queryable.
- **Nothing records execution** — no compliance state, no evidence, no obligation. An integration
  test asserts that over `information_schema`, so the absence survives a future migration.

`compliance.pma` moves EXTENSION → AVAILABLE with its meaning narrowed rather than a fifteenth
catalogue key added; the pilot profile now enables twelve capabilities and the rail has no
ANNOUNCED placeholder left.

## 8 · PGAS quality rules

**Four completeness checks and two inconsistency checks were drafted as Quality Gate rules and
withdrawn** (ADR-024 §5). A `QualityFinding` compares exactly two sources — a deferred constraint
trigger enforces one `SOURCE_A` and one `SOURCE_B` — and *a measure has no indicator* has one side.
Admitting it would weaken the invariant that makes a finding trustworthy.

The two that *are* two-sided — a repeated `N°`, a column spelled two ways — were withdrawn for a
different reason: the Gate's findings are all of one kind, *two sources of this study disagree about
a fact of the project*, and routing typography through it would produce sixteen findings about
spelling beside four about the study. They are reported on the PGAS surface instead, beside the plan
they belong to, quoting both spellings.

The genuinely cross-document check this material supports — a plan whose *lugar de aplicación* names
an influence area the cartography does not contain — is **TD-072**, deferred because against the
delivered data it would be silent: the AID exists, so the rule would ship without anyone having seen
it fire.

## 9 · Spanish UI changes

ADR-025, `docs/PRODUCT_LANGUAGE_ES.md`. The rule is a boundary rather than a translation pass:
**a stored value is never rendered; a label for it is.**

| Where | Now reads |
|---|---|
| Rail | Centro de control · Cartografía y predios · Trabajo de campo · Análisis social · Control de calidad · Documentos · Plan de Manejo · Informes |
| Provenance drawer | ORIGEN DEL DATO · Validación humana, and the badge explained in one line where the eyebrow used to describe our own mechanism |
| SOURCE TYPE badges | Dato histórico · Dato calculado · Agregado sin datos personales · Simulación operativa |
| Map legend | Cartografía base real · Eje vial del estudio · Capa del estudio · Área delimitada por el estudio · … |
| Panel badge | Simulación operativa, in place of a solid **DEMO** stamp |

Keys, capability names, URL segments, enum values and the database keep their English names, and the
consultancy's own words are still quoted verbatim, `FRENCUENCIA` included.

## 10 · English and internal terms removed

`DATA PROVENANCE` · `SOURCE TYPE` · `Human validation` · `ETIQUETA DERIVADA DE LAS FACETAS` ·
`REAL_AGGREGATE` · `RECONSTRUCTED` · `ANONYMIZED` · `SYNTHETIC` · `DEMO` / `DEMO / SYNTHETIC` ·
`REAL BASE MAP` · `RECONSTRUCTED ALIGNMENT` · `SYNTHETIC PARCELS` · `OFFICIAL IMPORTED ALIGNMENT` ·
`OFFICIAL CADASTRE` · `FIELD CAPTURED` · `IMPORTED STUDY LAYER` · `STUDY DELIMITED AREA` ·
`Command Center` · `Field Surveys` · `Social Intelligence` · `Quality Gate` · `FieldFlow` ·
`Parcel Explorer` · `Operational forecast` — including three in the demo fixture's own copy, which
is product copy because it writes the words a reviewer reads.

**`e2e/vocabulary.spec.ts` (12 tests)** reads the rendered text of all ten surfaces, the rail and the
drawer, and fails on any `SCREAMING_SNAKE_CASE` on screen or any term from that list. Codes a reader
wants — `PPMI-01`, `QG-001`, `DOC-002 v1`, `EPSG:32717`, `0+000`, `042a` — carry no underscore and
are not in the denylist.

## 11 · Zamora presentation changes

- The Command Center **names the study** as its terms of reference do — *Actualización de Estudios
  Socioambientales con lineamientos BID … Puente del Amor – Los Hachos, cantón Yantzaza, provincia
  de Zamora Chinchipe* — with `PROVIAL 2 · EC-L1289` beside it. Both columns existed since Wave B
  and nothing showed them.
- The map draws the study's **own** centreline and parcels, and the legend says which they are:
  *levantamiento predial del estudio · no es catastro oficial*.
- The demonstration campaign is **spread along the corridor** (abscissa 0 → 6 035 m of a 7 361 m
  alignment) instead of clustering in its first few hundred metres (TD-071).
- The management plan surface shows the study's own chapter, in its own words.
- The giant **DEMO** stamp is gone; a simulated panel says *Simulación operativa*.

## 12 · Provenance UX

The four facets are unchanged and still stored; what changed is what a reader is told.

- The badge is **derived at render time** from the facets (invariant 13) and now speaks Spanish.
- Beside it, one line saying what it means *here*: «Cifra verificable del expediente, sin datos
  identificables» rather than «ETIQUETA DERIVADA DE LAS FACETAS». Somebody opens that drawer to
  decide whether a figure may go into a document submitted to an authority; the line answers that
  question rather than describing our implementation.
- The drawer is headed **ORIGEN DEL DATO** and its validation field is **Validación humana**.
- Marking stays honest and stops shouting: invariant 4 requires a simulated figure to be
  distinguishable, and a badge on every panel that nobody reads twice had stopped distinguishing
  anything.
- The scrolling body of the drawer is now reachable by keyboard (axe `scrollable-region-focusable`).

## 13 · Real vs simulated data map

`docs/ZAMORA_WORKSPACE.md` holds the surface-by-surface version. In summary:

| Real (the study's own) | Reconstructed | Simulated |
|---|---|---|
| project identity, official title, programme reference | document corpus excerpts (hand transcriptions) | the field campaign: assignments, visits, submitted responses |
| the published aggregates: 7,4 km · 141 predios · 119 levantamientos · 185 participantes | the demonstration questionnaire | the operational metrics and the forecast |
| centreline, parcels, affectations, influence areas, chainages | the coding taxonomy | AI codings (deterministic; no model configured) |
| the management plan: 9 plans, 22 programmes, 86 measures | | the activity feed |
| the Quality Gate's assertions, read by hand from the study's documents | | |

## 14 · Request-context performance, before and after

TD-064, closed. Four transactions became one: reconcile the user row, prove the tenant with
`app.tenant_id` **unset**, adopt the proven tenant, then read the project, its memberships and the
capability rows under it, with `app.project_id` left unset. `SET LOCAL` expresses inside one
transaction the ordering the four expressed structurally; what disappears is the framing, not a
boundary. The merged envelope has its own eight-test suite, written before the merge.

One deliberate behaviour change: a **denied** resolution no longer leaves an `app.user` row behind,
because the reconciliation rolls back with everything else.

## 15 · Database round trips, before and after

Same machine, same seeded project, same driver, 6 warm-ups and 10 samples per route.

| Route | Context round trips | Total round trips | Median ms |
|---|---|---|---|
| Portfolio | 14 → **9** | 37 → **24** | 37,8 → **25,1** |
| Command Center | 17 → **12** | 62 → **49** | 128,1 → **116,1** |
| GIS | 17 → **12** | 49 → **36** | 116,1 → **115,3** |
| Field Surveys | 17 → **12** | 50 → **37** | 40,3 → **39,2** |
| Social | 17 → **12** | 93 → **80** | 175,8 → **161,4** |
| Quality Gate | 17 → **12** | 46 → **33** | 32,5 → **27,5** |
| Documents | 17 → **12** | 44 → **31** | 34,2 → **28,9** |
| Reports | 17 → **12** | 44 → **31** | 33,7 → **26,3** |

Five of the thirteen are framing that no longer exists; the other eight are two reads that no longer
happen at all — the user row was reconciled twice per render, and the shell re-read capability rows
the authorization path had just read. Wall clock barely moves locally, where the database is a
container; the count is what geography multiplies.

## 16 · Region recommendation

**Unchanged, and still the owner's decision.** The functions are in `iad1` and the database in
`us-west2`; a round trip between them is on the order of 60–70 ms rather than 0,3 ms. That figure is
a **projection, not a measurement**: the Preview answers 302 before a request reaches the
application, and signing in to measure it needs the owner's credential
(`docs/PERFORMANCE_BASELINE.md` §7).

The recommendation is the one the baseline made and this wave acted on: **fix the count before
spending geography on it**, because a page that needs seventeen round trips to know who you are is
slow in every region. The count is now twelve. Thirteen fewer sequential exchanges is on the order
of eight tenths of a second per page on that path — which makes the region question smaller, not
answered. A database region migration remains a hard stop.

## 17 · Test counts

| Suite | Count | Note |
|---|---|---|
| unit / domain | **300** | +14 (PGAS) |
| integration (Testcontainers, RLS, cross-tenant) | **386** | +14 PGAS isolation, +8 context envelope |
| Playwright e2e | **168** | +5 PGAS surface, +12 vocabulary, +1 the study's title |
| staging verification | **88 of 90** | the two failures are one fact; see §20 |

Lint, typecheck, format and build pass on every merge; CI was green on all five pull requests.

## 18 · Merge SHAs

| Wave | PR | Merge SHA |
|---|---|---|
| B — the study's real cartography | [#14](https://github.com/georgenton/eia-studio/pull/14) | `0257779` |
| C — the management plan | [#15](https://github.com/georgenton/eia-studio/pull/15) | `1665548` |
| D — the product's language | [#16](https://github.com/georgenton/eia-studio/pull/16) | `7a51be9` |
| E — one transaction to know who is asking | [#17](https://github.com/georgenton/eia-studio/pull/17) | `f957e5c` |
| F — the workspace as the real project | [#18](https://github.com/georgenton/eia-studio/pull/18) | `ac574d5` |
| F follow-up — a re-seeded campaign keeps its size | [#19](https://github.com/georgenton/eia-studio/pull/19) | `956406a` |

Wave A produced the intake reports outside the repository and `docs/REAL_DATA_INTAKE.md`, merged
with Wave B.

## 19 · Preview

**https://eia-studio-web-git-main-georgentons-projects.vercel.app** — tracks `main`, redeployed on
every merge. Vercel reported a completed deployment for every pull request in this wave.

Staging's database was migrated to **0028** and re-seeded from `main`: the PGAS chapter is there
(9 plans, 86 measures) and `compliance.pma` is entitled, so `/pgas` is reachable on the Preview. The
baseline captured before and after that seed shows **additions only** — two migrations, one
provenance record, and the campaign rows described in §20. Nothing was removed and no id changed.

## 20 · Limitations

1. **Staging's demo campaign is larger than the fixture declares: 22 assignments and 6 submitted
   responses instead of 12 and 4.** Re-seeding fills gaps and never re-does work, so when the target
   parcels moved along the corridor the ten new ones were added *beside* the twelve already there.
   `pnpm test:staging` reports exactly this, twice, and those are the two failures in §17. The
   seeder can no longer do it (#19), but the rows are already there and two of them carry visits and
   submitted responses, which are immutable by design. **Removing the extras is a delete against
   persistent staging and therefore needs your say-so**; the alternative is to leave staging as it
   is and accept a campaign that covers 22 parcels.
2. **The region figure is a projection, not a measurement** (§16).
3. **No model provider is configured anywhere** (`LIVE_AI = BLOCKED_EXTERNAL_CONFIG`, TD-049).
   Assisted coding and report prose report their unavailability rather than substituting a fake.
4. **The study's own socioeconomic sheet and coding taxonomy were never delivered**, so the
   questionnaire and the eight categories are reconstructed and labelled as such. The 119 surveys
   stay a historical aggregate; there are no household records in this system.
5. **No base map.** The orthophoto is 194 MB of a proprietary codec and needs a tiling pipeline the
   product does not have (TD-029).
6. **The four influence areas are stored and legended but not drawn** (TD-070), and the AISI polygon
   is 570 KB of GeoJSON for one feature.
7. **The declared parcel area column is not stored**, so the product cannot report that it disagrees
   with the measured one — 138 ha against 550 ha (TD-069).
8. **The PGAS is not cross-checked against the cartography** (TD-072), because against the delivered
   data the check would be silent.
9. **The compliance gate is closed** (`SECURITY.md` §10a): no real personal data, in any environment.
10. **The technician e2e specs still consume a pending assignment per run** (TD-068); a local
    `pnpm db:reset:local` is the workaround.

## 21 · What is ready to show the consultancy

A workspace for **their** study, in their language, that can be walked end to end in about fifteen
minutes (`docs/manual/10-demo-walkthrough.md`, which is also `e2e/mvp-journey.spec.ts`):

- their corridor and their 141 parcels on the map, measured rather than declared, with the legend
  saying it is their survey and not an official cadastre;
- their chainages, including the two ranges that run backwards, because the product shows what the
  file says;
- their management plan — nine plans, eighty-six measures — in their own words, with what the
  chapter leaves inconsistent reported beside it and no suggestion that anybody is executing it;
- the disagreements between two of their own documents, presented as disagreements, with neither
  side called the error;
- a social chapter draft in which every figure carries the source it came from, marked BORRADOR
  because nothing here approves a deliverable;
- and, on every figure, one line saying where it came from — with the simulated half of the
  workspace saying *Simulación operativa* rather than pretending to be history.

What to say plainly while showing it: the field work, the questionnaire, the taxonomy and the
codings are a demonstration; the cartography, the chapter, the aggregates and the inconsistencies
are theirs.
