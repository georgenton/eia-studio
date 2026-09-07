import { describe, expect, it } from "vitest";

import {
  BASEMAP_MODE_LABEL,
  BASEMAP_MODES,
  basemapSourceFor,
  isBasemapModeAvailable,
  resolveBasemapCatalogue,
  basemapTileUrl,
  resolveInitialBasemapMode,
  tileForLonLat,
} from "../src/gis/basemap";

/**
 * The invariant these tests exist for: **no provider configured must cost the product nothing.**
 *
 * Everything else here is about keeping the basemap on its side of the line — reference, not
 * evidence — and about failing towards the neutral ground rather than towards an error.
 */
describe("what a deployment may offer as a background", () => {
  it("offers only the neutral ground when nothing is configured", () => {
    for (const env of [
      {},
      { provider: undefined },
      { provider: "none" },
      { provider: "" },
      { provider: "   " },
    ]) {
      const catalogue = resolveBasemapCatalogue(env);
      expect(catalogue.provider).toBe("none");
      expect(catalogue.modes).toEqual(["none"]);
      expect(catalogue.defaultMode).toBe("none");
      expect(basemapSourceFor(catalogue, "map")).toBeNull();
    }
  });

  it("treats a provider it does not know as no provider, rather than throwing", () => {
    // A misspelt or a since-removed provider name must not take the map surface down with it.
    const catalogue = resolveBasemapCatalogue({ provider: "gogle-maps", maptilerKey: "k" });
    expect(catalogue.provider).toBe("none");
    expect(catalogue.modes).toEqual(["none"]);
  });

  it("MapTiler without its key is the neutral ground, not a broken map", () => {
    for (const env of [
      { provider: "maptiler" },
      { provider: "maptiler", maptilerKey: "" },
      { provider: "maptiler", maptilerKey: "   " },
    ]) {
      expect(resolveBasemapCatalogue(env).provider).toBe("none");
    }
  });

  it("MapTiler with its key offers all four backgrounds", () => {
    const catalogue = resolveBasemapCatalogue({ provider: "MapTiler", maptilerKey: "abc123" });
    expect(catalogue.provider).toBe("maptiler");
    expect(catalogue.modes).toEqual(["none", "map", "satellite", "terrain"]);
    // Rural corridor: the relationships a reader wants are only visible on imagery (policy §4).
    expect(catalogue.defaultMode).toBe("satellite");
  });

  it("builds documented MapTiler endpoints and escapes the key into them", () => {
    const catalogue = resolveBasemapCatalogue({ provider: "maptiler", maptilerKey: "a b/c" });
    const satellite = basemapSourceFor(catalogue, "satellite")!;
    expect(satellite.tiles[0]).toMatch(
      /^https:\/\/api\.maptiler\.com\/tiles\/[a-z0-9-]+\/\{z\}\/\{x\}\/\{y\}\?key=/,
    );
    expect(basemapSourceFor(catalogue, "map")!.tiles[0]).toMatch(
      /^https:\/\/api\.maptiler\.com\/maps\/[a-z0-9-]+\/256\/\{z\}\/\{x\}\/\{y\}\.png\?key=/,
    );
    // A key with characters that would break a query string is encoded, not interpolated raw.
    expect(satellite.tiles[0]).toContain("key=a%20b%2Fc");
    expect(satellite.tiles[0]).not.toContain("key=a b/c");
  });

  it("carries the provider's attribution on every source it offers", () => {
    const catalogue = resolveBasemapCatalogue({ provider: "maptiler", maptilerKey: "k" });
    for (const mode of ["map", "satellite", "terrain"] as const) {
      const source = basemapSourceFor(catalogue, mode)!;
      expect(source.credits.length).toBeGreaterThan(0);
      expect(source.credits.map((c) => c.label).join(" ")).toContain("MapTiler");
    }
  });

  it("accepts a self-hosted XYZ template, and refuses one that is not a template", () => {
    const good = resolveBasemapCatalogue({
      provider: "custom",
      customTileUrl: "https://tiles.example.invalid/{z}/{x}/{y}.png",
      customAttribution: "Servicio de referencia",
    });
    expect(good.provider).toBe("custom");
    expect(good.modes).toEqual(["none", "map"]);
    expect(basemapSourceFor(good, "map")!.credits[0]?.label).toBe("Servicio de referencia");
    // Only what one tile URL can honestly offer: no satellite, no relief.
    expect(basemapSourceFor(good, "satellite")).toBeNull();

    for (const url of [undefined, "", "https://tiles.example.invalid/tiles.png"]) {
      expect(resolveBasemapCatalogue({ provider: "custom", customTileUrl: url }).provider).toBe(
        "none",
      );
    }
  });
});

