# Real consultancy data: what came in, what did not, and why

> The record of how the study's own material entered EIA Studio. Read with ADR-023,
> `docs/GIS_IMPORT_CONTRACT.md`, `docs/PROVENANCE.md` and `docs/SECURITY.md` §10a.
>
> **No personal value appears in this document, in the repository, or in any environment.**

## 1. What was received

| Delivery | Size | SHA-256 | Received |
|---|---:|---|---|
| `Anexo 7. Cartografía.rar` | 1 756 754 494 B | `ef9cd4c8…205c1f` | 2 September 2026 |
| `PGAS EDITABLE-20260902T202416Z-1-001.zip` | 323 108 B | `7470faa9…7031ee` | 2 September 2026 |

The cartography archive holds 578 files (2,11 GiB uncompressed): an Esri File Geodatabase with 83
live feature classes, 66 printed map sheets, 65 ArcMap projects, 30 spreadsheets, a 194 MB ECW
orthophoto and an 890 MB video.

Both originals stay where the consultancy delivered them. Neither is copied into this repository,
uploaded anywhere, or sent to any model or external service.

## 2. How it was read

No GIS software is installed on the machine that did this — no `ogrinfo`, no QGIS, no Python GDAL.
Nothing was installed on it either. The geodatabase was read through GDAL 3.12 in a **workspace-local
virtualenv**, entirely outside the repository, and the archive was listed and extracted with
`bsdtar`, which is part of macOS.

The working area is `~/Projects-local/eia-studio-data-intake/`, outside Git:

```
raw-readonly/   references and hashes of the originals — never the originals themselves
extracted/      the geodatabase and spreadsheets, read-only
sanitized/      GeoJSON with every owner-bearing attribute removed
reports/        the inventory, the PII screen, the domain mapping, the decision
```

## 3. The privacy line, and where it is drawn

The parcel layers carry **identified personal data**: owner names, deed references,
compensation-agreement references, surveyor names, roles, photograph and survey-sheet references,
free-text field notes, and dwelling indicators. Full field-by-field screen, with counts and no
values, in `reports/pii-screen.md`.

The line is mechanical, not a promise to be careful:

| Control | Where |
|---|---|
| **Attribute allowlist, deny by default** | `_work/sanitize.py` in the intake workspace. 18 attributes dropped from `PREDIOS`, 19 from `AREAS_AFECTADAS` |
| A second forbidden list that overrides the allowlist | same file, so the two disagreeing fails closed |
| Verified after writing, not assumed | the emitted files carry exactly fourteen property keys, and a scan for person-shaped values returns zero |
| Nothing raw in Git | the fixture holds only the sanitized output |

**The compliance gate of `SECURITY.md` §10a stays closed.** Nothing in this intake depends on it,
and no owner-bearing attribute is in the product, in staging, or in any fixture.

## 4. What was imported

Sanitized to GeoJSON in EPSG:4326, from layers declared in EPSG:32717 and (for the influence areas)
EPSG:32718. Fixture files live in `fixtures/projects/zamora-puente-del-amor/gis/`.

| Layer | Source | Features | What it is |
|---|---|---:|---|
| alignment | `EJE_VIAL` | 1 | the surveyed centreline — **7 361,3 m** measured by PostGIS |
| parcels | `PREDIOS` | 141 | the fronting parcels, with the code the field sheet uses |
| affectations | `AREAS_AFECTADAS` | 71 delivered, **70 imported** | one code has no parcel; see §6 |
| chainage | `ABSCISA_PREDIO` | 282 rows | a start and an end abscissa per parcel, with the side |
| influence areas | `AID_FISICA_TOTAL`, `AII_FISICA_TOTAL`, `AISD`, `AISI` | 4 | 269 ha, 2 521 ha, 705 ha and 27 313 ha |

Provenance, on every one: regime **`HISTORICAL_OBSERVED`**, origin **`IMPORTED_DATASET`**,
transformations **`ORIGINAL` → `ANONYMIZED`** (the geometry is original; the attributes were removed),
granularity per layer. The record names the archive, its hash and the source layer, so a figure on
screen traces back to a file.

