# Slice 2 — GIS / Parcel Explorer and Parcel Workspace

> What was built, what was deliberately left out, and where the implementation departs from the
> approved design bundle and why. Read with `design/reference/claude-design-v0.2/README.md`
> (contract), `docs/DEMO_ZAMORA.md` (what is real and what is a demo simulation) and
> `docs/GIS_IMPORT_CONTRACT.md` (how the synthetic layers get replaced).

## 1. The journey this slice delivers

```
Command Center → GIS / Parcel Explorer → map and table sharing one selection
               → Parcel Workspace → provenance of the parcel and of its layer
```

The GIS surface stops being a capability-guarded placeholder and becomes a real surface:
`SURFACE_DEFINITIONS.gis.implemented = true`. Everything on it is read through
`loadParcelExplorer` / `loadParcelWorkspace`, which check `gis.maps`, `gis.parcels` and
`parcels.read` against the verified `RequestContext` before a single geometry is read.

## 2. Surfaces

| Surface | Route | State |
|---|---|---|
| GIS / Parcel Explorer | `/t/[tenant]/p/[project]/gis` | Built: filters, map, table, contextual panel, layer-provenance legend. |
| Parcel Workspace | `/t/[tenant]/p/[project]/parcels/[parcelCode]` | Built: Resumen and Afectaciones. Visitas, Instrumentos, Media and Calidad render an inert "aún sin datos" state naming the module they wait on. |
| Command Center | `/t/[tenant]/p/[project]` | Gains the **territorial summary** panel (TD-023, GIS portion), counted from the active layers and carrying their provenance. |

Route access follows the one capability policy (ADR-016) unchanged: `gis.parcels` ineffective →
404, indistinguishable from a URL that means nothing. A parcel code is therefore not probeable:
`/parcels/PRED-…` in a project the caller cannot see answers 404, and so does an unknown code
(`NotFound` is mapped to `not-found` in `apps/web/lib/surface-access.ts`).

## 3. Data model

Six tables, all in `app`, all with `tenant_id`, `project_id`, the composite FK to `project`,
`ENABLE` + `FORCE` RLS and policies keyed on `app.has_project_access`: `spatial_dataset`,
`spatial_dataset_version`, `alignment`, `parcel`, `parcel_geometry`, `affectation`. Migrations
`0009` (tables, geometry columns, GiST indexes) and `0010` (constraints, grants, RLS).

Full shapes and every deviation from the earlier specification are in `docs/DATA_MODEL.md` §3.3.
The four decisions worth restating here:

1. **Geometry is stored canonically in `EPSG:4326`**; the projected CRS a dataset's metres are
   measured in is metadata on its version (`analysis_srid`), not a column type (ADR-017). Reads
   need no transform; every length and area transforms explicitly into the analysis CRS, so
   nothing computes an area in degrees.
2. **Identity survives geometry.** `Parcel.id` is the only technical identity; `parcel_code` is
   the cartographer's business identifier, unique per project. Replacing the synthetic layer
   creates new `ParcelGeometry` rows, never new parcels — asserted in the integration suite.
3. **One active version, one active geometry**, enforced by unique partial indexes rather than by
   a pointer column that can disagree with a flag.
4. **Nothing is deleted on replacement.** The superseded version stays queryable, so a figure
   produced from it stays explainable.

## 3a. Coordinate reference systems (ADR-017, IG2-001)

Slice 2 first shipped `geometry(...,32717)`. That was corrected before merge: typing the columns
with the pilot's UTM zone made one project's coordinate system a property of the platform, and a
project outside zone 17S could not have been stored at all.

| Role | Where it lives | Value |
|---|---|---|
| Canonical — what every geometry column stores | the schema | always `EPSG:4326` |
| Source — what a dataset version arrived in | `spatial_dataset_version.source_srid` | per dataset |
| Analysis — where metres are computed | `spatial_dataset_version.analysis_srid` | per dataset |

`analysis_srid` must be projected; a CHECK rejects the geographic 4xxx block. The pilot's `32717`
lives in the project fixture as a `DEMO_ASSUMPTION` and appears nowhere in `packages/domain` — a
unit test fails if it comes back. Migration `0011` is forward-only: it reprojects the columns with
`USING ST_Transform(geom, 4326)` and backfills the two SRIDs; `0009` and `0010`, already applied to
staging, are not rewritten.

## 3b. Chainage (IG2-003)

Chainage is derived from the geometry that is stored, by one deterministic method recorded on
every value:

```
parcel centroid → ST_LineLocatePoint onto the active alignment → fraction × alignment length
                  (measured in the analysis CRS) → metres, chainage_method = centroid_projection
```

It was previously carried over from the generator's own arithmetic, which meant two numbers for
one fact. `centroid_projection` rather than `frontage_midpoint` because we have not surveyed where
each parcel meets the road, and the centroid is a property of the geometry we do have.

Seeded pilot: 141 parcels, chainage 30,4 m – 7 377,8 m against a 7 410 m alignment, ordering
correlating 1,0000 with the west→east code sequence.

