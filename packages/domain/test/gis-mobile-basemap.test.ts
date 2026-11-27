import { resolveMobileBasemap } from "@eia/domain";
import { describe, expect, it } from "vitest";

/**
 * The background a **phone** may be given, and the key it may not be given.
 *
 * The browser key is restricted at the provider by allowed HTTP origin. A native application
 * sends no `Referer`, so that key answers 403 from a phone — verified against the provider on
 * 26 November 2026 rather than inferred. The failure mode this guards against is the tempting
 * one: reusing the key that is already configured, and shipping a map that silently never paints.
 */
describe("resolveMobileBasemap", () => {
  it("offers nothing when only the browser key is configured", () => {
    /*
     * The assertion that matters. A deployment with a working web map and no mobile key must
     * give the device **null**, so it draws its croquis and says so — not a tile URL that will
     * 403 on every request.
     */
    expect(
      resolveMobileBasemap({ provider: "maptiler", maptilerKey: "browser-key-only" }),
    ).toBeNull();
  });

  it("offers imagery once a mobile key exists, and carries the key in the template", () => {
    const basemap = resolveMobileBasemap({
      provider: "maptiler",
      maptilerKey: "browser-key",
      maptilerMobileKey: "mobile-key",
    });
    expect(basemap).not.toBeNull();
    expect(basemap!.tileUrl).toContain("{z}");
    expect(basemap!.tileUrl).toContain("{x}");
    expect(basemap!.tileUrl).toContain("{y}");
    expect(basemap!.tileUrl).toContain("key=mobile-key");
    // Never the browser key, whose restriction makes it useless here.
    expect(basemap!.tileUrl).not.toContain("browser-key");
    expect(basemap!.attribution).toMatch(/MapTiler/);
  });

  it("offers nothing when no provider is configured at all", () => {
    expect(resolveMobileBasemap({})).toBeNull();
    expect(resolveMobileBasemap({ provider: "none", maptilerMobileKey: "x" })).toBeNull();
  });

  it("accepts a self-hosted service by its template, and refuses one that is not a template", () => {
    const custom = resolveMobileBasemap({
      provider: "custom",
      customTileUrl: "https://tiles.example.invalid/{z}/{x}/{y}.png",
      customAttribution: "Servicio propio",
    });
    expect(custom?.tileUrl).toBe("https://tiles.example.invalid/{z}/{x}/{y}.png");
    expect(custom?.attribution).toBe("Servicio propio");
    // A URL with no placeholders cannot serve tiles, and is refused rather than requested once.
    expect(
      resolveMobileBasemap({
        provider: "custom",
        customTileUrl: "https://example.invalid/map.png",
      }),
    ).toBeNull();
  });
});
