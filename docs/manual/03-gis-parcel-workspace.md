# 03 · GIS and Parcel Workspace

## Parcel Explorer — `/t/…/p/…/gis`

Map, table and contextual panel share **one selection**: clicking a polygon selects the row, and
clicking the row selects the polygon. Filters narrow both.

The **layer-provenance legend** is mandatory and is on every map, including thumbnails. It names
what each layer actually is — for this project, a reconstructed alignment and synthetic parcels.
There is no base map: drawing a decorative background and labelling it a real base map would be a
false claim, so the legend lists only the two layers that exist (TD-029).

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
- **A GIS specialist can see that a parcel was visited without reading what was answered there.**
  That is `field.read` without `field.responses.read`, and it is deliberate.
