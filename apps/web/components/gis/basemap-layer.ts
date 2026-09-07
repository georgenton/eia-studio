import type { BasemapCatalogue, BasemapMode, BasemapTileSource } from "@eia/domain";
import { basemapSourceFor, basemapTileUrl, tileForLonLat } from "@eia/domain";
import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Attaching and detaching the reference background, without ever touching the project's layers.
 *
 * One raster source and one raster layer, inserted **below** everything the study delivered. The
 * whole point of the shape is that the background is removable: changing it, losing it or never
 * having it are the same operation on one layer, and none of them can disturb the evidence above.
 *
 * Deliberately not `map.setStyle()`. Swapping the style tears down every source and layer, so the
 * project's geometry would be rebuilt on each change and the surface would show nothing while the
 * new style loaded — turning a cosmetic preference into a moment where the study disappears.
 */
export const BASEMAP_SOURCE_ID = "reference-basemap";
export const BASEMAP_LAYER_ID = "reference-basemap-tiles";

/** The project layer the background must stay underneath, whichever of them exists. */
const BOTTOM_PROJECT_LAYER = [
  "influence-fill",
  "influence-line",
  "parcels-fill",
  "parcels-line",
  "alignment-halo",
  "alignment-line",
  "parcels-selected-halo",
  "parcels-selected",
];

function firstProjectLayer(map: MapLibreMap): string | undefined {
  return BOTTOM_PROJECT_LAYER.find((id) => map.getLayer(id));
}

export function detachBasemap(map: MapLibreMap): void {
  if (map.getLayer(BASEMAP_LAYER_ID)) map.removeLayer(BASEMAP_LAYER_ID);
  if (map.getSource(BASEMAP_SOURCE_ID)) map.removeSource(BASEMAP_SOURCE_ID);
}

/**
 * Draw this background under the project, replacing whatever was there.
 *
 * Returns the source it attached, or `null` for "no background" — which is a legitimate outcome
 * and not a failure: the neutral ground painted by the style's `background` layer is then what a
 * reader sees, exactly as before any of this existed.
 */
export function attachBasemap(
  map: MapLibreMap,
  catalogue: BasemapCatalogue,
  mode: BasemapMode,
): BasemapTileSource | null {
  detachBasemap(map);
  const source = basemapSourceFor(catalogue, mode);
  if (!source) return null;

  map.addSource(BASEMAP_SOURCE_ID, {
    type: "raster",
    tiles: [...source.tiles],
    tileSize: source.tileSize,
    maxzoom: source.maxZoom,
  });
  map.addLayer(
    {
      id: BASEMAP_LAYER_ID,
      type: "raster",
      source: BASEMAP_SOURCE_ID,
      // Imagery is busy; a fraction of the neutral ground showing through takes the edge off it
      // without washing out the ground a reader is trying to see.
      paint: { "raster-opacity": mode === "satellite" ? 0.92 : 1 },
    },
    firstProjectLayer(map),
  );
  return source;
}

/**
 * Ask the provider for one tile, and believe the answer.
 *
 * MapLibre does **not** report a raster tile that answers 404, 403 or nothing at all: the tile is
 * simply never painted, and the map goes on looking like a map that happens to be empty. A reader
 * would be left to work out for themselves whether the background is missing or the ground is
 * genuinely featureless — so availability is asked directly, with one request for a tile covering
 * the project.
 *
 * A single tile, at a zoom every world provider serves. It is the same request the map would make
 * anyway, so a working provider pays nothing for it; a broken one is found in one round trip
 * instead of never.
 *
 * Any outcome that is not a plain success — a 4xx, a 5xx, a CORS refusal, a network failure, an
 * abort — is "no background". Failing towards the neutral ground is always safe: the study's own
 * layers are already drawn and are not involved.
 */
export async function probeBasemap(
  map: MapLibreMap,
  catalogue: BasemapCatalogue,
  mode: BasemapMode,
  signal?: AbortSignal,
): Promise<boolean> {
  const source = basemapSourceFor(catalogue, mode);
  if (!source) return false;
  const centre = map.getCenter();
  const url = basemapTileUrl(source, tileForLonLat(centre.lng, centre.lat, PROBE_ZOOM));
  if (!url) return false;
  try {
    const response = await fetch(url, signal ? { signal } : {});
    return response.ok;
  } catch {
    return false;
  }
}

/** Low enough that every world-wide provider has it, high enough to be a real tile. */
const PROBE_ZOOM = 10;
