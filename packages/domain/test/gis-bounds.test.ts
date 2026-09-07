import { describe, expect, it } from "vitest";

import { geometryBounds, unionBounds } from "../src/gis/bounds";

/**
 * The defect this file exists for.
 *
 * `loadParcelExplorer` computed the map's opening extent by walking a parcel's coordinates two
 * levels deep — `for (const ring of coordinates) for (const [x, y] of ring)` — which is the shape
 * of a `Polygon` and **not** the shape of a `MultiPolygon`. Twenty of the study's 141 parcels are
 * multi-part (ADR-023), so on the real data `[x, y]` destructured two *rings* rather than two
 * numbers, `Math.min` was handed an array, and the accumulator became `NaN`.
 *
 * `NaN` is contagious: one multi-part parcel poisoned the extent of all 141. The read model
 * returned `bounds: null`, the map fell back to `center [0, 0], zoom 1`, and a consultant opening
 * *Cartografía y predios* saw an empty grey square with Zamora several thousand kilometres away.
 *
 * The two tests marked **REGRESSION** below fail against that algorithm and pass against this one.
 */

/** A single-part parcel: `Polygon` → coordinates nest three deep. */
const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-78.75, -3.85],
      [-78.74, -3.85],
      [-78.74, -3.84],
      [-78.75, -3.84],
      [-78.75, -3.85],
    ],
  ],
} as const;

/** A multi-part parcel: `MultiPolygon` → coordinates nest four deep. This is what broke it. */
const MULTI_POLYGON = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-78.73, -3.83],
        [-78.72, -3.83],
        [-78.72, -3.82],
        [-78.73, -3.82],
        [-78.73, -3.83],
      ],
    ],
    [
      [
        [-78.71, -3.81],
        [-78.7, -3.81],
        [-78.7, -3.8],
        [-78.71, -3.8],
        [-78.71, -3.81],
      ],
    ],
  ],
} as const;

const LINE_STRING = {
  type: "LineString",
  coordinates: [
    [-78.8, -3.9],
    [-78.7, -3.8],
  ],
} as const;

const MULTI_LINE_STRING = {
  type: "MultiLineString",
  coordinates: [
    [
      [-78.8, -3.9],
      [-78.75, -3.85],
    ],
    [
      [-78.7, -3.8],
      [-78.65, -3.75],
    ],
  ],
} as const;

describe("the extent of one geometry", () => {
  it("frames a Polygon", () => {
    expect(geometryBounds(POLYGON)).toEqual([-78.75, -3.85, -78.74, -3.84]);
  });

  it("REGRESSION · frames a MultiPolygon instead of returning nothing", () => {
    const bounds = geometryBounds(MULTI_POLYGON);
    expect(bounds).not.toBeNull();
    // Every number is finite: the failure mode was `NaN`, which `toEqual` alone would not name.
    for (const value of bounds!) expect(Number.isFinite(value)).toBe(true);
    expect(bounds).toEqual([-78.73, -3.83, -78.7, -3.8]);
  });

  it("frames a LineString and a MultiLineString", () => {
    expect(geometryBounds(LINE_STRING)).toEqual([-78.8, -3.9, -78.7, -3.8]);
    expect(geometryBounds(MULTI_LINE_STRING)).toEqual([-78.8, -3.9, -78.65, -3.75]);
  });

  it("frames a Point and a MultiPoint, which are degenerate but not invalid", () => {
    expect(geometryBounds({ type: "Point", coordinates: [-78.7, -3.8] })).toEqual([
      -78.7, -3.8, -78.7, -3.8,
    ]);
    expect(
      geometryBounds({
        type: "MultiPoint",
        coordinates: [
          [-78.8, -3.9],
          [-78.7, -3.8],
        ],
      }),
    ).toEqual([-78.8, -3.9, -78.7, -3.8]);
  });

  it("keeps the elevation of a position out of the extent", () => {
    // A `[x, y, z]` position is legal GeoJSON, and its third number is not a latitude.
    expect(
      geometryBounds({
        type: "LineString",
        coordinates: [
          [-78.8, -3.9, 950],
          [-78.7, -3.8, 1010],
        ],
      }),
    ).toEqual([-78.8, -3.9, -78.7, -3.8]);
  });

  it("returns null rather than a broken extent when there is nothing to frame", () => {
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds(undefined)).toBeNull();
    expect(geometryBounds({ type: "Polygon", coordinates: [] })).toBeNull();
    expect(geometryBounds({ type: "MultiPolygon", coordinates: [[]] })).toBeNull();
    expect(geometryBounds("not a geometry")).toBeNull();
  });

  it("ignores positions that are not two finite numbers", () => {
    // NaN, Infinity, nulls and short positions are skipped rather than propagated: one bad row in
    // an import must not decide where the camera opens.
    expect(
      geometryBounds({
        type: "MultiPoint",
        coordinates: [
          [-78.8, -3.9],
          [Number.NaN, -3.8],
          [-78.7, Number.POSITIVE_INFINITY],
          [-78.6],
          [null, null],
          ["-78.5", "-3.7"],
          [-78.7, -3.8],
        ],
      }),
    ).toEqual([-78.8, -3.9, -78.7, -3.8]);
  });
});

describe("the extent of several geometries", () => {
  it("REGRESSION · one multi-part parcel does not poison the extent of the rest", () => {
    // The shape of the bug: a mixed set, exactly as the 141 real parcels are mixed.
    const bounds = unionBounds([POLYGON, MULTI_POLYGON, POLYGON]);
    expect(bounds).not.toBeNull();
    for (const value of bounds!) expect(Number.isFinite(value)).toBe(true);
    expect(bounds).toEqual([-78.75, -3.85, -78.7, -3.8]);
  });

  it("skips what it cannot frame, and returns null only when nothing framed", () => {
    expect(unionBounds([null, POLYGON])).toEqual([-78.75, -3.85, -78.74, -3.84]);
    expect(unionBounds([])).toBeNull();
    expect(unionBounds([null, undefined, { type: "Polygon", coordinates: [] }])).toBeNull();
  });
});

/**
 * The algorithm that shipped, kept as a specimen.
 *
 * Not a test of anything the product still does — it is the proof that the defect was real and the
 * reason the utility above recurses instead of indexing. Delete it only if the story stops being
 * worth telling.
 */
describe("the algorithm this replaced", () => {
  function twoLevelsDeep(
    geometries: ReadonlyArray<{ readonly coordinates: unknown }>,
  ): readonly [number, number, number, number] | null {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const geometry of geometries) {
      for (const ring of geometry.coordinates as number[][][]) {
        for (const [x, y] of ring) {
          if (x === undefined || y === undefined) continue;
          west = Math.min(west, x);
          east = Math.max(east, x);
          south = Math.min(south, y);
          north = Math.max(north, y);
        }
      }
    }
    return Number.isFinite(west) ? [west, south, east, north] : null;
  }

  it("was right about a Polygon, which is why nothing caught it", () => {
    expect(twoLevelsDeep([POLYGON])).toEqual([-78.75, -3.85, -78.74, -3.84]);
    expect(geometryBounds(POLYGON)).toEqual(twoLevelsDeep([POLYGON]));
  });

  it("handed a ring to Math.min on a MultiPolygon, and returned no extent at all", () => {
    expect(twoLevelsDeep([MULTI_POLYGON])).toBeNull();
    // And one multi-part parcel was enough: NaN survives every later comparison.
    expect(twoLevelsDeep([POLYGON, MULTI_POLYGON, POLYGON])).toBeNull();
    expect(unionBounds([POLYGON, MULTI_POLYGON, POLYGON])).not.toBeNull();
  });
});
