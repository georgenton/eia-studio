---
"@eia/domain": patch
"@eia/web": patch
---

The reference basemap is switched on for staging, and two things were wrong until a real account said so.

MapTiler **Free** is enabled on Preview for research, development and consultancy demonstration —
no paid plan, no billing details, nothing that incurs a charge. Production is untouched.

**The satellite id in the code was broken.** `satellite-v4` came from the provider's own
documentation example while no account existed to check it against; on the real account it answers
**404**. Every style id is now verified by requesting one real tile over the corridor: `Mapa` is
`streets-v2`, `Satélite` is `hybrid` (imagery with labels — on a rural corridor the place names are
what connect the picture to the study), `Relieve` is `topo-v2` (contours and hydrography strong
enough to read under the project's layers). The attribution wording is now copied from what the
account's own TileJSON returns rather than paraphrased.

**A background change could be silently dropped.** The attach ran only when
`map.isStyleLoaded()` was true and otherwise queued itself on a `load` event that had already
fired and would never fire again — so a reader who changed the background while the map was busy
saw nothing happen. It now waits on "the map is built", which is the question actually being asked.

**The selected parcel was invisible over imagery.** A deep blue outline on a five-hectare polygon
disappears into dark vegetation, so a reader clicking a row in the table saw nothing move. It gains
a white halo over imagery — the same treatment the centreline already had, for the same reason —
and none on a pale ground, where the blue already reads and a white ring would rub out the boundary
with the neighbouring parcel.

Everything else held under real imagery: parcel fills and outlines are legible at working scale,
the areas of influence stay readable without dominating, the attribution is visible and outside the
`aria-hidden` canvas, and an invalid key still falls back to the neutral ground with the study's
layers untouched.

`playwright.live.config.ts` and `e2e/basemap-live.spec.ts` are the manual run against the real
provider that produced the screenshots. They are deliberately outside the ordinary suite: CI stays
provider-independent and can never make a billable request.
