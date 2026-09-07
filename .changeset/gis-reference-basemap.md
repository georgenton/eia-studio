---
"@eia/domain": patch
"@eia/contracts": patch
"@eia/web": patch
---

The project's cartography can now be read against the ground it sits on.

*Cartografía y predios* draws the study's own layers — the 141 parcels, the 7 361 m centreline, the
affectations, the four areas of influence — and, until now, drew them on a flat grey square. The
geometry was right and the territory was missing: a reader could see the shape of the corridor but
not the vegetation it crosses, the settlements along it or the river it follows.

A **reference basemap** is now available underneath, in four modes a reader chooses on the map:
*Sin fondo* · *Mapa* · *Satélite* · *Relieve*. MapTiler is the first provider, behind a
provider-neutral model; nothing in the product knows a provider's name.

**The basemap is context; the study's layers are evidence, and the two never merge.** The
background is one raster layer under everything, with no provenance record, no place in the layer
legend, no *Ver origen*, and no path into a report. If satellite imagery seems to disagree with a
delivered polygon, that is a question for the consultancy — not a licence to edit geometry.

**No provider is configured, and nothing changes without one.** With no key the surface is exactly
what it was: the study's cartography on a neutral ground, no external request, no degraded state.
The switcher still appears, with the unavailable backgrounds disabled and one line saying what they
need — a fact about configuration, deliberately not dressed as an error.

**A third-party basemap can never produce a blank GIS.** The study's layers are attached before any
tile is asked for, so a revoked key, an exhausted quota or an outage costs a reader their
geographic context and nothing else. Availability is *asked* rather than waited for: MapLibre does
not report a tile that answers 404 — it simply never paints it — so one tile covering the project
is fetched and any answer that is not a plain success becomes "no background", with the neutral
ground and one quiet line of explanation.

Presentation, and only presentation, adapts to imagery: parcel fills step back, outlines and the
centreline's halo step forward, and the influence areas gain a heavier outline without becoming the
subject. The centreline also moved **above** the parcels in the layer order — underneath them it
was legible on a pale ground and lost against imagery, and the road is what the study is about.

`docs/BASEMAP_POLICY.md` records the boundary, the failure invariant, the security posture of a
browser map key, and the exact steps left before a provider can be switched on.
