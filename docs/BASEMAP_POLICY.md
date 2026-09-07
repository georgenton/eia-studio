# The reference basemap: context, not evidence

> What may be drawn *underneath* a project's cartography, what that is allowed to mean, and what
> has to be true before a provider is switched on.
>
> Related: `docs/manual/03-gis-parcel-workspace.md`, `docs/GIS_IMPORT_CONTRACT.md`,
> `docs/PROVENANCE.md`, ADR-023 (the real package decides the shape).

## 1. The line

> **El mapa base proporciona contexto territorial. Las delimitaciones, predios, afectaciones y
> áreas del proyecto proceden de las capas del estudio.**

Everything the consultancy delivered — the centreline, the 141 parcels, the affectations, the four
areas of influence — is **evidence**. It carries a provenance record with four facets, it is named
in the layer-provenance legend, it can be cited in a report, and the firm can be held to it.

A third-party basemap is **geographic reference**. It tells a reader whereabouts on the ground they
are looking. It is not a statement this product makes, and nothing about it is defensible in a
deliverable: not a boundary, not a road that appears on it, not a building, not a name.

The two must never merge. In particular a reference basemap may never:

- appear in the layer-provenance legend, or acquire a `provenance_id`;
- be offered a *Ver origen* drawer;
- become a source in a report snapshot (ADR-022 admits five source kinds, and tiles are none);
- be used to correct, confirm or contradict the study's geometry. If imagery suggests a parcel is
  in the wrong place, that is a finding for the consultancy, not an edit.

This is enforced structurally rather than by care: the basemap is **one raster layer**, added
beneath everything, with nowhere to put a facet. `e2e/gis-basemap.spec.ts` asserts that a
configured reference service does not appear among the study's layers.

## 2. Shape

| | |
|---|---|
| Library | MapLibre GL JS, unchanged. No provider SDK, no Google Maps |
| Model | provider-neutral: `resolveBasemapCatalogue` in `@eia/domain` returns which of four modes a deployment may offer |
| Modes | `none` · `map` · `satellite` · `terrain` — *Sin fondo* · *Mapa* · *Satélite* · *Relieve* |
| Drawing | one raster source and one raster layer, inserted **below** the lowest project layer |
| Provider internals | never surfaced: a reader sees the four Spanish names and an attribution line |

**Why raster tiles rather than the provider's own vector style.** Swapping a MapLibre style tears
down every source and layer on the map, so the project's geometry would be rebuilt every time
somebody changed the background, and while the new style loaded the surface would show nothing.
One raster layer underneath means the background can appear, change or fail without anything above
it moving — which is what makes §5's invariant cheap rather than careful.

## 3. Configuration

Read at **request time**, so a background can be switched on, changed or withdrawn by restarting a
process rather than rebuilding, and so one build can serve an environment with a background and one
without.

| Variable | Meaning |
|---|---|
| `BASEMAP_PROVIDER` | `none` (default), `maptiler`, `custom` |
| `MAPTILER_KEY` | MapTiler Cloud browser key |
| `BASEMAP_TILE_URL` | `custom` only: an XYZ template containing `{z}`, `{x}`, `{y}` |
| `BASEMAP_ATTRIBUTION` | `custom` only: the credit that service requires, shown verbatim |

Nothing is required, and nothing can stop the application booting. An unknown provider name, a
missing key or a template that is not a template all resolve to "no background" — deliberately the
same outcome, because a map that failed to render over a *background setting* would be a far worse
failure than no background.

## 4. Which background, and why

**Default when a provider is configured: `Satélite`.**

The alternative was `Mapa`. On a rural corridor a street map is nearly empty — one line, a river,
two place names — and the relationships a reader is actually trying to see are not on it: the road
against the vegetation it cuts, the parcels against the settlements they belong to, the terrain the
alignment follows. Those are only visible on imagery. `Mapa` remains one click away, and is the
better ground for reading parcel codes and status colours, which is why the switcher is on the map
rather than in settings.

Imagery is dark and busy, so the study's layers are drawn differently over it — see §6. The
geometry is untouched; only presentation changes.

## 5. The hard invariant

**A third-party basemap can never produce a blank GIS.**

The study's layers are attached before any tile is requested, and nothing about the background
touches them. If the provider fails — a revoked key, an exhausted quota, an outage, a captive
portal, a wrong style id — the neutral ground is already there, the project is already drawn, and
the surface says one quiet line: *El mapa de referencia no está disponible. Se mantiene el fondo
neutro; las capas del estudio no cambian.*

