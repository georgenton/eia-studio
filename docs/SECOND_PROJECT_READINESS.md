# What happens when Carlos sends the next study

> An audit of how much of this implementation is genuinely reusable, and how much is about one road
> in Zamora Chinchipe. **No second project is invented here**, and nothing is abstracted in advance:
> the point is to know, before the next study arrives, which parts are ready, which need a profile,
> which need an importer, and which would have to be written.
>
> Related: ADR-003 (core + profile extension), ADR-023 (the real package decides the shape),
> ADR-024 (PGAS is a document), `docs/GIS_IMPORT_CONTRACT.md`, `docs/DEMO_ZAMORA.md`.

## 1. The four classifications

| | Meaning | What arriving with a new study costs |
|---|---|---|
| **GENERIC** | works for any project of any kind; no assumption about roads, Ecuador or this consultancy | nothing |
| **PROFILE-CONFIGURED** | works for any project whose profile enables it; the shape is generic, the choice is configuration | a profile decision, no code |
| **IMPORTER-SPECIFIC** | works for any project, but only against a file shaped the way the pilot's was | reading the delivery and writing or adapting a reader |
| **ZAMORA-SPECIFIC** | describes this project and nothing else | must not be reused; must not leak |

## 2. The audit

### GENERIC — nothing to do

| Component | Note |
|---|---|
| Tenancy, membership, roles, permissions, `RequestContext` | no project shape anywhere in it |
| Capability catalogue and resolution | the 14 keys are product-level; a profile decides which are on |
| RLS policies, composite FKs, the privileged helpers, the cross-tenant harness | table-shaped, not project-shaped |
| Provenance: four facets, records, derived badges | the vocabulary is the product's, not the study's |
| Documents: `SourceDocument` → `DocumentVersion` → `DocumentChunk`, full-text retrieval, citations | any corpus, any language with a Postgres text configuration |
| Social: taxonomy versioning, tabulation, classification runs, review, the AI ports and their gates | the taxonomy is data; the arithmetic knows nothing about roads |
| Quality Gate: the rule engine, findings, evidence locators, append-only specialist review | the *rules* are a separate question — see below |
| Reports: the snapshot model, typed sources, the grounding check, the .docx | sections are a `social_chapter` editorial decision, not a Zamora one |
| Field: campaigns, assignments, visits, versioned questionnaires, immutable answers | offline mode is configuration (ADR-018) |
| The shell, the 15 states, the Spanish vocabulary, the provenance drawer | ADR-025's rule is a boundary, not a translation of this study |
| `demo:doctor`, `demo:preflight` | they check *a* project against what a walkthrough shows; the thresholds are the fixture's, the checks are not |

### PROFILE-CONFIGURED — a decision, no code

| Component | The decision |
|---|---|
| `road_eia_social` profile | which capabilities a project of this family gets. A second road study reuses it verbatim |
| Territorial model `linear_corridor` | a corridor with chainage and sides. A quarry or a plant would need `site` or `zone` — declared in the type today, **not implemented**: the extension tables (`alignment`, `linear_reference`, `affectation`) exist only for the linear family |
| `project.crs`, `analysis_srid` per dataset | a projected code recorded per dataset, never a hardcoded zone (ADR-017). A study in another UTM zone needs no code |
| `field.surveys.offline_mode`, `require_gps`, `gps_max_distance_m` | per project |
| `gis.abscissa_tolerance_m`, `quality.document_gate.rule_set` | per project, from the profile |
| The questionnaire | a `SurveyTemplate` + published `SurveyVersion`, which is data. A different study writes a different one and never touches code |
| The coding taxonomy | a published `TaxonomyVersion`, immutable once published |

### IMPORTER-SPECIFIC — the real work of a second project

This is where the next study actually costs something, and it is worth being exact about why: the
product does not read *studies*, it reads **files somebody delivered**, and no two deliveries are
shaped alike (ADR-023).

