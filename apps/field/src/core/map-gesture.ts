import type { MapPosition } from "@eia/field-sync-contract";

import { viewOf } from "./mercator";
import type { Viewport } from "./map-projection";

/**
 * Panning and pinching, as arithmetic.
 *
 * ## Why this is a pure function and not handler bodies
 *
 * The bug it exists to prevent is only visible as a *sequence*: one finger down, a second
 * arrives, pinch, one leaves, keep dragging. Written inside `PanResponder` callbacks that
 * sequence can only be exercised on a device, which in practice means never — and the first
 * version of this code had exactly that defect. `anchor.distance` was fixed when the gesture
 * began, so a pinch that started as a drag had `distance === 0` and the zoom branch never ran
 * however far the second finger travelled.
 *
 * As a reducer the whole sequence is five calls in a test.
 *
 * ## The rule
 *
 * Every frame is computed from the camera **as it was when the current anchor was taken**, not
 * from the previous frame, so rounding cannot accumulate across a long drag. The anchor is
 * retaken whenever the number of contacts changes, which is what makes the transitions seamless
 * in both directions: a finger arriving starts the zoom from the scale now on screen, and a
 * finger leaving resumes the pan without the camera jumping.
 */
export const MIN_ZOOM = 3;
/** The provider's ceiling: above it a tile request returns nothing and the background vanishes. */
export const MAX_ZOOM = 18;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export interface GestureAnchor {
  readonly centre: MapPosition;
  readonly zoom: number;
  /** Distance between the first two contacts when the anchor was taken; 0 with one finger. */
  readonly distance: number;
  readonly touches: number;
  /** The cumulative translation when the anchor was taken, so later frames are relative to it. */
  readonly originX: number;
  readonly originY: number;
}

export interface Camera {
  readonly centre: MapPosition;
  readonly zoom: number;
  readonly anchor: GestureAnchor | null;
}

export interface GestureFrame {
  /** How many fingers are on the glass right now. */
  readonly touches: number;
  /** Distance between the first two, or 0 with fewer than two. */
  readonly distance: number;
  /** Cumulative translation since the gesture began, as the responder reports it. */
  readonly dx: number;
  readonly dy: number;
}

/** Take a fresh anchor on the camera as it stands. */
function anchorAt(camera: Camera, frame: GestureFrame): GestureAnchor {
  return {
    centre: camera.centre,
    zoom: camera.zoom,
    distance: frame.distance,
    touches: frame.touches,
    originX: frame.dx,
    originY: frame.dy,
  };
}

export function beginGesture(camera: Camera, frame: GestureFrame): Camera {
  return { ...camera, anchor: anchorAt({ ...camera, anchor: null }, frame) };
}

export function endGesture(camera: Camera): Camera {
  return { ...camera, anchor: null };
}

export function moveGesture(camera: Camera, frame: GestureFrame, viewport: Viewport): Camera {
  const anchor = camera.anchor;
  // No anchor, or the number of fingers changed: re-anchor and move nothing this frame.
  if (anchor === null || anchor.touches !== frame.touches) {
    return { ...camera, anchor: anchorAt(camera, frame) };
  }

  if (frame.touches >= 2) {
    if (anchor.distance <= 0 || frame.distance <= 0) return camera;
    return {
      ...camera,
      zoom: clampZoom(anchor.zoom + Math.log2(frame.distance / anchor.distance)),
    };
  }

  const at = viewOf(anchor.centre, anchor.zoom, viewport);
  // Dragging moves the ground with the finger, so the centre moves the other way.
  return {
    ...camera,
    centre: at.toLonLat({
      x: viewport.width / 2 - (frame.dx - anchor.originX),
      y: viewport.height / 2 - (frame.dy - anchor.originY),
    }),
  };
}
