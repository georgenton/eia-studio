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

## 7. Activation status

**MapTiler Free is enabled on staging / Preview, for research, development and consultancy
demonstration** (owner authorisation, 7 September 2026). This is not a commercial production
licence and says nothing about production readiness: **Production is not configured, and the
production branch was not touched.** Before a real engagement is served from this, the plan and its
terms are the owner's decision to revisit.

| | |
|---|---|
| Plan | **MapTiler Free.** No Flex, no paid tier, no billing details added, nothing that incurs a charge |
| Environment | Vercel **Preview only**: `BASEMAP_PROVIDER=maptiler` and `MAPTILER_KEY`. Production has no environment variables at all |
| Key type | a **browser/application key**, not an administrative service token |
| Origin restriction | applied at MapTiler to the stable Preview hostname. Verified from here: a tile request without that origin answers **403**, the same request with it answers **200** |
| Local development | **not** covered by this key, deliberately. A developer who needs a background asks for a separate development key rather than widening this one |

### The style ids, verified rather than assumed

Checked on 7 September 2026 by requesting one real tile over the pilot corridor through the key's
allowed origin. **Verifying mattered**: `satellite-v4`, taken from the provider's own documentation
example while no account existed, answers **404** on this account and would have degraded silently
to the neutral ground.

| Mode | Endpoint | Why this one |
|---|---|---|
| `Mapa` | `maps/streets-v2` raster | restrained reference map; carries the settlement names and the road network |
| `Satélite` | `maps/hybrid` raster | imagery **with labels**. On a rural corridor the place names are what connect the picture to the study; plain `tiles/satellite-v2` also works and is one constant away if the labels ever crowd the parcels |
| `Relieve` | `maps/topo-v2` raster | contours and hydrography, drawn strongly enough to read under the project's layers. `outdoor-v2` carries the same contours more faintly |

The attribution wording and links are copied from what the account's own TileJSON and style
documents return, so the surface shows what the provider asks for rather than a paraphrase.

### Still the owner's

- **A spend cap or quota alert** on the MapTiler account. Free has an allowance; nothing in this
  product can enforce it, and a demonstration that exceeds it degrades to the neutral ground rather
  than billing anybody, but the alert is worth having.
- **Rotating the key** if it has been shared through a channel that keeps history. Rotation is one
  value change in Vercel Preview and needs no code.
- **Production**, if it is ever wanted: a separate key, a separate origin restriction, and a
  decision about the plan.

Sources for the endpoint shapes, read 7 September 2026:
`https://docs.maptiler.com/cloud/api/maps/` and `https://docs.maptiler.com/cloud/api/tiles/`.

### Looking at it before a consultancy does

`playwright.live.config.ts` and `e2e/basemap-live.spec.ts` are a **manual** run against the real
provider, deliberately outside the ordinary suite so CI can never make a billable request:

```bash
MAPTILER_KEY=… DEMO_USER_PASSWORD=… npx playwright test --config playwright.live.config.ts
```

They produce the four screenshots and assert that every tile came back `200`, that the parcels and
the centreline are drawn over each background, and that the attribution is present. Because the key
is restricted to the Preview origin — and the Preview sits behind deployment protection — each tile
request is re-issued from Node with that origin's `Referer`. The bytes are the provider's, fetched
with the owner's key through the origin the owner allowed; only the hop is different.

## 8. Security

A map key **is** client-visible. It is sent to the browser because the browser is what requests the
tiles; every web map in existence works this way. Treating it as a secret would be theatre.

| | |
|---|---|
| What protects it | the provider's allowed-origin restriction and a spend cap — not obscurity |
| What it is not | a server credential. Never reuse a database, gateway or auth secret as a map key |
| Where it lives | Vercel Preview's environment, never the repository. `.env.example` carries the name only, and no key appears in code, documentation, screenshots or test output |
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
