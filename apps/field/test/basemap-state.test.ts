import { describe, expect, it } from "vitest";

import { basemapLoadState, showsProviderImagery } from "../src/core/basemap-state";

/**
 * "Configured" is not "loaded", and the screen may only claim the second.
 */
describe("basemapLoadState", () => {
  it("is none when there is no template at all", () => {
    expect(basemapLoadState({ configured: false, requested: 9, loaded: 9, failed: 0 })).toBe(
      "none",
    );
  });

  it("is loading while nothing has reported back", () => {
    expect(basemapLoadState({ configured: true, requested: 0, loaded: 0, failed: 0 })).toBe(
      "loading",
    );
    expect(basemapLoadState({ configured: true, requested: 9, loaded: 0, failed: 0 })).toBe(
      "loading",
    );
  });

  it("is unavailable when every tile that answered, failed — a 403 key looks like this", () => {
    expect(basemapLoadState({ configured: true, requested: 9, loaded: 0, failed: 9 })).toBe(
      "unavailable",
    );
    // And while the rest are still outstanding, it is not yet a verdict.
    expect(basemapLoadState({ configured: true, requested: 9, loaded: 0, failed: 3 })).toBe(
      "unavailable",
    );
  });

  it("is partial when some arrived and some did not", () => {
    expect(basemapLoadState({ configured: true, requested: 9, loaded: 4, failed: 5 })).toBe(
      "partial",
    );
    // Also partial while the remainder is outstanding: a reader can already see imagery, so
    // calling it "loading" would be the mirror of the lie this module exists to prevent.
    expect(basemapLoadState({ configured: true, requested: 9, loaded: 4, failed: 0 })).toBe(
      "partial",
    );
  });

  it("is available only when every requested tile arrived", () => {
    expect(basemapLoadState({ configured: true, requested: 9, loaded: 9, failed: 0 })).toBe(
      "available",
    );
  });

  it("requires the attribution exactly when the provider's imagery is on screen", () => {
    expect(showsProviderImagery("available")).toBe(true);
    expect(showsProviderImagery("partial")).toBe(true);
    for (const state of ["none", "loading", "unavailable"] as const) {
      expect(showsProviderImagery(state)).toBe(false);
    }
  });
});
