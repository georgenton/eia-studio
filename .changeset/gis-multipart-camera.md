---
"@eia/domain": patch
"@eia/application": patch
"@eia/web": patch
---

The map opens on the project again.

*Cartografía y predios* had become an empty grey square. The data was never missing: 141 parcels,
their geometry, the 7 361 m centreline and four areas of influence were all in the payload, and
the table beside the map listed every one of them. The **camera** was somewhere else.

`loadParcelExplorer` computed the opening extent by walking a parcel's coordinates two levels deep
— `for (const ring of coordinates) for (const [x, y] of ring)` — which is the shape of a `Polygon`.
Every parcel of this study is stored as a `MultiPolygon` (and 20 of the 141 are genuinely in more
than one piece), so `[x, y]` destructured two *rings*, `Math.min` was handed an array, and the
accumulator became `NaN`. `NaN` then won every later comparison, so one multi-part parcel was
enough to empty the extent for all of them: `bounds: null`, and the viewer fell back to `[0, 0]` at
zoom 1 — the middle of the Atlantic, about 8 700 km from the project.

The fix is a small pure utility in the domain that walks *down to the numbers* instead of indexing
to a fixed depth, so it cannot be wrong about a type nobody told it about: `Polygon`,
`MultiPolygon`, `LineString`, `MultiLineString`, points and `GeometryCollection`, ignoring anything
that is not two finite numbers rather than propagating it. The same walk already existed inline in
the map component — written there after this exact mistake broke *selection* — and is now one
function with no second copy to miss.

The extent covers the **parcels and the centreline**, not the areas of influence: the indirect
social area is about 22 by 28 km against the corridor's 4 by 6, and framing it would reduce the
object of the work to a smudge.

**«Centrar en proyecto»** is new, top right of the map: a real button *outside* the `aria-hidden`
canvas, so a keyboard reaches it and a screen reader announces it. It re-frames the extent — a way
of reading the map, and the way back from having scrolled off the project.

No base map was added, and none is needed: this is the project's own cartography, drawn on the
same neutral background as before.
