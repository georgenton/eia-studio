import { describe, expect, it } from "vitest";

import {
  CAPTURE_CHANNEL_DESCRIPTORS,
  captureChannelSatisfiesOfflineMode,
  deriveOfflineWindow,
  offlineAccessState,
  OFFLINE_WINDOW_CAP_MS,
  OFFLINE_WINDOW_FLOOR_MS,
  OfflineWindowUnavailable,
} from "../src/index";

const NOW = new Date("2026-10-01T08:00:00.000Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

describe("how long a device may work with no server contact", () => {
  it("never outlives the session that produced the pack", () => {
    const window = deriveOfflineWindow({ now: NOW, sessionExpiresAt: hours(30) });
    expect(window.expiresAt).toEqual(hours(30));
    expect(window.basis).toContain("sesión");
  });

  it("is capped even when the session is longer, because a browser's convenience is not a field policy", () => {
    const window = deriveOfflineWindow({ now: NOW, sessionExpiresAt: hours(24 * 90) });
    expect(window.expiresAt.getTime()).toBe(NOW.getTime() + OFFLINE_WINDOW_CAP_MS);
  });

  it("refuses to issue a pack that would strand a technician", () => {
    // Finding out in a corridor that the window lapsed ten minutes after arriving is worse than
    // finding out now, standing next to a signal.
    expect(() =>
      deriveOfflineWindow({
        now: NOW,
        sessionExpiresAt: new Date(NOW.getTime() + OFFLINE_WINDOW_FLOOR_MS - 1),
      }),
    ).toThrow(OfflineWindowUnavailable);
  });
});

describe("what the device does with the window it holds", () => {
  it("warns before it lapses, because the remedy takes planning", () => {
    expect(offlineAccessState({ now: NOW, expiresAt: hours(72) })).toBe("valid");
    expect(offlineAccessState({ now: NOW, expiresAt: hours(6) })).toBe("expiring");
    expect(offlineAccessState({ now: NOW, expiresAt: hours(-1) })).toBe("expired");
  });
});

describe("EIA Field as a capture channel", () => {
  it("is the first channel that may run a campaign whose project requires offline capture", () => {
    expect(CAPTURE_CHANNEL_DESCRIPTORS.EIA_FIELD_MOBILE.supportsOffline).toBe(true);
    expect(captureChannelSatisfiesOfflineMode("EIA_FIELD_MOBILE", "required")).toBe(true);
    // The web form still cannot, and still says so.
    expect(captureChannelSatisfiesOfflineMode("NATIVE_WEB", "required")).toBe(false);
  });
});
