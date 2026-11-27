import { randomUUID } from "node:crypto";

import {
  locationWaitExpired,
  mediaHoldNeedsAction,
  mediaHoldReason,
  MEDIA_LOCATION_WAIT_LIMIT_MS,
} from "@eia/domain/mobile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uploadOneMedia, type LocalMediaRow, type MediaTransport } from "../src/core/media-upload";
import {
  applyResult,
  enqueue,
  insertLocalMedia,
  insertVisit,
  listAllMedia,
  settleAbandonedMediaLocations,
  pendingCommands,
} from "../src/db/repo";
import { visitStartCommand } from "../src/core/commands";
import { openTestDatabase, type LocalTestDatabase } from "./support/local-db";

/**
 * Predio 100, and the silence this file exists to end.
 *
 * On 26 November 2026 a photograph sat on an emulator across three synchronisations. The screen
 * said *Pendiente de subida*; the server had neither a visit for that parcel nor a `field_media`
 * row. Nothing was lost, nothing was broken, and nothing anywhere said what was missing: the
 * technician had photographed the parcel **before** starting its visit, so the row had no visit
 * to belong to and the synchronisation skipped it, correctly and without a word.
 *
 * These tests assert the two halves of the answer. The reason is a **value** the synchronisation
 * and the screen both read, so they cannot disagree about it; and a wait for a position that
 * nothing will ever settle is written off rather than skipped for ever.
 */
describe("why a photograph is still on the phone", () => {
  it("names the visit as the thing that is missing, and says a person must act", () => {
    const held = mediaHoldReason({
      state: "PENDING_UPLOAD",
      serverMediaId: null,
      visitId: null,
      locationOutcome: "not_attempted",
      attempts: 0,
    });
    expect(held).toBe("awaiting_visit");
    expect(mediaHoldNeedsAction(held)).toBe(true);
  });

  it("puts the server's acknowledgement above everything else", () => {
    // A delivered photograph is delivered even if its row still carries an old error: the sweep
    // reads this, and releasing the only copy of a file is the one irreversible thing here.
    expect(
      mediaHoldReason({
        state: "UPLOADED",
        serverMediaId: "m-1",
        visitId: null,
        locationOutcome: "pending",
        attempts: 3,
      }),
    ).toBe("delivered");
  });

  it("waits for a position before it worries about the visit", () => {
    /*
     * The order is the synchronisation's order and must stay that way. A row whose position is
     * still being asked for is seconds old; declaring it now would publish the photograph without
     * coordinates the device is about to write, and those would then exist only on the phone.
     */
    expect(
      mediaHoldReason({
        state: "PENDING_UPLOAD",
        serverMediaId: null,
        visitId: null,
        locationOutcome: "pending",
        attempts: 0,
      }),
    ).toBe("awaiting_location");
  });

  it("distinguishes a refused upload, which retries, from a hold, which does not", () => {
    const refused = mediaHoldReason({
      state: "PENDING_UPLOAD",
      serverMediaId: null,
      visitId: "v-1",
      locationOutcome: "unavailable",
      attempts: 2,
    });
    expect(refused).toBe("upload_failed");
    // Nobody has to do anything: the next connection tries again.
    expect(mediaHoldNeedsAction(refused)).toBe(false);

    expect(
      mediaHoldReason({
        state: "PENDING_UPLOAD",
        serverMediaId: null,
        visitId: "v-1",
        locationOutcome: "captured",
        attempts: 0,
      }),
    ).toBe("ready");
  });

  it("agrees with the transport, which refuses to upload a photograph with no visit", async () => {
    /*
     * The two must not drift. `mediaHoldReason` decides whether the loop even looks at the row;
     * `uploadOneMedia` decides whether the bytes may go. If one said *ready* while the other said
     * *hold*, the loop would spend a technician's battery on a photograph that cannot move.
     */
    const row: LocalMediaRow = {
      localId: randomUUID(),
      assignmentId: randomUUID(),
      visitId: null,
      fileUri: "file:///media/x.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      state: "PENDING_UPLOAD",
      storedObjectId: null,
      serverMediaId: null,
      attempts: 0,
    };
    const refuse = () => {
      throw new Error("the transport must not be touched for a photograph with no visit");
    };
    const transport = {
      requestIntent: refuse,
      putFile: refuse,
      finalize: refuse,
    } as unknown as MediaTransport;

    const step = await uploadOneMedia(row, transport);
    expect(step).toEqual({ kind: "hold", reason: "no_visit_yet" });
    expect(mediaHoldReason({ ...row, locationOutcome: "not_attempted" })).toBe("awaiting_visit");
  });
});

