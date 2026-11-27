import { describe, expect, it } from "vitest";

import {
  fitBounds,
  lonLatToWorld,
  metresPerPixelAt,
  TILE_SIZE,
  tilesFor,
  tileUrl,
  viewOf,
  worldToLonLat,
} from "../src/core/mercator";

/**
 * The projection the reference tiles are cut in.
 *
 * These are arithmetic assertions against published, checkable values rather than against
 * whatever the implementation happens to produce — the point of a projection is that somebody
 * else already decided what the right answer is.
 */
describe("Web Mercator", () => {
  it("puts the origin of the world where the specification does", () => {
    // 0°,0° is the exact centre of the world square at every zoom.
    for (const zoom of [0, 1, 10, 18]) {
      const size = TILE_SIZE * 2 ** zoom;
      const { x, y } = lonLatToWorld([0, 0], zoom);
      expect(x).toBeCloseTo(size / 2, 6);
      expect(y).toBeCloseTo(size / 2, 6);
    }
  });

  it("puts the pilot's corridor in the tile the provider would serve", () => {
    /*
     * The canonical slippy-tile formula, computed independently here: for 10/‑78.74/‑3.82 the
     * tile is x = floor((lon+180)/360 · 2^z) and y from the Mercator latitude. If the module and
     * this disagree, one of them is wrong about where the imagery is.
     */
    const zoom = 10;
    const lon = -78.742127;
    const lat = -3.817727;
    const n = 2 ** zoom;
    const expectedX = Math.floor(((lon + 180) / 360) * n);
    const rad = (lat * Math.PI) / 180;
    const expectedY = Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
    );

    const world = lonLatToWorld([lon, lat], zoom);
    expect(Math.floor(world.x / TILE_SIZE)).toBe(expectedX);
    expect(Math.floor(world.y / TILE_SIZE)).toBe(expectedY);
  });

  it("round-trips a position through the world square", () => {
    const original: [number, number] = [-78.742127, -3.817727];
    const back = worldToLonLat(lonLatToWorld(original, 14), 14);
    expect(back[0]).toBeCloseTo(original[0], 9);
    expect(back[1]).toBeCloseTo(original[1], 9);
  });

  it("agrees with the published resolution at the equator", () => {
    // The textbook figure: 156 543,03 m/px at zoom 0, halving each level.
    expect(metresPerPixelAt(0, 0)).toBeCloseTo(156_543.03, 1);
    expect(metresPerPixelAt(0, 10)).toBeCloseTo(152.874, 2);
  });

  it("clamps beyond the projection's limit instead of diverging", () => {
    const beyond = lonLatToWorld([0, 89.9], 5);
    const atLimit = lonLatToWorld([0, 85.05112878], 5);
    expect(Number.isFinite(beyond.y)).toBe(true);
    expect(beyond.y).toBeCloseTo(atLimit.y, 3);
  });

  it("frames a box inside the viewport, with its padding respected", () => {
    const box = { minLon: -78.75, minLat: -3.83, maxLon: -78.73, maxLat: -3.81 };
    const viewport = { width: 320, height: 320, padding: 16 };
    const { centre, zoom } = fitBounds(box, viewport);
    expect(centre[0]).toBeCloseTo(-78.74, 6);

    // Both corners land inside the usable area.
    const view = viewOf(centre, zoom, viewport);
    for (const corner of [
      [box.minLon, box.minLat],
      [box.maxLon, box.maxLat],
    ] as Array<[number, number]>) {
      const { x, y } = view.toScreen(corner);
      expect(x).toBeGreaterThanOrEqual(viewport.padding - 1);
      expect(x).toBeLessThanOrEqual(viewport.width - viewport.padding + 1);
      expect(y).toBeGreaterThanOrEqual(viewport.padding - 1);
      expect(y).toBeLessThanOrEqual(viewport.height - viewport.padding + 1);
    }
  });

  it("covers the viewport with tiles, and refuses to ask for an unbounded number", () => {
    const view = viewOf([-78.74, -3.82], 14, { width: 320, height: 420, padding: 0 });
    const tiles = tilesFor(view);
    expect(tiles.length).toBeGreaterThan(0);

    // Every pixel of the viewport is inside some tile's rectangle.
    const probes: Array<[number, number]> = [
      [0, 0],
      [319, 419],
      [160, 210],
    ];
    for (const [px, py] of probes) {
      const covering = tiles.find(
        (t) => px >= t.left && px < t.left + t.size && py >= t.top && py < t.top + t.size,
      );
      expect(covering, `pixel ${px},${py} is covered`).toBeDefined();
    }

    /*
     * The guard. A bad zoom is an arithmetic mistake, and the symptom of this one would be a
     * phone asking a provider for thousands of images — which is both a dead handset and a bill.
     */
    const absurd = viewOf([-78.74, -3.82], 2, { width: 4000, height: 4000, padding: 0 });
    expect(tilesFor(absurd, 24).length).toBeLessThanOrEqual(24);
  });

  it("builds a tile URL by substitution and nothing else", () => {
    const view = viewOf([-78.74, -3.82], 12, { width: 256, height: 256, padding: 0 });
    const tile = tilesFor(view)[0]!;
    const url = tileUrl("https://example.invalid/{z}/{x}/{y}.jpg", tile);
    expect(url).toBe(`https://example.invalid/${tile.z}/${tile.x}/${tile.y}.jpg`);
    // No stray placeholder survived, and nothing else was interpolated into it.
    expect(url).not.toContain("{");
  });
});