describe("which background a reader opens on", () => {
  const configured = resolveBasemapCatalogue({ provider: "maptiler", maptilerKey: "k" });
  const neutral = resolveBasemapCatalogue({});

  it("remembers what they chose, when it is still on offer", () => {
    expect(resolveInitialBasemapMode(configured, "map")).toBe("map");
    expect(resolveInitialBasemapMode(configured, "none")).toBe("none");
  });

  it("falls back to the default rather than to an empty map", () => {
    // The key was withdrawn since they last chose satellite: they get what exists now.
    expect(resolveInitialBasemapMode(neutral, "satellite")).toBe("none");
    expect(resolveInitialBasemapMode(configured, "vector-hillshade-3d")).toBe("satellite");
    expect(resolveInitialBasemapMode(configured, null)).toBe("satellite");
    expect(resolveInitialBasemapMode(configured, undefined)).toBe("satellite");
  });

  it("never offers a mode the catalogue does not have", () => {
    for (const mode of BASEMAP_MODES) {
      if (isBasemapModeAvailable(neutral, mode)) expect(mode).toBe("none");
    }
  });
});

describe("what a reader is told", () => {
  it("names each background in the product's own language, never the provider's", () => {
    expect(BASEMAP_MODE_LABEL).toEqual({
      none: "Sin fondo",
      map: "Mapa",
      satellite: "Satélite",
      terrain: "Relieve",
    });
    for (const label of Object.values(BASEMAP_MODE_LABEL)) {
      expect(label.toLowerCase()).not.toContain("maptiler");
      expect(label.toLowerCase()).not.toContain("tile");
    }
  });
});

/**
 * Asking whether a background is actually there.
 *
 * MapLibre does not report a raster tile that answers 404 — the tile is simply never drawn, and
 * the map goes on looking like a map with nothing on it. So availability is asked with one real
 * tile request, and these are the coordinates that request is built from.
 */
describe("finding one tile to ask for", () => {
  it("puts a point in the right tile at the right zoom", () => {
    // Greenwich at the equator sits on the corner of the four z1 tiles.
    expect(tileForLonLat(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(tileForLonLat(-180, 85, 1)).toEqual({ z: 1, x: 0, y: 0 });
    // The study's corridor: south of the equator and west of Greenwich, so the lower-left quadrant.
    const tile = tileForLonLat(-78.72, -3.79, 10);
    expect(tile.z).toBe(10);
    expect(tile.x).toBeGreaterThan(0);
    expect(tile.x).toBeLessThan(1024);
    expect(tile.y).toBeGreaterThan(512);
  });

  it("never produces a tile outside the pyramid, whatever it is given", () => {
    for (const [lon, lat, z] of [
      [0, 90, 3],
      [0, -90, 3],
      [999, 999, 4],
      [-999, -999, 4],
      [0, 0, -5],
      [0, 0, 40],
    ] as const) {
      const tile = tileForLonLat(lon, lat, z);
      const scale = 2 ** tile.z;
      expect(tile.z).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(scale);
      expect(tile.y).toBeLessThan(scale);
    }
  });

  it("fills a template, and refuses one that has no tiles", () => {
    const catalogue = resolveBasemapCatalogue({
      provider: "custom",
      customTileUrl: "https://tiles.example.invalid/{z}/{x}/{y}.png",
    });
    const source = basemapSourceFor(catalogue, "map")!;
    expect(basemapTileUrl(source, { z: 10, x: 261, y: 528 })).toBe(
      "https://tiles.example.invalid/10/261/528.png",
    );
    expect(basemapTileUrl({ ...source, tiles: [] }, { z: 1, x: 0, y: 0 })).toBeNull();
  });
});