## 3c. Dataset replacement (IG2-002)

`activateDatasetVersion` is the transaction an official import will end with; the importer itself
is still unbuilt. It deactivates the current version and its geometry and activates the new pair
in one transaction. Proven by integration test: the parcel's UUID and `parcel_code` are unchanged,
v1 and its geometry are retained but inactive, exactly one geometry is active, the alignment
dataset keeps its own active version throughout (uniqueness is scoped per dataset, not per
project), and a version that fails to name what it supersedes rolls back with v1 still active.

## 4. Provenance

Every parcel, every geometry, every dataset version and every affectation carries a
`provenance_id` whose record holds the four facets. The map's layer-provenance legend is
**derived** by `deriveLayerLegend(kind, facets)`; no SOURCE TYPE value is stored anywhere.

The derivation is deliberately unforgiving in one direction: a `DEMO_SIMULATION` regime yields
`SYNTHETIC_PARCELS` whatever its origin claims, so synthetic geometry cannot be re-labelled as
cadastre by editing a row.

| Layer | Legend | What it actually is |
|---|---|---|
| `alignment_v1` | RECONSTRUCTED ALIGNMENT | an axis drawn from control points, not surveyed |
| `parcels_v1` | SYNTHETIC PARCELS | generated polygons · not cadastre |
| `affectations_v1` | SYNTHETIC PARCELS | the right-of-way strip clipped to each parcel |

There is no base map. The approved design shows hydrography, towns and general location from a
real base map; we do not have one. Drawing a decorative background and labelling it REAL BASE MAP
would be a lie, so the map has a plain background and the legend lists only the two layers that
exist.

## 5. Historical facts versus demo simulation

The pilot's historical universe is **141 roadside parcels**, a verifiable figure from a concluded
study. The generator produces **141 synthetic polygons**. The number coincides on purpose — the
demo would be incoherent otherwise — and the two must never read as the same fact:

| Where | Value | Badge | Claim |
|---|---|---|---|
| Command Center KPI "Universo estimado" | 141 | `REAL_AGGREGATE` | the concluded study counted 141 roadside parcels |
| Territorial summary, Explorer, map | 141 | `SYNTHETIC` | we generated 141 polygons; not cadastre |

`e2e/gis.spec.ts` asserts both badges on the same screen, so a future change that quietly relabels
one of them fails the suite.

The status split (138 confirmed · 2 in verification · 1 not located) is **also** simulation: no
field work has told us any parcel is confirmed. It exists so the map legend and the filters have
something real to exercise, and it is labelled `SYNTHETIC` like everything else the generator
produced.

## 6. Deterministic generation

`generateCorridor` (`packages/domain/src/gis/corridor-generator.ts`, `corridor-generator@1`) is a
pure function of its input: an FNV-1a seed hash drives a mulberry32 PRNG, the axis is resampled
every 40 m with a bounded wobble, and parcels are placed alternately on each side in chainage
order. The same seed produces byte-identical output; a different seed produces different output
(both asserted). Its inputs live in `fixtures/projects/zamora-puente-del-amor/manifest.json`, never
in `packages/domain`.

The seeded pilot corridor: **7 410 m** of axis (PostGIS-measured), **141** parcels, **181,3 ha**
mapped, **16,6 ha** estimated affectation.

## 7. Map and table are one selection

The read model returns one payload: the same rows become the table and the map features. The map
holds no fact of its own, which matters twice:

- **Coherence.** A parcel cannot be on the map and missing from the table. Filters live in the
  Explorer, above both, so they cannot disagree about what is in view; the count reads
  "141 predios · N en vista".
- **Accessibility.** A WebGL canvas cannot be made a screen-reader surface, so the table *is* the
  accessible representation. The canvas is `aria-hidden`, selection is a real `<button>` with
  `aria-pressed`, and a polite live region announces the selected parcel.

The map carries **no controls at all** (IG2-005). MapLibre's `NavigationControl` renders real
buttons, and inside an `aria-hidden` subtree those are controls a keyboard can reach but a screen
reader cannot announce — so they were being taken out of the tab order, which left visible buttons
only a mouse could use. Keeping such a control is worse than not offering it. Scroll, drag and
pinch still zoom; the scale bar is inert text. `removeMapFromTabOrder` stays as the guard that
catches any control a future MapLibre upgrade adds.

A browser test walks the whole journey from the keyboard — reach the table, select a parcel, open
the Parcel Workspace, inspect provenance — without touching the map, and asserts that the
`aria-hidden` subtree contains no focusable element.

## 8. Deviations from the approved design