The map's legend says `IMPORTED STUDY LAYER · levantamiento predial del estudio · no es catastro
oficial` — not `OFFICIAL CADASTRE`. A layer whose attributes had to be stripped is a consultancy's
working survey; a registry does not hand out owner names (ADR-023).

## 5. What was deliberately left out

| | Why |
|---|---|
| Every owner-bearing attribute | `SECURITY.md` §10a; the gate is unopened |
| `VIA1F.ecw` — 194 MB, ~5 cm orthophoto | proprietary codec, needs a tiling pipeline and object storage the product does not have. If a base map is ever wanted, it is an external tile service referenced by URL |
| 66 PDF map sheets — 762 MB | printed output. A few could later be `SourceDocument` evidence; none is geodata |
| 65 `.mxd` — 316 MB | ArcMap-only; symbology, not geometry |
| One 890 MB MP4 | not cartography |
| Base and thematic layers (geopedology 8 561 features, ecosystems 7 067, rivers 6 967, cover) | valuable context, no consumer today, and large |
| `COORDENADAS_PREDIOS`, `COORDENADAS_AFECTACION_P` | duplicate the polygons as points and carry the full personal attribute set |

## 6. What the package says that disagrees with itself

Recorded, not repaired. An importer that tidied these away would be deciding, on the consultancy's
behalf, which of their own records is wrong.

| # | Disagreement | Handling |
|---|---|---|
| 1 | `042A` and `042a` are two spellings of one parcel; one carries the `INICIAL` abscissa and the other the `FINAL` | both kept; the parcel gets a start, the stray `FINAL` is reported as unmatched |
| 2 | Code `090` has an affectation polygon and chainage rows but **no parcel polygon** | the affectation is **not** imported and no parcel is invented — the study's universe is the 141 it published. The orphan is counted in the seeder's report |
| 3 | Code `091` has a parcel but **no chainage row** | its single reference point is derived from the geometry and recorded as `centroid_projection`, so it is distinguishable on screen from the 139 declared ones |
| 4 | `080A` runs 2 583 → 2 557 and `132a` runs 5 885 → 5 596 — an abscissa range that ends before it starts | stored as delivered. A CHECK enforcing order was written and then removed: it would have made the study's own cartography unstorable |
| 5 | `ESTADO` holds `COMPLETO` (119), `INCOMPLETO` (20) and `COMPLETA` (2) | the spelling variant maps like `COMPLETO`; the variant itself is a finding, not a fixture edit |
| 6 | `AFECTADO = SI` on 74 parcels, but only 70 have an affectation polygon that matches a parcel | both figures kept |
| 7 | Parcel `AREA` column totals 138 ha; PostGIS measures 550 ha from the same geometry | the product shows the **computed** area, because it is reproducible. The declared column is not stored (TD-069) |
| 8 | 60 layers declare EPSG:32717 and 23 declare EPSG:32718 | recorded per dataset version. Reprojected they land on the same ground — correctly georeferenced, expressed 416 km from that zone's central meridian |
| 9 | Chainage labels say `km` and hold metres (`0 + 153 km` is 153 m) | parsed as metres; the label's unit is wrong, the value is not |
| 10 | The parcel universe is 141 polygons, 148 rows in `LISTA DE PREDIOS`, 74 in `61_PREDIOS` | 141 imported — the figure the study published and the only one with geometry |

## 7. Identity: what happened to the synthetic parcels

The corridor generator produced 141 placeholder parcels with invented codes (`PRED-ZAM-001`…),
because the package had not arrived. It has now.

The import is a **supersede, not a rebuild** — the shape `GIS_IMPORT_CONTRACT.md` §1 described:

- each dataset gains a new `SpatialDatasetVersion` with `origin = imported`, and the synthetic
  version stays, inactive, named by `supersedes_version_id`;
- each placeholder parcel **keeps its UUID** and takes the incoming code. Every field assignment,
  visit, response, coding and specialist decision still points at the parcel it always did;
- each old boundary is deactivated, never deleted, so a figure produced from it stays explainable.

Matching is by `parcel_code` first, as the contract requires. None of the invented codes matches a
real one, so a code-only import would have created 141 new parcels beside 141 orphans and doubled a
figure the study published. The manifest therefore declares `placeholderRemap:
"ordinal_along_corridor"`: an unmatched *placeholder* is renamed to the incoming code, in order
along the corridor. It is a one-time, declared transition — written down rather than inferred — and
it never reassigns a code the package knows.

**This makes the import runnable against persistent staging**, which is the practical test of the
design: nothing is deleted, so nothing that a reviewer already looked at disappears.

## 8. Real, simulated and reconstructed, side by side

| | Real | Simulated | Reconstructed |
|---|---|---|---|
| Project identity, title, programme reference | ✅ | | |
| Historical aggregates (7,4 km · 141 · 119 · 185 · 101 · 84) | ✅ | | |
| Road centreline, parcels, affectation, chainage, influence areas | ✅ | | |
| Document corpus excerpts | | | ✅ hand transcriptions |
| Quality Gate findings | ✅ derived from the corpus | | |
| Field campaign: 12 assignments, 4 submitted responses | | ✅ | |
| Questionnaire and coding taxonomy | | | ✅ |
| AI codings | | ✅ deterministic, no model configured | |

A simulated survey response sits inside the real workspace without a banner over it. Its detail
says what it is — *simulación operativa* — and its provenance record says `DEMO_SIMULATION`. That is
the rule: realistic experience, honest provenance.
