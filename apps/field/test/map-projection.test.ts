import type { MapPosition } from "@eia/field-sync-contract";
import { describe, expect, it } from "vitest";

import {
  boundsOf,
  formatScale,
  padBounds,
  projectionFor,
  scaleBarMetres,
} from "../src/core/map-projection";

/**
 * The drawing aid the offline map rests on.
 *
 * There is no tile provider and no basemap: bulk-downloading a provider's tiles is a licence
 * question with one answer, and a screenshot is not a cartographic package. So the map is the
 * project's own geometry, drawn by the application — which makes this arithmetic the thing that
 * has to be right, because a scale bar and a north arrow over a stretched projection are two
 * confident lies.
 */
const CORRIDOR: ReadonlyArray<MapPosition> = [
  [-78.72, -3.79],
  [-78.62, -3.79],
  [-78.62, -3.785],
];

describe("the bounds of what is drawn", () => {
  it("is the smallest box containing every position", () => {
    expect(boundsOf(CORRIDOR)).toEqual({
      minLon: -78.72,
      maxLon: -78.62,
      minLat: -3.79,
      maxLat: -3.785,
    });
  });

  it("is null when there is nothing to draw", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("grows by a fraction of its own size, so content does not touch the frame", () => {
    const padded = padBounds({ minLon: -1, maxLon: 1, minLat: -2, maxLat: 2 }, 0.1);
    expect(padded.minLon).toBeCloseTo(-1.2, 6);
    expect(padded.maxLat).toBeCloseTo(2.4, 6);
  });
});

describe("fitting it on a screen", () => {
  const viewport = { width: 320, height: 320, padding: 16 };

  it("puts the centre of the box at the centre of the viewport", () => {
    const box = boundsOf(CORRIDOR)!;
    const projection = projectionFor(box, viewport);
    const middle = projection.toScreen([
      (box.minLon + box.maxLon) / 2,
      (box.minLat + box.maxLat) / 2,
    ]);
    expect(middle.x).toBeCloseTo(160, 6);
    expect(middle.y).toBeCloseTo(160, 6);
  });

  it("puts north up: a higher latitude is a smaller y", () => {
    const projection = projectionFor(boundsOf(CORRIDOR)!, viewport);
    const south = projection.toScreen([-78.67, -3.79]);
    const north = projection.toScreen([-78.67, -3.785]);
    expect(north.y).toBeLessThan(south.y);
  });

  it("puts east right: a higher longitude is a larger x", () => {
    const projection = projectionFor(boundsOf(CORRIDOR)!, viewport);
    expect(projection.toScreen([-78.62, -3.79]).x).toBeGreaterThan(
      projection.toScreen([-78.72, -3.79]).x,
    );
  });

  /**
   * The property the scale bar depends on. A projection that stretched to fill the viewport would
   * make every parcel the wrong shape and the bar correct in one direction only.
   */
  it("uses one scale for both axes, so a square on the ground is a square on screen", () => {
    // A box one hundred metres on a side, near the equator where the two spans differ most.
    const metre = 1 / 111_320;
    const side = 100 * metre;
    const box = { minLon: -78.7, maxLon: -78.7 + side, minLat: 0, maxLat: side };
    const projection = projectionFor(box, { width: 400, height: 200, padding: 0 });

    const a = projection.toScreen([box.minLon, box.minLat]);
    const b = projection.toScreen([box.maxLon, box.minLat]);
    const c = projection.toScreen([box.minLon, box.maxLat]);
    const widthPx = Math.abs(b.x - a.x);
    const heightPx = Math.abs(c.y - a.y);
    // At the equator cos(lat) = 1, so a square of ground is a square of pixels.
    expect(widthPx).toBeCloseTo(heightPx, 3);
    // And it fits the shorter axis, leaving the spare space as margin rather than stretching.
    expect(heightPx).toBeCloseTo(200, 0);
  });

  /**
   * Away from the equator a degree of longitude is shorter than a degree of latitude. The
   * projection scales longitude by `cos(latitude)`, so the same ground distance is the same number
   * of pixels in either direction — which is what lets one scale bar describe both.
   */
  it("scales longitude by the cosine of the latitude", () => {
    const latitude = -45;
    const metre = 1 / 111_320;
    // A hundred metres east at this latitude spans more degrees than a hundred metres north.
    const eastDegrees = (100 * metre) / Math.cos((latitude * Math.PI) / 180);
    const box = {
      minLon: 0,
      maxLon: eastDegrees,
      minLat: latitude,
      maxLat: latitude + 100 * metre,
    };
    const projection = projectionFor(box, { width: 300, height: 300, padding: 0 });
    const a = projection.toScreen([box.minLon, box.minLat]);
    const b = projection.toScreen([box.maxLon, box.minLat]);
    const c = projection.toScreen([box.minLon, box.maxLat]);
    expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(c.y - a.y), 2);
  });

  it("reports metres per pixel, which is what the scale bar is drawn from", () => {
    const metre = 1 / 111_320;
    const box = { minLon: 0, maxLon: 0, minLat: 0, maxLat: 1000 * metre };
    const projection = projectionFor(box, { width: 200, height: 200, padding: 0 });
    // A thousand metres across two hundred pixels.
    expect(projection.metresPerPixel).toBeCloseTo(5, 1);
  });
});

describe("the scale bar", () => {
  it("picks a round number in 1-2-5 steps", () => {
    expect([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]).toContain(
      scaleBarMetres(5, 300),
    );
    expect(scaleBarMetres(0.1, 300)).toBeLessThanOrEqual(50);
    expect(scaleBarMetres(50, 300)).toBeGreaterThanOrEqual(5000);
  });

  it("never asks for a bar wider than the space it has", () => {
    for (const metresPerPixel of [0.05, 0.5, 2, 17, 140]) {
      const metres = scaleBarMetres(metresPerPixel, 300);
      expect(metres / metresPerPixel).toBeLessThanOrEqual(300);
    }
  });

  it("writes metres below a kilometre and kilometres above, with a decimal comma", () => {
    expect(formatScale(850)).toBe("850 m");
    expect(formatScale(1000)).toBe("1 km");
    expect(formatScale(2400)).toBe("2,4 km");
  });
});
