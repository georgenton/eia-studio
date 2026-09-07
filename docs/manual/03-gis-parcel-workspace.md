# 03 · GIS and Parcel Workspace

## Parcel Explorer — `/t/…/p/…/gis`

Map, table and contextual panel share **one selection**: clicking a polygon selects the row, and
clicking the row selects the polygon. Filters narrow both.

The **layer-provenance legend** is mandatory and is on every map, including thumbnails. It names
what each layer actually is — for this project, the study's own centreline and its own parcel
survey. There is no base map: drawing a decorative background and labelling it a real base map
would be a false claim, so the legend lists only the layers that exist (TD-029).

**The map opens on the project.** The extent is computed from the **parcels and the centreline**,
and the viewer handles `Polygon` and `MultiPolygon` alike — as it must, since every parcel of this
study is stored as a `MultiPolygon` and 20 of the 141 are genuinely in more than one piece. The
areas of influence are deliberately **not** in that extent: the indirect social one is about 22 by
28 km against the corridor's 4 by 6, and framing it would shrink the road to a smudge. They are
context, and the toggle beside the legend is where a reader asks for them.

**«Centrar en proyecto»**, top right, re-frames that extent. It is a real button outside the map
canvas — the canvas subtree is `aria-hidden`, so a control inside it would be one a keyboard can
reach and a screen reader cannot announce — and it is the way back when scrolling has left the
project off screen.

## Parcel Workspace — `/t/…/p/…/parcels/[code]`

One parcel's file, in tabs:

| Tab                          | State                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Resumen                      | built — identification, geometry, linear reference (abscissa and side), state            |
| Afectaciones                 | built — affectation records, each ≤ the parcel's own area, enforced in the database      |
| Visitas                      | built — visit history with state, questionnaire version and provenance (not the answers) |
| Instrumentos, Media, Calidad | inert "aún sin datos" states that name the module they wait on                           |

## Worth checking

- **A parcel code is not probeable.** A code in a project you cannot see, and a code that does not
  exist, both answer 404 — the same answer, so neither confirms anything.
- **Geometry is stored in EPSG:4326** and measured in the dataset's declared projected CRS. The
  pilot's analysis CRS is a demo assumption until the official GIS package arrives (TD-028).
- **An empty grey map is a camera fault, not missing data.** If it ever happens again, the extent
  is the thing to look at: the read model returns `bounds: null` only when the project has no
  drawable geometry at all, and the viewer then falls back to `[0, 0]` at zoom 1 — the middle of
  the Atlantic, with Zamora 8 700 km away and every table on the page still perfectly correct.
- **A GIS specialist can see that a parcel was visited without reading what was answered there.**
  That is `field.read` without `field.responses.read`, and it is deliberate.