| # | Design v0.2 | What was built | Why |
|---|---|---|---|
| 1 | Real base map with hydrography and towns | plain background, two layers in the legend | we have no base map; a decorative one labelled REAL would be false (invariant 4) |
| 2 | Survey states on the map (Completo · Visitado · Requiere revisita · Inconsistencia) | four GIS statuses (Confirmado · En verificación · No localizado · Excluido) | those states derive from visits, instruments and findings, which do not exist; `DESIGN_SURVEY_STATES_PENDING_FIELD` keeps the target visible |
| 3 | Parcel Workspace tabs fully populated | Resumen and Afectaciones built; four tabs render an inert state naming the module | populating them would mean inventing field and quality data |
| 4 | Affectation with items, percentage and review state | area only; ratio derived from the two geometries | a stored percentage drifts from its geometry; the itemisation and the review workflow carry legal and personal-data weight this slice does not own |
| 5 | Abscissa as a first-class linear reference row | `chainage_m` + `chainage_method` on `Parcel` | one nullable reference per parcel is a column; the CHECK already prevents a chainage without its method |
| 6 | — | `method="post"` added to the sign-in form | an unhydrated submit fell back to a native **GET** and put the password in the URL and history; found while running the browser suite against the dev server |

## 9. Accessibility

`e2e/accessibility.spec.ts` scans the Parcel Explorer and the Parcel Workspace with axe
(WCAG 2.1 A/AA, failing on `serious` and `critical`). Both are clean. Three real defects were found
and fixed rather than suppressed:

- the `aria-hidden` map contained focusable MapLibre controls (`aria-hidden-focus`, serious);
- `aria-selected` on a plain `<tr>` is invalid ARIA outside a grid — selection moved to a button;
- the first fix left visible zoom buttons that only a mouse could operate, so the controls were
  removed entirely (IG2-005) rather than left in that state.

A green axe run is not conformance: axe finds a minority of accessibility problems. It is a
regression net beside the manual keyboard and focus assertions in the browser suite.

## 10. Performance

| Measure | Value |
|---|---|
| `loadParcelExplorer` server time | median 6,4 ms · p95 7,6 ms (12 runs) |
| `loadTerritorialSummary` server time | median 3,7 ms · p95 4,1 ms |
| Parcel features | 141 |
| GeoJSON `FeatureCollection` | 46,7 KiB |
| Table rows payload | 64,9 KiB |
| Whole read-model payload | 117,2 KiB |
| Browser: table visible / canvas sized | ~535 ms / ~800 ms after navigation |
| Server-side payload cap | `PARCEL_PAYLOAD_LIMIT = 2000` parcels, with `truncated` reported |
| Table virtualization | **not** added |

Measured locally against PostgreSQL 17 + PostGIS 3.5 (`packages/application`, 12 runs after a
warm-up). An earlier note in this report said 20,6 KiB; that figure counted only the polygon
geometry, not the `FeatureCollection` with its properties, and is superseded by the table above.

TanStack Virtual is not installed and no vector-tile infrastructure is introduced. At 141 rows and
47 KiB either would add a dependency, a subsystem and a class of bugs for no measurable gain. The
trigger is **observational**: a project whose payload approaches the 2 000-feature cap (roughly
650 KiB of GeoJSON at this density), or a measured interaction delay in the table. Then, in order:
`ST_AsMVT` tiles (ARCHITECTURE.md §7), server-side filtering, virtualization — each with a
measurement first (TD-027).

## 11. Security and tenancy

- Six new tables, each with `tenant_id`, `project_id`, the composite FK, `ENABLE` + `FORCE` RLS
  and policies using `app.has_project_access` (project **data**, so membership or OWNER implicit
  access — never `can_administer_project`, D-015).
- New entry points: two routes, both through `resolveSurfaceAccess`; two read models, each calling
  `requireCapability` and `requirePermission`. No server actions, no route handlers, no jobs.
- **No arbitrary SQL is exposed.** There is no geometry endpoint, no user-supplied filter
  expression, no PostGIS function name from a request. Filtering and sorting happen in the browser
  over an already-scoped payload; every query is parameterised, and the only `sql.raw` in the GIS
  read models carries the two compile-time SRID constants, which PostGIS will not accept as bound
  parameters.
- `packages/testing/test/rls/slice2-gis.integration.test.ts` adds the spatial tables to the
  cross-tenant harness, including a bounding-box query that covers both tenants' geometry and
  still returns only the caller's row.
- **No personal data.** The fixture holds no owner names, no phone numbers, no coordinates derived
  from actual residents and no cadastral keys. Parcel codes are generated, not cadastral.
- **A sign-in defect found and closed.** The form declared no `method`, so a submit landing before
  hydration fell back to a native **GET** and put the password in the URL, in `history` and in the
  `Referer` of everything the next page loaded. `method="post"` closes it, and
  `e2e/anonymous.spec.ts` now asserts that no request URL, address bar, `window.location` or
  navigation entry ever contains the credential, that the form declares POST, that no credential
  form is served without scripts at all, and that the identity endpoint refuses credentials sent as
  a query string. The test compares against a synthetic disposable password and never prints it.

## 12. What this slice does not do

FieldFlow and the visits inbox · Social Intelligence · Quality Gate · RAG · Reports · Client
Portal · the official GIS import (specified in `docs/GIS_IMPORT_CONTRACT.md`, not built) ·
geometry editing of any kind · vector tiles · a base map · parcel attributes · `ProjectUnit` ·
affectation review workflow · anything that writes geometry from the browser.
