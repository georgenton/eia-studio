import type { MapPosition } from "@eia/field-sync-contract";

/**
 * Turning longitude and latitude into points on a phone screen, without a tile provider.
 *
 * ## Why this exists at all
 *
 * The map a technician needs offline is **the project's own geometry**: the parcel they were sent
 * to, the axis for context, the kilometre posts, and their own position. None of that needs a
 * basemap, and a basemap is the part that cannot legally or practically be taken offline — bulk
 * downloading a provider's tiles is a licence question with one answer, and screenshots of a
 * provider's map are not a cartographic package. So the map is drawn, from vectors, by this
 * application.
 *
 * What is lost is honest to state: there is no satellite imagery and no street names. What is
 * gained is that it works in a ravine with no signal, after a force-stop, a week after the
 * download.
 *
 * ## The projection, and why this one
 *
 * An equirectangular projection with the longitude axis scaled by `cos(latitude)` at the centre of
 * the view. Over a corridor a few kilometres long it is indistinguishable from anything fancier,
 * and it has the property that matters here: **it is conformal enough locally that the scale bar
 * means one thing in both directions**, so a distance read off the screen is a distance on the
 * ground to within a fraction of a percent.
 *
 * It is not a cartographic projection anybody should quote. It is a drawing aid for a phone, and
 * the product says so rather than printing a CRS beside it.
 *
 * ## When this is *not* the projection used
 *
 * The moment there is a reference background. Raster tiles are cut in Web Mercator at fixed
 * positions, and drawing them under an equirectangular overlay would put the road a few metres
 * off the road. `mercator.ts` is the projection for that case, and the screen uses it whenever a
 * background is configured — the croquis and the backed map are then the same arithmetic, which
 * is the only way the two can agree about where a parcel is.
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** Pixels kept clear on every side, so a parcel on the edge is not clipped by the frame. */
  readonly padding: number;
}

export interface BoundingBox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** The smallest box containing every position given. Null when there are none. */
export function boundsOf(positions: ReadonlyArray<MapPosition>): BoundingBox | null {
  if (positions.length === 0) return null;
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of positions) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Grow a box by a fraction of its own size, so the content does not touch the frame. */
export function padBounds(box: BoundingBox, fraction: number): BoundingBox {
  const lonSpan = Math.max(box.maxLon - box.minLon, 1e-6);
  const latSpan = Math.max(box.maxLat - box.minLat, 1e-6);
  return {
    minLon: box.minLon - lonSpan * fraction,
    maxLon: box.maxLon + lonSpan * fraction,
    minLat: box.minLat - latSpan * fraction,
    maxLat: box.maxLat + latSpan * fraction,
  };
}

const METRES_PER_DEGREE_LATITUDE = 111_320;

export interface Projection {
  readonly toScreen: (position: MapPosition) => ScreenPoint;
  /** Metres per screen pixel, for the scale bar. Equal in both axes by construction. */
  readonly metresPerPixel: number;
  readonly centre: MapPosition;
}

/**
 * Fit a bounding box into a viewport, preserving shape.
 *
 * **One scale for both axes.** Stretching to fill the viewport would be easier and would make
 * every parcel the wrong shape and the scale bar a lie in one direction; the smaller of the two
 * scales is used and the spare space becomes margin.
 */
export function projectionFor(box: BoundingBox, viewport: Viewport): Projection {
  const centreLat = (box.minLat + box.maxLat) / 2;
  const centreLon = (box.minLon + box.maxLon) / 2;
  /*
   * A degree of longitude is `cos(latitude)` of a degree of latitude in metres. Taking the cosine
   * at the centre of the view — rather than per point — is what keeps straight lines straight;
   * over a corridor the error at the edges is far below a pixel.
   */
  const lonScale = Math.cos((centreLat * Math.PI) / 180);

  const lonSpanM =
    Math.max((box.maxLon - box.minLon) * lonScale, 1e-9) * METRES_PER_DEGREE_LATITUDE;
  const latSpanM = Math.max(box.maxLat - box.minLat, 1e-9) * METRES_PER_DEGREE_LATITUDE;

  const usableWidth = Math.max(viewport.width - viewport.padding * 2, 1);
  const usableHeight = Math.max(viewport.height - viewport.padding * 2, 1);

  const pixelsPerMetre = Math.min(usableWidth / lonSpanM, usableHeight / latSpanM);
  const metresPerPixel = 1 / pixelsPerMetre;

  return {
    centre: [centreLon, centreLat],
    metresPerPixel,
    toScreen: ([lon, lat]) => {
      const eastM = (lon - centreLon) * lonScale * METRES_PER_DEGREE_LATITUDE;
      const northM = (lat - centreLat) * METRES_PER_DEGREE_LATITUDE;
      return {
        x: viewport.width / 2 + eastM * pixelsPerMetre,
        // Screen y grows downwards; north does not.
        y: viewport.height / 2 - northM * pixelsPerMetre,
      };
    },
  };
}

/**
 * A round number of metres that fits in roughly a third of the viewport, for the scale bar.
 *
 * 1-2-5 steps, which is what every map does, so the bar reads as a measurement rather than as an
 * arbitrary width.
 */
export function scaleBarMetres(metresPerPixel: number, viewportWidth: number): number {
  const target = metresPerPixel * (viewportWidth / 3);
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1))));
  for (const step of [1, 2, 5, 10]) {
    if (magnitude * step >= target) return magnitude * step;
  }
  return magnitude * 10;
}

/** `850 m` or `2,4 km`, in the notation of the product's default locale. */
export function formatScale(metres: number): string {
  if (metres >= 1000) {
    const km = metres / 1000;
    const text = Number.isInteger(km) ? String(km) : km.toFixed(1).replace(".", ",");
    return `${text} km`;
  }
  return `${Math.round(metres)} m`;
}