Availability is **asked**, not waited for. MapLibre does not report a raster tile that answers 404:
the tile is simply never painted, and the map goes on looking like a map of somewhere featureless.
So one tile covering the project is fetched, and any answer that is not a plain success is treated
as no background. One request settles in a round trip what would otherwise never be settled at all.

`e2e/gis-basemap.spec.ts` runs against a second server configured with a reference service whose
tiles do not exist — no external request, no credential, nobody billed — and asserts that the
parcels, the centreline, the camera and the extent are all exactly as they are without it.

## 6. Presentation over imagery

Only opacity, stroke width, halo and contrast change. Never geometry, never a colour that carries
meaning.

| | Over a pale ground | Over imagery |
|---|---:|---:|
| Parcel fill opacity | 0,85 | **0,45** |
| Parcel outline | 1 px | **1,4 px** |
| Selected parcel | 3 px | **4 px** |
| Centreline halo | `#c6d2d6`, 11 px, 0,7 | **`#ffffff`, 12 px, 0,85** |
| Centreline | 2,6 px | **3 px** |
| Influence fill opacity | 0,07 | **0,10** |
| Influence outline | 1,2 px | **1,8 px** |

The areas of influence keep their dashed outline and stay the faintest thing on the map on every
background: they are the ground a corridor is read against, and a 27 000 ha polygon painted over
the parcels would bury the object of the work.

Layer order, bottom to top: **reference basemap → influence fill → influence outline → parcel fills
→ parcel outlines → centreline halo → centreline → selected parcel**. The centreline moved above
the parcels in this change: underneath them it was legible on a pale ground and lost against
imagery, and the road is the subject of the study.

## 7. Activation

Nothing here is switched on. No account was created, no key was requested, no paid service was
subscribed to, and no request has ever been made to a tile provider from this repository.

To activate MapTiler, in order:

1. **The owner** creates or nominates a MapTiler Cloud account and decides the plan. This costs
   money above the free allowance and is not a decision this repository can take.
2. Create a **browser key**, restricted to the origins that serve the workspace — the staging
   hostname, and later production. A browser key is public by nature (§8); the restriction, not
   secrecy, is what protects it.
3. Set a **spend cap or quota alert** on the account.
4. **Confirm the three style ids** against the account's own catalogue. The endpoint *shapes* are
   documented (`docs/…` links below); the ids in `packages/domain/src/gis/basemap.ts` are the ids
   the documentation gives as examples plus one for relief that could not be verified without an
   account. An id the account does not have degrades to the neutral ground — the surface stays
   correct — but it should be right rather than merely safe.
5. Set `BASEMAP_PROVIDER=maptiler` and `MAPTILER_KEY` on staging, and reload the GIS surface.
6. Re-run `pnpm e2e -- e2e/screenshots.spec.ts` to produce the `Mapa`, `Satélite` and `Relieve`
   screenshots from the real provider. Until then only `Sin fondo` is pictured, deliberately: a
   screenshot of a background nobody has activated would be either somebody else's imagery pasted
   in or a fabrication.

Sources for the endpoint shapes, read 7 September 2026:
`https://docs.maptiler.com/cloud/api/maps/` and `https://docs.maptiler.com/cloud/api/tiles/`.

## 8. Security

A map key **is** client-visible. It is sent to the browser because the browser is what requests the
tiles; every web map in existence works this way. Treating it as a secret would be theatre.

| | |
|---|---|
| What protects it | the provider's allowed-origin restriction and a spend cap — not obscurity |
| What it is not | a server credential. Never reuse a database, gateway or auth secret as a map key |
| Where it lives | the platform's environment, never the repository. `.env.example` carries the name only |
| Blast radius | somebody who copies it can draw maps at your expense on an allowed origin. That is a billing risk, not a data risk: the key grants no access to this product, its database or its tenants |
| Logs | tile URLs contain the key, so they are never logged. The product logs no map requests at all |

## 9. Attribution

Attribution is a condition of using someone else's tiles, and it is never suppressed while they are
drawn. It is rendered by us — as ordinary document text with ordinary links, in the map's corner —
rather than by MapLibre's own attribution control, because that control lives inside the
`aria-hidden` canvas where its links cannot be reached by a keyboard.

It is prefixed **Mapa de referencia**, which is the same distinction §1 draws, made visible in the
one place a reader might otherwise confuse the two.

## 10. What this is not

Not a basemap architecture. There is one provider implementation, one raster layer and four names.
Vector styles, 3D terrain, hillshade from a DEM, offline tile caching, per-project basemap
configuration and a national cartographic service are all *possible* from here and none of them is
built, because none of them is needed to give a rural road study its territorial context.
