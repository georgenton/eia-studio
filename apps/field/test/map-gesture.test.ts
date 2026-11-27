import { describe, expect, it } from "vitest";

import {
  beginGesture,
  clampZoom,
  endGesture,
  MAX_ZOOM,
  MIN_ZOOM,
  moveGesture,
  type Camera,
  type GestureFrame,
} from "../src/core/map-gesture";

/**
 * The sequence a finger actually performs, which is the only way this bug was ever visible.
 *
 * The first implementation fixed `anchor.distance` when the gesture began. Start with one finger
 * and it is zero; add a second and the zoom branch never runs, however far the fingers travel.
 * Nothing in a single-call test would show that — the defect is in the *transition*.
 */
const VIEWPORT = { width: 320, height: 340, padding: 18 };
const START: Camera = { centre: [-78.74, -3.82], zoom: 14, anchor: null };

const frame = (over: Partial<GestureFrame> = {}): GestureFrame => ({
  touches: 1,
  distance: 0,
  dx: 0,
  dy: 0,
  ...over,
});

describe("the map gesture", () => {
  it("pans with one finger, and the ground follows it", () => {
    let camera = beginGesture(START, frame());
    camera = moveGesture(camera, frame({ dx: 60, dy: 0 }), VIEWPORT);
    // Dragging right shows ground further **west**, so the centre's longitude decreases.
    expect(camera.centre[0]).toBeLessThan(START.centre[0]);
    expect(camera.zoom).toBe(START.zoom);
  });

  it("computes every frame from the anchor, so a long drag does not accumulate error", () => {
    let once = beginGesture(START, frame());
    once = moveGesture(once, frame({ dx: 90, dy: 40 }), VIEWPORT);

    let stepped = beginGesture(START, frame());
    const steps: Array<[number, number]> = [
      [30, 13],
      [60, 27],
      [90, 40],
    ];
    for (const [dx, dy] of steps) {
      stepped = moveGesture(stepped, frame({ dx, dy }), VIEWPORT);
    }
    // The same total translation lands in the same place however many frames it took.
    expect(stepped.centre[0]).toBeCloseTo(once.centre[0], 12);
    expect(stepped.centre[1]).toBeCloseTo(once.centre[1], 12);
  });

  it("one finger → add a second → pinch → remove one → keep panning, with no jump", () => {
    // 1 · one finger down, and a drag.
    let camera = beginGesture(START, frame());
    camera = moveGesture(camera, frame({ dx: 40, dy: 0 }), VIEWPORT);
    const afterDrag = camera.centre;
    expect(camera.zoom).toBe(14);

    /*
     * 2 · a second finger arrives. This is the frame the old code got wrong: the anchor still
     * said one touch with distance 0, so the zoom branch was unreachable for the rest of the
     * gesture. Re-anchoring makes it a fresh pinch from the scale now on screen — and must move
     * nothing by itself.
     */
    camera = moveGesture(camera, frame({ touches: 2, distance: 100, dx: 40, dy: 0 }), VIEWPORT);
    expect(camera.centre).toEqual(afterDrag);
    expect(camera.zoom).toBe(14);
    expect(camera.anchor?.touches).toBe(2);
    expect(camera.anchor?.distance).toBe(100);

    // 3 · pinch out: fingers twice as far apart is one zoom level in.
    camera = moveGesture(camera, frame({ touches: 2, distance: 200, dx: 40, dy: 0 }), VIEWPORT);
    expect(camera.zoom).toBeCloseTo(15, 6);
    expect(camera.centre).toEqual(afterDrag);

    // 4 · one finger lifts. Re-anchor again, and still nothing moves on that frame.
    const beforeLift = camera.centre;
    camera = moveGesture(camera, frame({ touches: 1, dx: 40, dy: 0 }), VIEWPORT);
    expect(camera.centre).toEqual(beforeLift);
    expect(camera.zoom).toBeCloseTo(15, 6);

    /*
     * 5 · and panning resumes from where the finger is now. The anchor recorded `dx = 40`, so a
     * further 20 points of travel is a 20-point pan — not a 60-point jump back to the gesture's
     * original origin, which is what an un-rebased anchor would have produced.
     */
    camera = moveGesture(camera, frame({ touches: 1, dx: 60, dy: 0 }), VIEWPORT);
    const movedWest = beforeLift[0] - camera.centre[0];
    expect(movedWest).toBeGreaterThan(0);

    // The same 20 points from a clean one-finger drag at this zoom moves the same distance.
    let reference = beginGesture({ ...START, zoom: camera.zoom }, frame());
    reference = moveGesture(reference, frame({ dx: 20, dy: 0 }), VIEWPORT);
    expect(movedWest).toBeCloseTo(START.centre[0] - reference.centre[0], 10);
  });

  it("ignores a pinch frame with no usable distance rather than dividing by zero", () => {
    let camera = beginGesture(START, frame({ touches: 2, distance: 0 }));
    camera = moveGesture(camera, frame({ touches: 2, distance: 120 }), VIEWPORT);
    expect(Number.isFinite(camera.zoom)).toBe(true);
    expect(camera.zoom).toBe(14);
  });

  it("keeps the zoom inside what the provider can serve", () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(-3)).toBe(MIN_ZOOM);
    let camera = beginGesture({ ...START, zoom: MAX_ZOOM }, frame({ touches: 2, distance: 50 }));
    camera = moveGesture(camera, frame({ touches: 2, distance: 5_000 }), VIEWPORT);
    expect(camera.zoom).toBe(MAX_ZOOM);
  });

  it("forgets the anchor when the gesture ends, so the next one starts clean", () => {
    const camera = endGesture(beginGesture(START, frame()));
    expect(camera.anchor).toBeNull();
  });
});
