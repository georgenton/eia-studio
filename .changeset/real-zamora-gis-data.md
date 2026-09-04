---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/web": minor
---

The Zamora workspace now shows the real study's cartography.

The consultancy's package arrived: an Esri File Geodatabase with 83 feature classes for the
*Actualización de Estudios Socioambientales … vía Puente del Amor – Los Hachos* (PROVIAL 2,
EC-L1289). The surveyed centreline — **7 361,3 m**, against the ~7,4 km the study published — the
**141** fronting parcels with the codes the field sheet uses, **71** affectation polygons, a start
and end abscissa per parcel, and the four influence areas the study delimited (AID, AII, AISD, AISI)
replace the generated corridor.

**No owner-bearing attribute entered.** The package's parcel layers carry owner names, deed
references, compensation agreements, surveyor names, photographs and free-text field notes. Every
one was stripped outside this repository under an allowlist that denies by default — 18 attributes
dropped from `PREDIOS`, 19 from `AREAS_AFECTADAS` — and the result was verified to contain fourteen
property keys and zero person-shaped values before anything was committed. `SECURITY.md` §10a's
compliance gate is untouched and this change does not lean on it.

**It is a supersede, not a rebuild.** Each parcel keeps its UUID, so every assignment, visit,
response, coding and specialist decision still points at the parcel it always did; each old boundary
is deactivated rather than deleted; the synthetic dataset versions stay, inactive, named by
`supersedes_version_id`. That is what makes the import runnable against persistent staging.

**Three model changes, all forced by the data** (ADR-023, migrations 0024–0026). Geometry columns
hold multi-part geometry, because 20 real parcels are two polygons and rejecting them would drop
14 % of the study. A parcel carries a chainage *range*, because a frontage runs from one abscissa to
another. Influence areas become a first-class layer. The map legend gains `IMPORTED STUDY LAYER` and
`STUDY DELIMITED AREA`: a layer whose attributes had to be stripped is a consultancy's own survey,
and calling it official cadastre would lend a registry's authority to a surveyor's file.

**Nothing in the delivery was repaired.** `042a` is still a second spelling of `042A`, code `090`
still has an affectation and no parcel, `091` still has no declared chainage, and two abscissa
ranges still end before they start. A CHECK enforcing range order was written and removed: it would
have made the study's own cartography unstorable. Saying that two sources disagree is the Quality
Gate's job, not an importer's.

Also fixed: the map computed a selected parcel's centre by flattening coordinates one level, which
yielded a ring rather than a position for multi-part geometry and crashed the page on the first
click.
