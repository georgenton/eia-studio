import type { MapPosition } from "@eia/field-sync-contract";

import type { BoundingBox, ScreenPoint, Viewport } from "./map-projection";

/**
 * Web Mercator, because that is the projection raster tiles are cut in.
 *
 * ## Why this exists beside the equirectangular drawing aid
 *
 * `map-projection.ts` draws the study's own geometry on an empty ground, and for that an
 * equirectangular projection scaled by `cos(latitude)` is both sufficient and honest — over a
 * corridor a few kilometres long it is indistinguishable from anything fancier.
 *
 * A reference background is not geometry we draw; it is **images somebody else cut**, at fixed
 * positions in EPSG:3857. Drawing those images under an equirectangular overlay would put the
 * road a few metres off the road, growing with latitude and with the size of the view — the kind
 * of error that looks like a cartographic claim and is really an arithmetic mistake. So when
 * there are tiles, everything is projected the way the tiles are.
 *
 * The two are kept apart rather than merged because they answer different questions, and because
 * the offline croquis must keep working exactly as it does when no tile will ever arrive.
 *
 * ## The model
 *
 * One "world" square whose side is `256 · 2^zoom` pixels. A longitude/latitude maps into it by
 * the standard spherical formulas; a tile `z/x/y` is the 256-pixel square at `(x·256, y·256)`.
 * Everything else here is arithmetic on that square.
 */
export const TILE_SIZE = 256;

/** The limit of Web Mercator: beyond it the projection diverges and tiles do not exist. */
export const MERCATOR_MAX_LATITUDE = 85.05112878;

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export function worldSizeAt(zoom: number): number {
  return TILE_SIZE * Math.pow(2, zoom);
}

export function lonLatToWorld([lon, lat]: MapPosition, zoom: number): WorldPoint {
  const size = worldSizeAt(zoom);
  const clamped = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function worldToLonLat({ x, y }: WorldPoint, zoom: number): MapPosition {
  const size = worldSizeAt(zoom);
  const lon = (x / size) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (y / size);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lon, lat];
}

/** Metres per pixel at a latitude and zoom. The earth's circumference over the world's width. */
export function metresPerPixelAt(lat: number, zoom: number): number {
  const EQUATORIAL_CIRCUMFERENCE_M = 40_075_016.686;
  return (EQUATORIAL_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / worldSizeAt(zoom);
}

export interface MercatorView {
  readonly centre: MapPosition;
  readonly zoom: number;
  readonly viewport: Viewport;
  readonly toScreen: (position: MapPosition) => ScreenPoint;
  readonly toLonLat: (point: ScreenPoint) => MapPosition;
  readonly metresPerPixel: number;
}

export function viewOf(centre: MapPosition, zoom: number, viewport: Viewport): MercatorView {
  const origin = lonLatToWorld(centre, zoom);
  const halfWidth = viewport.width / 2;
  const halfHeight = viewport.height / 2;
  return {
    centre,
    zoom,
    viewport,
    metresPerPixel: metresPerPixelAt(centre[1], zoom),
    toScreen: (position) => {
      const world = lonLatToWorld(position, zoom);
      return { x: world.x - origin.x + halfWidth, y: world.y - origin.y + halfHeight };
    },
    toLonLat: ({ x, y }) =>
      worldToLonLat({ x: origin.x + x - halfWidth, y: origin.y + y - halfHeight }, zoom),
  };
}

/**
 * The zoom at which a box fits a viewport, and the centre of that box.
 *
 * Fractional zoom, deliberately: snapping to an integer would either overshoot the frame or waste
 * a factor of two of the screen, and the tile layer handles a fractional zoom by scaling the
 * tiles of the nearest integer level.
 */
export function fitBounds(
  box: BoundingBox,
  viewport: Viewport,
  options: { readonly maxZoom?: number } = {},
): { centre: MapPosition; zoom: number } {
  const centre: MapPosition = [(box.minLon + box.maxLon) / 2, (box.minLat + box.maxLat) / 2];
  const usableWidth = Math.max(viewport.width - viewport.padding * 2, 1);
  const usableHeight = Math.max(viewport.height - viewport.padding * 2, 1);

  // At zoom 0 the world is one tile; the span of the box in that world decides the scale.
  const sw = lonLatToWorld([box.minLon, box.minLat], 0);
  const ne = lonLatToWorld([box.maxLon, box.maxLat], 0);
  const spanX = Math.max(Math.abs(ne.x - sw.x), 1e-9);
  const spanY = Math.max(Math.abs(sw.y - ne.y), 1e-9);

  const zoom = Math.min(
    Math.log2(usableWidth / spanX),
    Math.log2(usableHeight / spanY),
    options.maxZoom ?? 19,
  );
  return { centre, zoom: Math.max(0, zoom) };
}

export interface PlacedTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Where to put it on screen, and how big to draw it at this fractional zoom. */
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly key: string;
}

/**
 * The tiles covering a view, at the nearest integer zoom, scaled to the fractional one.
 *
 * Bounded by construction: the loop runs over the tiles the viewport actually intersects, and a
 * ceiling refuses to emit more than `maxTiles` — a guard rather than a feature, because a bad
 * zoom computation asking for ten thousand images would take a phone down.
 *
 * Tiles outside the world in `y` are skipped (there is no north of the north pole); `x` wraps,
 * which is what makes a map scrollable past the antimeridian.
 */
export function tilesFor(view: MercatorView, maxTiles = 64): ReadonlyArray<PlacedTile> {
  const z = Math.max(0, Math.round(view.zoom));
  const scale = Math.pow(2, view.zoom - z);
  const drawn = TILE_SIZE * scale;
  const origin = lonLatToWorld(view.centre, z);
  const left = origin.x - view.viewport.width / 2 / scale;
  const top = origin.y - view.viewport.height / 2 / scale;

  const count = Math.pow(2, z);
  const minX = Math.floor(left / TILE_SIZE);
  const maxX = Math.floor((left + view.viewport.width / scale) / TILE_SIZE);
  const minY = Math.floor(top / TILE_SIZE);
  const maxY = Math.floor((top + view.viewport.height / scale) / TILE_SIZE);

  const tiles: PlacedTile[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    if (y < 0 || y >= count) continue;
    for (let x = minX; x <= maxX; x += 1) {
      if (tiles.length >= maxTiles) return tiles;
      const wrapped = ((x % count) + count) % count;
      tiles.push({
        z,
        x: wrapped,
        y,
        left: (x * TILE_SIZE - left) * scale,
        top: (y * TILE_SIZE - top) * scale,
        size: drawn,
        key: `${z}/${wrapped}/${y}`,
      });
    }
  }
  return tiles;
}

/** `https://…/{z}/{x}/{y}.jpg` with the numbers substituted. Nothing else is interpolated. */
export function tileUrl(template: string, tile: PlacedTile): string {
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}
