/**
 * The reference basemap: **context, never evidence**.
 *
 * ## The distinction this module exists to keep
 *
 * Everything the study delivered — the centreline, the parcels, the affectations, the areas of
 * influence — is *evidence*. It carries provenance, it is legended, it can be cited in a report,
 * and a reader may hold the consultancy to it. A third-party basemap is *geographic reference*:
 * it tells a reader whereabouts on the ground they are looking, and it says nothing this product
 * is willing to stand behind.
 *
 * So the basemap is deliberately modelled as **one raster layer under everything else**, with no
 * `provenance_id`, no entry in the layer-provenance legend, and no path into a report. It cannot
 * acquire either by accident: a raster source has nowhere to put a facet, and the legend is built
 * from `SpatialDatasetVersion` rows, which tiles are not.
 *
 * ## Why raster tiles rather than the provider's vector style
 *
 * Swapping a whole MapLibre style tears down every source and layer on the map, so the project's
 * geometry would have to be rebuilt each time somebody changed the background — and while the new
 * style loaded, the surface would show nothing. A single raster layer added beneath the project
 * layers means the background can appear, change or fail without the evidence above it moving.
 * That is what makes the hard invariant cheap: **if the tiles never arrive, the neutral ground is
 * already there and the project is already drawn.**
 *
 * ## No provider is not an error
 *
 * With nothing configured the catalogue offers `none` and the product is exactly what it was
 * before: the study's own cartography on a neutral ground. Configuration adds context; its
 * absence removes nothing.
 */

export const BASEMAP_MODES = ["none", "map", "satellite", "terrain"] as const;
export type BasemapMode = (typeof BASEMAP_MODES)[number];

/** What a reader sees. Provider internals are never surfaced here (ADR-025). */
export const BASEMAP_MODE_LABEL: Record<BasemapMode, string> = {
  none: "Sin fondo",
  map: "Mapa",
  satellite: "Satélite",
  terrain: "Relieve",
};

export const BASEMAP_PROVIDERS = ["none", "maptiler", "custom"] as const;
export type BasemapProviderId = (typeof BASEMAP_PROVIDERS)[number];

/** One attribution line. `href` is null for text a provider requires but does not link. */
export interface BasemapCredit {
  readonly label: string;
  readonly href: string | null;
}

/** Everything MapLibre needs for one raster source, and nothing else. */
export interface BasemapTileSource {
  readonly mode: BasemapMode;
  readonly tiles: ReadonlyArray<string>;
  readonly tileSize: number;
  readonly maxZoom: number;
  readonly credits: ReadonlyArray<BasemapCredit>;
}

export interface BasemapCatalogue {
  readonly provider: BasemapProviderId;
  /** Always contains `none`, always first: the product's floor, not a fallback. */
  readonly modes: ReadonlyArray<BasemapMode>;
  readonly defaultMode: BasemapMode;
  readonly sources: Readonly<Partial<Record<BasemapMode, BasemapTileSource>>>;
}

export interface BasemapEnvironment {
  readonly provider?: string | undefined;
  readonly maptilerKey?: string | undefined;
  /** A `{z}/{x}/{y}` XYZ template, for a self-hosted or national reference service. */
  readonly customTileUrl?: string | undefined;
  readonly customAttribution?: string | undefined;
}

const NEUTRAL: BasemapCatalogue = {
  provider: "none",
  modes: ["none"],
  defaultMode: "none",
  sources: {},
};

/**
 * The three styles, **verified against the account's own catalogue on 7 September 2026** by
 * requesting one real tile over the pilot corridor through the key's allowed origin.
 *
 *   maps    `https://api.maptiler.com/maps/{mapId}/{tileSize}/{z}/{x}/{y}.{format}?key=…`
 *   tiles   `https://api.maptiler.com/tiles/{tilesId}/{z}/{x}/{y}.{format}?key=…`
 *
 * Verifying mattered: `satellite-v4`, taken from the documentation's own example while no account
 * existed, **answers 404 on this account** and would have degraded silently to the neutral ground.
 * It is `satellite-v2`. The other two were confirmed rather than assumed, and the choices between
 * near-equivalents were made by looking at the tiles:
 *
 * - `hybrid` over plain satellite imagery, because on a rural corridor the settlement names are
 *   the link between the picture and the study — a corridor is usually named after the places at
 *   its ends, and a reader should be able to find them on the ground.
 * - `topo-v2` over `outdoor-v2` for relief: both carry contours, and `topo-v2` draws them and the
 *   hydrography strongly enough to read under the project's own layers.
 *
 * An id this account loses would return 404, which this product treats as "no background": the
 * neutral ground stays and the project stays drawn.
 */
const MAPTILER_MAP_ID = "streets-v2";
const MAPTILER_SATELLITE_MAP_ID = "hybrid";
const MAPTILER_RELIEF_MAP_ID = "topo-v2";

/**
 * The attribution MapTiler's terms require. Rendered by the surface, never suppressed.
 *
 * Stated here rather than read from the provider's TileJSON because a legal obligation should not
 * depend on a network response that may fail — the credit must be visible even on the first frame.
 * The wording and the links are **copied from what the account's own TileJSON and style documents
 * return** (checked 7 September 2026), so what the surface shows is what the provider asks for
 * rather than a paraphrase of it.
 */
