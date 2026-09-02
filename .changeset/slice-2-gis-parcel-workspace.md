---
"@eia/application": minor
"@eia/domain": minor
"@eia/db": minor
"@eia/ui": minor
"@eia/web": minor
"@eia/worker": minor
---

Slice 2: GIS / Parcel Explorer and Parcel Workspace. The GIS surface becomes real — a map and a
table sharing one selection, faceted filters, a contextual parcel panel and the mandatory
layer-provenance legend — with a Parcel Workspace at `/parcels/[parcelCode]` whose Resumen and
Afectaciones tabs are built and whose remaining tabs state plainly that their modules do not exist
yet. The Command Center gains the territorial summary panel, counted from the active layers and
carrying their provenance (TD-023 narrowed).

Six new tables (`spatial_dataset`, `spatial_dataset_version`, `alignment`, `parcel`,
`parcel_geometry`, `affectation`) in migrations `0009` and `0010`, all tenant- and
project-scoped with composite foreign keys, `ENABLE` + `FORCE` RLS and policies on
`app.has_project_access`. Geometry is stored in a projected metric CRS (`EPSG:32717`) and
transformed to `EPSG:4326` on read; exactly one active dataset version and one active geometry per
parcel are enforced by unique partial indexes, so replacing the synthetic layer with an official
import creates new geometry rows without any parcel losing its identity.

The corridor and its 141 parcels are generated deterministically by `corridor-generator@1` from
fixture inputs and are labelled SYNTHETIC throughout; the historical 141 remains a separate,
`REAL_AGGREGATE` fact. The official GIS import is specified in `docs/GIS_IMPORT_CONTRACT.md` and
is not built.

Also fixes a sign-in defect found while running the browser suite: the form had no `method`, so a
submit before hydration fell back to a native GET and put the password in the URL and history.
