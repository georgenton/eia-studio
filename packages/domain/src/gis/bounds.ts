/**
 * The extent of a GeoJSON geometry, whatever shape it nests its numbers in.
 *
 * ## Why this is a utility and not four `if`s
 *
 * GeoJSON puts positions at a different depth per type — a `Point` one level, a `LineString` and
 * a `Polygon`'s ring two, a `Polygon` three, a `MultiPolygon` four — and code that indexes to a
 * *fixed* depth is correct for exactly the type its author had in front of them. That is how the
 * map's opening extent came to be computed with `for (const ring of coordinates) for (const
 * [x, y] of ring)`: right for the generated single-part polygons, and on the study's real
 * cartography — where 20 of 141 parcels are multi-part (ADR-023) — a destructuring of two *rings*
 * into two numbers. `Math.min` was handed an array, returned `NaN`, and `NaN` then won every
 * subsequent comparison: one multi-part parcel emptied the map for all of them.
 *
 * So this walks down to the numbers instead of assuming where they are. It cannot be wrong about a
 * type it has not been told about, which is the property the fixed-depth version lacked.
 *
 * ## What counts as a position
 *
 * Two finite numbers, and only the first two: a `[x, y, z]` position is legal GeoJSON and its
 * third number is an elevation, not a latitude. Anything else — `NaN`, `Infinity`, `null`, a
 * string, a one-element array — is **skipped rather than propagated**, because one malformed row
 * in an import must not decide where the camera opens. An extent is `null` only when there was
 * nothing to frame at all, which the caller must handle: a `null` extent is honest, a `[0, 0]`
 * fallback is a map of the Gulf of Guinea.
 *
 * No dependency. Turf would do this and a great deal else; a recursive walk is fifteen lines.
 */

/** `[west, south, east, north]`, the order MapLibre's `fitBounds` and `LngLatBounds` take. */
export type GeoBounds = readonly [number, number, number, number];

/** Whether a value is a usable `[x, y]` position, ignoring any elevation after it. */
function positionOf(node: unknown): readonly [number, number] | null {
  if (!Array.isArray(node)) return null;
  const [x, y] = node;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

/**
 * Every position inside an arbitrarily nested coordinate structure, in document order.
 *
 * Exported because a caller that needs a centroid or a count should not re-implement the walk.
 */
export function collectPositions(coordinates: unknown): ReadonlyArray<readonly [number, number]> {
  const positions: Array<readonly [number, number]> = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    const position = positionOf(node);
    if (position) {
      positions.push(position);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(coordinates);
  return positions;
}

/** The extent of a coordinate structure, or `null` when it holds no usable position. */
export function coordinatesBounds(coordinates: unknown): GeoBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of collectPositions(coordinates)) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/**
 * The extent of a geometry — `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`,
 * `MultiPolygon`, or a `GeometryCollection` — or `null` when it frames nothing.
 */
export function geometryBounds(geometry: unknown): GeoBounds | null {
  if (!geometry || typeof geometry !== "object") return null;
  const candidate = geometry as { coordinates?: unknown; geometries?: unknown };
  if (Array.isArray(candidate.geometries)) return unionBounds(candidate.geometries);
  return coordinatesBounds(candidate.coordinates);
}

/** The extent covering every geometry given, skipping those that frame nothing. */
export function unionBounds(geometries: ReadonlyArray<unknown>): GeoBounds | null {
  let union: GeoBounds | null = null;
  for (const geometry of geometries) {
    union = extendBounds(union, geometryBounds(geometry));
  }
  return union;
}

/** The extent covering both, treating a missing one as nothing to cover. */
export function extendBounds(a: GeoBounds | null, b: GeoBounds | null): GeoBounds | null {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
