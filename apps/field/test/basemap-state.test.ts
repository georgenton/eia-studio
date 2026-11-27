import { describe, expect, it } from "vitest";

import {
  basemapLoadState,
  carryOverOutcomes,
  countVisible,
  recordTileResult,
  showsProviderImagery,
  tileSetKeyOf,
  type TileOutcomes,
} from "../src/core/basemap-state";

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

/**
 * The frame the notice is about.
 *
 * `Image` answers whenever the platform gets round to it, which may be after the technician has
 * panned. These four steps are the sequence that used to produce a false notice in both
 * directions, and they are run here as a sequence rather than as four independent assertions,
 * because the defect was in the transitions and not in any single state.
 */
describe("which tiles the background notice counts", () => {
  const stateOf = (keys: ReadonlyArray<string>, outcomes: TileOutcomes) => {
    const seen = countVisible(keys, outcomes.byTile);
    return basemapLoadState({
      configured: true,
      requested: keys.length,
      loaded: seen.loaded,
      failed: seen.failed,
    });
  };

  it("keeps a still-mounted tile's verdict, ignores a late answer from one that is gone", () => {
    // ---- frame 1: [A, B]; both load.
    const first = ["A", "B"];
    let outcomes: TileOutcomes = { attempt: 0, forSet: tileSetKeyOf(0, first), byTile: {} };
    outcomes = recordTileResult(outcomes, {
      forSet: outcomes.forSet,
      tileKey: "A",
      result: "ok",
    });
    outcomes = recordTileResult(outcomes, {
      forSet: outcomes.forSet,
      tileKey: "B",
      result: "ok",
    });
    expect(stateOf(first, outcomes)).toBe("available");

    // ---- frame 2: [B, C]. B is the same `Image`, still mounted and already loaded — it will
    // never fire `onLoad` again, so its verdict has to survive the move. Discarding it was what
    // made a complete background read as partial.
    const second = ["B", "C"];
    const carried = carryOverOutcomes(outcomes, { attempt: 0, tileKeys: second });
    outcomes = { attempt: 0, forSet: tileSetKeyOf(0, second), byTile: carried };
    expect(outcomes.byTile).toEqual({ B: "ok" });
    // C has not answered yet: one of two arrived, which is partial and not a failure.
    expect(stateOf(second, outcomes)).toBe("partial");

    // ---- A answers late, with the set it was rendered for. It is not on screen any more.
    const late = recordTileResult(outcomes, {
      forSet: tileSetKeyOf(0, first),
      tileKey: "A",
      result: "fail",
    });
    expect(late).toBe(outcomes);
    expect(stateOf(second, late)).toBe("partial");

    // ---- and even a report that somehow carried the current set key cannot count a tile the
    // frame is not asking for.
    const strayKey = recordTileResult(outcomes, {
      forSet: outcomes.forSet,
      tileKey: "A",
      result: "fail",
    });
    expect(stateOf(second, strayKey)).toBe("partial");

    // ---- C arrives: complete.
    outcomes = recordTileResult(outcomes, {
      forSet: outcomes.forSet,
      tileKey: "C",
      result: "ok",
    });
    expect(stateOf(second, outcomes)).toBe("available");
  });

  it("discards everything on a retry, because every image really does start again", () => {
    const keys = ["B", "C"];
    const settled: TileOutcomes = {
      attempt: 0,
      forSet: tileSetKeyOf(0, keys),
      byTile: { B: "fail", C: "fail" },
    };
    expect(stateOf(keys, settled)).toBe("unavailable");

    const retried = carryOverOutcomes(settled, { attempt: 1, tileKeys: keys });
    expect(retried).toEqual({});
    const fresh: TileOutcomes = { attempt: 1, forSet: tileSetKeyOf(1, keys), byTile: retried };
    // Nothing has answered the new attempt yet, so the screen says it is loading rather than
    // repeating a verdict about requests that are no longer outstanding.
    expect(stateOf(keys, fresh)).toBe("loading");
  });
});