| Component | What it assumes | What a new delivery needs |
|---|---|---|
| GIS import | GeoJSON in the fixture layout: an alignment, parcels with a code column, influence areas, affectations. The pilot's shapefiles were converted, and the owner attributes were removed **before** the file entered the repository | conversion, an attribute review, and a mapping from their column names to ours. `docs/GIS_IMPORT_CONTRACT.md` is the contract; the reader is not generic over arbitrary schemas |
| Chainage | `chainage.json`: one measure per parcel along the alignment, plus a side | either the same computation against the new alignment, or the consultancy's own abscissas |
| PGAS import | the delivered chapter's three levels, its six differently-named columns, its `FRENCUENCIA`, its `RESPONSAB LE`, its repeating `N°`. The header variants are a **list in code**, matched case- and space-insensitively | the next chapter will have *different* misspellings. The variant list grows; the parser does not change shape. This is the component most likely to need a code change, and the change is small and additive |
| Document ingestion | passages transcribed by hand, with a document code and version | the same, or a real PDF pipeline — which does not exist (TD-073's neighbourhood) |
| `pnpm db:seed:demo-project` | the pilot manifest's exact keys | a second project needs its own manifest; the seeder reads the manifest, not the study |

### ZAMORA-SPECIFIC — and confined to where it belongs

Checked rather than assumed. `zamora`, `yantzaza`, `hachos`, `puente del amor`, `provial`,
`EC-L1289` and `chinchipe` appear **nowhere** in `packages/domain`, `packages/ui`,
`packages/application/src`, `apps/web/app`, `apps/web/components` or `apps/web/lib`. The pilot's
figures (141, 119, 185, 7,4 km) appear in those trees **only inside comments** — five of them,
explaining why a limit or a generator exists. No code branches on them.

Where the project does live:

| Where | What |
|---|---|
| `fixtures/projects/zamora-puente-del-amor/` | the manifest, the GeoJSON, the chainage, the PGAS chapter |
| `fixtures/tenants/demo-consultancy/` | the synthetic identities and the tenant |
| `docs/DEMO_ZAMORA.md`, `docs/ZAMORA_WORKSPACE.md`, `docs/REAL_DATA_INTAKE.md` | what is real and what is simulated, screen by screen |
| the database | rows, which is where project data belongs |

**Nothing was refactored for this audit**, because nothing needed it: the rule that keeps the pilot
out of reusable code (CLAUDE.md rule 3) is holding, and the check above is cheap enough to repeat.

## 3. The Quality Gate's rules are the interesting middle case

The rule *engine* is generic; the seven rules are not obviously either. Each compares two sources
and says they disagree, and the sources it names — a report's parcel count against a cartographic
count, a plan's *lugar de aplicación* against the areas of influence — are the sources **a road EIA
with a management plan** has. A quarry study would keep `rule.numeric_cross_doc` and
`rule.document_completeness` and would have no use for `rule.geo_abscissa_tolerance`.

That is what `qualityRuleSet` on the profile is for, and it is why the catalogue is versioned code
rather than a table (ADR-020): a new family of study selects the rules that apply and, if it needs
a new one, that is a code change with a test, not a row somebody typed.

## 4. So: what happens when the next study arrives

Assuming a second **road** EIA of the same family, in Ecuador, delivered as files:

| Step | Cost |
|---|---|
| Create the tenant, project and memberships | minutes; the product does this |
| Choose the profile | none; `road_eia_social` v1 |
| Write the questionnaire and the taxonomy | data entry, no code |
| Read the delivery and decide what is real | **the actual work** — `docs/REAL_DATA_INTAKE.md` is the precedent, and it took a wave |
| Convert and import the cartography | hours to days, depending on how the file arrives and what has to be stripped from it |
| Import the management plan | likely a small additive change to the header-variant list |
| Everything else | already works |

Assuming a study that is **not** a linear corridor, add: the territorial extension for its family —
`site` and `zone` are named in the type and have no tables behind them. That is a slice, not a
configuration.

## 5. What this document is not

It is not a promise that the second project will be easy, and it is not permission to generalise in
advance. Two of the four classifications above only become certain when a second delivery exists —
the importer row especially, because the shape of a delivery is a fact about a consultancy's habits
and not about our schema. The right time to abstract the importer is when there are two, not when
there is one and an intention.