const MAPTILER_CREDITS: ReadonlyArray<BasemapCredit> = [
  { label: "© MapTiler", href: "https://www.maptiler.com/copyright/" },
  { label: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
];

function maptilerSources(key: string): Partial<Record<BasemapMode, BasemapTileSource>> {
  const encoded = encodeURIComponent(key);
  return {
    map: {
      mode: "map",
      tiles: [
        `https://api.maptiler.com/maps/${MAPTILER_MAP_ID}/256/{z}/{x}/{y}.png?key=${encoded}`,
      ],
      tileSize: 256,
      maxZoom: 20,
      credits: MAPTILER_CREDITS,
    },
    satellite: {
      mode: "satellite",
      tiles: [
        `https://api.maptiler.com/maps/${MAPTILER_SATELLITE_MAP_ID}/256/{z}/{x}/{y}.jpg?key=${encoded}`,
      ],
      tileSize: 256,
      maxZoom: 20,
      credits: MAPTILER_CREDITS,
    },
    terrain: {
      mode: "terrain",
      tiles: [
        `https://api.maptiler.com/maps/${MAPTILER_RELIEF_MAP_ID}/256/{z}/{x}/{y}.png?key=${encoded}`,
      ],
      tileSize: 256,
      maxZoom: 20,
      credits: MAPTILER_CREDITS,
    },
  };
}

/**
 * What this deployment may offer, decided once from configuration.
 *
 * Never throws and never refuses to produce a catalogue: a missing key, an unknown provider name
 * or a malformed template all resolve to the neutral catalogue, because a map surface that fails
 * to render over a background setting would be a worse outcome than no background.
 */
export function resolveBasemapCatalogue(env: BasemapEnvironment): BasemapCatalogue {
  const provider = (env.provider ?? "none").trim().toLowerCase();

  if (provider === "maptiler") {
    const key = env.maptilerKey?.trim();
    if (!key) return NEUTRAL;
    return {
      provider: "maptiler",
      modes: ["none", "map", "satellite", "terrain"],
      // Why satellite: see `docs/BASEMAP_POLICY.md` §4. On a rural corridor a street map is
      // nearly empty, and the relationships a reader is trying to see — the road against the
      // vegetation, the parcels against the settlements and the river — are only on imagery.
      defaultMode: "satellite",
      sources: maptilerSources(key),
    };
  }

  if (provider === "custom") {
    const template = env.customTileUrl?.trim();
    if (!template || !template.includes("{z}")) return NEUTRAL;
    return {
      provider: "custom",
      modes: ["none", "map"],
      defaultMode: "map",
      sources: {
        map: {
          mode: "map",
          tiles: [template],
          tileSize: 256,
          maxZoom: 20,
          credits: env.customAttribution?.trim()
            ? [{ label: env.customAttribution.trim(), href: null }]
            : [],
        },
      },
    };
  }

  return NEUTRAL;
}

/** Whether a reader may choose this background here. */
export function isBasemapModeAvailable(catalogue: BasemapCatalogue, mode: BasemapMode): boolean {
  return catalogue.modes.includes(mode);
}

/**
 * The mode to open on, given what a reader last chose.
 *
 * A remembered preference for a background this deployment no longer offers — the key was
 * withdrawn, the provider changed — silently becomes the catalogue's default rather than an error
 * or an empty map.
 */
export function resolveInitialBasemapMode(
  catalogue: BasemapCatalogue,
  remembered: string | null | undefined,
): BasemapMode {
  const candidate = (remembered ?? "").trim() as BasemapMode;
  if (BASEMAP_MODES.includes(candidate) && isBasemapModeAvailable(catalogue, candidate)) {
    return candidate;
  }
  return catalogue.defaultMode;
}

/** The source for a mode, or null when there is nothing to draw underneath. */
export function basemapSourceFor(
  catalogue: BasemapCatalogue,
  mode: BasemapMode,
): BasemapTileSource | null {
  if (mode === "none") return null;
  return catalogue.sources[mode] ?? null;
}

/**
 * Which tile covers a point, in the standard XYZ scheme every provider here uses.
 *
 * Needed because a background's availability has to be *asked*, not waited for: MapLibre does not
 * report a raster tile that 404s as a map error — the tile is simply never drawn — so a product
 * that wants to say "the reference map is unavailable" has to fetch one tile itself and look at
 * the answer. Pure, so the arithmetic is checked without a network or a browser.
 */
export function tileForLonLat(
  lon: number,
  lat: number,
  zoom: number,
): { readonly z: number; readonly x: number; readonly y: number } {
  const z = Math.max(0, Math.min(22, Math.trunc(zoom)));
  const scale = 2 ** z;
  const clampedLon = Math.max(-179.9999, Math.min(179.9999, lon));
  // Web Mercator is undefined at the poles; the usual cut-off keeps the projection finite.
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = (clampedLat * Math.PI) / 180;
  const x = Math.floor(((clampedLon + 180) / 360) * scale);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
  );
  const bound = (value: number) => Math.max(0, Math.min(scale - 1, value));
  return { z, x: bound(x), y: bound(y) };
}

/** One concrete tile URL from a template, for that probe and for nothing else. */
export function basemapTileUrl(
  source: BasemapTileSource,
  tile: { readonly z: number; readonly x: number; readonly y: number },
): string | null {
  const template = source.tiles[0];
  if (!template) return null;
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}
