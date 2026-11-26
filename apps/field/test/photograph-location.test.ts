import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attachMediaLocation,
  insertLocalMedia,
  listAllMedia,
  settleAbandonedMediaLocations,
} from "../src/db/repo";
import { openTestDatabase, type LocalTestDatabase } from "./support/local-db";

/**
 * Where a photograph was taken, and the order in which that is allowed to be found out.
 *
 * ## The defect this file exists for
 *
 * `screens/assignment.tsx` used to `await readLocation()` and pass the result into
 * `captureMedia`, so the photograph stayed in the picker's cache — a directory the operating
 * system clears on its own schedule — for as long as the platform took to answer.
 * `getCurrentPositionAsync` has no timeout, so indoors that wait is unbounded: a backgrounded or
 * reclaimed application lost the photograph outright, and no row was ever written to say it had
 * existed.
 *
 * The order is now persist-then-enrich, and these assertions are about what that order means for
 * the data rather than about the screen that produces it:
 *
 * - a row exists, with its file, before any position is sought;
 * - `pending` is a state only the device's own process is ever in, and it settles to a stated
 *   absence rather than to a coordinate;
 * - a late answer never overwrites a settled one;
 * - nothing ever stands in for a position that was not obtained.
 */

const ASSIGNMENT = "0199f3a2-7c41-7abc-8d0f-00000000a001";
const VISIT = "0199f3a2-7c41-7abc-8d0f-00000000v001";

describe("a photograph is kept before its position is sought", () => {
  let database: LocalTestDatabase;

  beforeEach(() => {
    database = openTestDatabase();
  });
  afterEach(() => database.close());

  const photograph = async (
    localId: string,
    locationOutcome: "pending" | "not_attempted" = "pending",
  ) =>
    insertLocalMedia(database.db, {
      localId,
      assignmentLocalId: ASSIGNMENT,
      visitServerId: VISIT,
      fileUri: `file:///data/eia-field/media/${localId}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1_800_000,
      kind: "parcel",
      note: null,
      locationOutcome,
    });

  const read = async (localId: string) =>
    (await listAllMedia(database.db)).find((row) => row.localId === localId)!;

  it("writes the row with its file and no coordinates at all", async () => {
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000e1");
    const row = await read("0199f3a2-7c41-7abc-8d0f-0000000000e1");

    expect(row.fileUri).toContain("/media/");
    expect(row.state).toBe("PENDING_UPLOAD");
    expect(row.locationOutcome).toBe("pending");
    // The three facts that would be a fabricated position if they were anything but null.
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
    expect(row.accuracyM).toBeNull();
    expect(row.locatedAt).toBeNull();
  });

  it("attaches a position, keeping the fix's own moment apart from the shutter's", async () => {
    const id = "0199f3a2-7c41-7abc-8d0f-0000000000e2";
    await photograph(id);
    const before = await read(id);

    await attachMediaLocation(database.db, id, {
      outcome: "captured",
      latitude: -3.9881,
      longitude: -78.8712,
      accuracyM: 8.4,
      locatedAt: "2026-11-26T18:40:11.000Z",
      mocked: false,
      source: null,
    });

    const row = await read(id);
    expect(row.locationOutcome).toBe("captured");
    expect(row.latitude).toBeCloseTo(-3.9881, 4);
    expect(row.accuracyM).toBeCloseTo(8.4, 1);
    expect(row.locatedAt).toBe("2026-11-26T18:40:11.000Z");
    // Two different instants, and the photograph's own is not rewritten by the fix.
    expect(row.capturedAt).toBe(before.capturedAt);
    expect(row.locatedAt).not.toBe(row.capturedAt);
    expect(row.locationMocked).toBe(false);
  });

  it("records a simulated position as simulated, because the platform said so", async () => {
    const id = "0199f3a2-7c41-7abc-8d0f-0000000000e3";
    await photograph(id);
    await attachMediaLocation(database.db, id, {
      outcome: "captured",
      latitude: -3.9881,
      longitude: -78.8712,
      accuracyM: 5,
      locatedAt: "2026-11-26T18:41:00.000Z",
      mocked: true,
      source: null,
    });
    expect((await read(id)).locationMocked).toBe(true);
  });

  /** Each of the three ways of not getting a position is its own recorded fact. */
  it.each(["denied", "timed_out", "unavailable"] as const)(
    "records %s without inventing a coordinate",
    async (outcome) => {
      const id = `0199f3a2-7c41-7abc-8d0f-0000000000${outcome.slice(0, 2)}`;
      await photograph(id);
      await attachMediaLocation(database.db, id, {
        outcome,
        latitude: null,
        longitude: null,
        accuracyM: null,
        locatedAt: null,
        mocked: null,
        source: null,
      });

      const row = await read(id);
      expect(row.locationOutcome).toBe(outcome);
      expect(row.latitude).toBeNull();
      expect(row.longitude).toBeNull();
      // Explicitly not 0,0 — the value a missing coordinate silently becomes in most systems.
      expect(row.latitude).not.toBe(0);
      expect(row.longitude).not.toBe(0);
      // And the file is still there: a photograph is never held back for want of a position.
      expect(row.fileUri).toContain("/media/");
      expect(row.state).toBe("PENDING_UPLOAD");
    },
  );

  it("does not let a late answer overwrite one already settled", async () => {
    const id = "0199f3a2-7c41-7abc-8d0f-0000000000e4";
    await photograph(id);
    await attachMediaLocation(database.db, id, {
      outcome: "timed_out",
      latitude: null,
      longitude: null,
      accuracyM: null,
      locatedAt: null,
      mocked: null,
      source: null,
    });

    // The platform answers after we gave up. This is not where the technician was at the shutter.
    await attachMediaLocation(database.db, id, {
      outcome: "captured",
      latitude: -3.9,
      longitude: -78.8,
      accuracyM: 40,
      locatedAt: "2026-11-26T18:45:00.000Z",
      mocked: false,
      source: null,
    });

    const row = await read(id);
    expect(row.locationOutcome).toBe("timed_out");
    expect(row.latitude).toBeNull();
  });

  it("settles a photograph abandoned mid-request, rather than holding it for ever", async () => {
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000e5");
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000e6", "not_attempted");

    const settled = await settleAbandonedMediaLocations(database.db);
    expect(settled).toBe(1);

    // The process died between the shutter and the answer: the device cannot know where it was.
    expect((await read("0199f3a2-7c41-7abc-8d0f-0000000000e5")).locationOutcome).toBe(
      "unavailable",
    );
    // A capture that never intended to ask is left exactly as it was.
    expect((await read("0199f3a2-7c41-7abc-8d0f-0000000000e6")).locationOutcome).toBe(
      "not_attempted",
    );
    // Idempotent: a second synchronisation settles nothing.
    expect(await settleAbandonedMediaLocations(database.db)).toBe(0);
  });
});