describe("a wait for a position that nothing will settle", () => {
  it("is over once it is older than any bounded request can be", () => {
    const now = new Date("2026-11-27T09:00:00.000Z");
    const justNow = new Date(now.getTime() - 5_000).toISOString();
    const abandoned = new Date(now.getTime() - MEDIA_LOCATION_WAIT_LIMIT_MS - 1).toISOString();
    expect(locationWaitExpired({ capturedAt: justNow, now })).toBe(false);
    expect(locationWaitExpired({ capturedAt: abandoned, now })).toBe(true);
    // An unparseable timestamp is treated as expired: a row nobody can date is a row nobody is
    // waiting for, and the settlement it receives — `unavailable` — is true either way.
    expect(locationWaitExpired({ capturedAt: "no es una fecha", now })).toBe(true);
  });
});

describe("the device's own record", () => {
  let database: LocalTestDatabase;

  beforeEach(async () => {
    database = await openTestDatabase();
  });
  afterEach(() => database.close());

  it("settles a stale wait belonging to this very run, and spares a live one", async () => {
    const session = "run-1";
    const stale = randomUUID();
    const live = randomUUID();
    const assignment = randomUUID();
    for (const localId of [stale, live]) {
      await insertLocalMedia(database.db, {
        localId,
        assignmentLocalId: assignment,
        visitServerId: null,
        fileUri: `file:///media/${localId}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 1,
        kind: "parcel",
        note: null,
        locationOutcome: "pending",
        locationSession: session,
      });
    }
    // Age only the first one. `captured_at` is the shutter, which is what the bound is measured
    // from: the position request starts within milliseconds of it.
    database.raw
      .prepare("update local_media set captured_at = ? where local_id = ?")
      .run(new Date(Date.now() - MEDIA_LOCATION_WAIT_LIMIT_MS - 60_000).toISOString(), stale);

    const settled = await settleAbandonedMediaLocations(database.db, session);
    expect(settled).toBe(1);

    const rows = await listAllMedia(database.db);
    const byId = new Map(rows.map((row) => [row.localId, row]));
    // Written off as what happened — no position was obtained — and never a fabricated one.
    expect(byId.get(stale)!.locationOutcome).toBe("unavailable");
    expect(byId.get(stale)!.latitude).toBeNull();
    expect(byId.get(stale)!.longitude).toBeNull();
    // The capture still in flight keeps its place; its own request settles it seconds later.
    expect(byId.get(live)!.locationOutcome).toBe("pending");
  });

  it("releases a held photograph the moment its visit is acknowledged", async () => {
    /*
     * The recovery, end to end on the device's own tables: the photograph was taken first, the
     * visit was started afterwards, and the server's answer to `visit.start` is what reaches the
     * photograph. This is the path the screen now tells a technician to take.
     */
    const assignment = randomUUID();
    const localId = randomUUID();
    await insertLocalMedia(database.db, {
      localId,
      assignmentLocalId: assignment,
      visitServerId: null,
      fileUri: "file:///media/100.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      kind: "parcel",
      note: null,
      locationOutcome: "not_attempted",
      locationSession: null,
    });

    const before = (await listAllMedia(database.db))[0]!;
    expect(mediaHoldReason(before)).toBe("awaiting_visit");

    // `local_visit` is keyed to an assignment by foreign key, so the row the pack would have
    // written is written here too.
    database.raw
      .prepare(
        `insert into local_assignment (id, parcel_code, server_status, revision, updated_at)
         values (?, '100', 'ASSIGNED', 1, ?)`,
      )
      .run(assignment, new Date().toISOString());

    const visitLocalId = randomUUID();
    await insertVisit(database.db, {
      id: visitLocalId,
      assignmentId: assignment,
      latitude: null,
      longitude: null,
      accuracyM: null,
      locationCapturedAt: null,
      locationOutcome: "not_attempted",
    });
    await enqueue(database.db, {
      entityKind: "visit",
      entityLocalId: visitLocalId,
      command: visitStartCommand(
        {
          appVersion: "test",
          deviceRevision: 0,
          occurredAt: new Date("2026-11-27T09:00:00.000Z"),
          newId: () => randomUUID(),
        },
        { assignmentId: assignment, location: null, locationOutcome: "not_attempted" },
      ),
    });

    const [queued] = await pendingCommands(database.db, 10);
    const serverVisitId = randomUUID();
    await applyResult(database.db, queued!, {
      commandId: queued!.command.commandId,
      outcome: "applied",
      visitId: serverVisitId,
      instanceId: null,
      instanceStatus: null,
      assignmentStatus: null,
      conflictReason: null,
      message: null,
    });

    const after = (await listAllMedia(database.db))[0]!;
    expect(after.visitId).toBe(serverVisitId);
    // No longer waiting for a person: the next connection sends it.
    expect(mediaHoldReason(after)).toBe("ready");
    expect(mediaHoldNeedsAction(mediaHoldReason(after))).toBe(false);
    // And the photograph itself is untouched by any of it.
    expect(after.fileUri).toBe("file:///media/100.jpg");
    expect(after.serverMediaId).toBeNull();
  });
});
