---
"@eia/domain": minor
"@eia/web": minor
---

The workspace reads as a consulting product: Spanish throughout, the plan as a plan, the areas on the map.

**Every remaining internal word is gone from the screens.** *Tenant*, *Portfolio*, *Workspace*,
*capabilities*, *fixture*, a permission key in a footnote, rule keys beside every rule, role and
status enums (`COORDINATOR`, `COMPLETED`), the profile key `road_eia_social`, a repository path in
the provenance drawer, and the classifier's adapter/prompt/hash table on the specialist's working
view. The audit trail they carried is kept — the run's model, adapter and prompt version are one
click away under *Detalle técnico*, and a rule's catalogue key stays on the finding it produced —
because it is evidence, not something a consultant reads while working.

**The rail is ordered the way the work happens** — proyecto → territorio → levantamiento →
resultados → revisión → gestión ambiental → documentos → informe — so *Plan de Manejo* now sits
before *Documentos*, and the Quality Gate is *Control de consistencia*, which is what it does: it
reports that two sources disagree and never declares conformity.

**The management plan reads as a management plan.** Nine plans, each grouped by the document's own
programme banners, each measure a card with its own words first and the nine columns as labelled
fields — instead of eighty-six rows of a ten-column table. The labels are normalized (*Frecuencia*)
while the chapter's own headings, `FRENCUENCIA` included, are preserved and shown per plan under
*Cómo nombra este plan sus columnas*.

**The areas of influence are on the map** (TD-070). All four are drawn under the parcels with a
toggle that names them and their areas; the outline is generalised for drawing —
`ST_SimplifyPreserveTopology` in the dataset's analysis CRS turns 890 KB of stored coordinates into
21 KB drawn — and the legend says so. The alignment is no longer dashed: it stopped being a
reconstruction when the study's own centreline was imported.

**One field operation at a time.** The current one is what the surface shows; earlier ones open
from *Ver el operativo anterior*, closed and complete.

**The plan is checked against the map** (TD-072). `rule.pgas_place_vs_influence_area@1` compares a
plan's *lugar de aplicación* against the areas of influence the cartography holds — two sources, no
compliance claim — and the importer now reads that place out of the objective paragraph, where
seven of the nine plans put it.
