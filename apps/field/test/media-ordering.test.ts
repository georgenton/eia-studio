import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closesVisitFor,
  dispositionFor,
  withholdClosuresForUndeliveredMedia,
} from "../src/core/outbox-policy";
import { deletableFiles } from "../src/core/media-upload";
import {
  mediaDeclareCommand,
  surveyDraftCommand,
  surveySubmitCommand,
  visitFinishCommand,
  visitStartCommand,
} from "../src/core/commands";
import {
  assignmentsHoldingMedia,
  countPending,
  enqueue,
  insertLocalMedia,
  pendingCommands,
  setMediaState,
  pendingCommandExists,
  settleCommand,
  supersedeResolvedCommands,
} from "../src/db/repo";
import { summarisePendingWork } from "../src/db/repo-v4";
import { decideSignOut } from "../src/core/sign-out";
import { openTestDatabase, type LocalTestDatabase } from "./support/local-db";

/**
 * A photograph that failed to upload must not lose its visit.
 *
 * ## The recorded incident
 *
 * Predio 102, 19 November 2026, on the Android emulator. The upload authorization was issued at
 * 17:51:09, the upload failed, `survey.submit` went out and closed the visit at 17:51:13, and the
 * next attempt asked for a **new** authorization — which is deliberate, because reusing one whose
 * PUT may have half-succeeded costs a photograph. The server refused the declaration, because
 * that authorization was issued after the visit closed.
 *
 * Neither side was wrong on its own. A finished visit must not grow new evidence, and a device
 * must not close a visit while it is still holding some. These cases pin the second half.
 *
 * ## What the server rule actually proves, stated exactly
 *
 * That an upload authorization for these bytes was issued **before the visit closed**. It is not a
 * certificate of when the shutter was pressed — the only clock that knows that is the device's,
 * and the device is the party the rule constrains. It is the strongest fact this server can hold
 * from its own clock, and it is worded that way wherever it appears.
 */
const ASSIGNMENT_A = "0199f3a2-7c41-7abc-8d0f-0000000000a1";
const ASSIGNMENT_B = "0199f3a2-7c41-7abc-8d0f-0000000000b1";
const VISIT_A = "0199f3a2-7c41-7abc-8d0f-0000000000a2";
const SURVEY_VERSION = "0199f3a2-7c41-7abc-8d0f-0000000000f1";

const ctx = (id: string) => ({
  appVersion: "1.0.0",
  deviceRevision: 0,
  occurredAt: new Date("2026-11-19T17:51:00.000Z"),
  newId: () => id,
});

const submitA = surveySubmitCommand(ctx("0199f3a2-7c41-7abc-8d0f-00000000c001"), {
  assignmentId: ASSIGNMENT_A,
  visitId: VISIT_A,
  surveyVersionId: SURVEY_VERSION,
  answers: {},
});
const submitB = surveySubmitCommand(ctx("0199f3a2-7c41-7abc-8d0f-00000000c002"), {
  assignmentId: ASSIGNMENT_B,
  visitId: "0199f3a2-7c41-7abc-8d0f-0000000000b2",
  surveyVersionId: SURVEY_VERSION,
  answers: {},
});
const declareA = mediaDeclareCommand(ctx("0199f3a2-7c41-7abc-8d0f-00000000c003"), {
  assignmentId: ASSIGNMENT_A,
  visitId: VISIT_A,
  localId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
  storedObjectId: "0199f3a2-7c41-7abc-8d0f-0000000000e1",
  kind: "parcel",
  note: null,
  location: null,
});

describe("which commands close a visit", () => {
  it("names the assignment of the two that do", () => {
    expect(closesVisitFor(submitA)).toBe(ASSIGNMENT_A);
    expect(
      closesVisitFor(
        visitFinishCommand(ctx("0199f3a2-7c41-7abc-8d0f-00000000c004"), {
          assignmentId: ASSIGNMENT_A,
          visitId: VISIT_A,
        }),
      ),
    ).toBe(ASSIGNMENT_A);
  });

  it("names nothing for the commands that close nothing", () => {
    expect(closesVisitFor(declareA)).toBeNull();
    expect(
      closesVisitFor(
        visitStartCommand(ctx("0199f3a2-7c41-7abc-8d0f-00000000c005"), {
          assignmentId: ASSIGNMENT_A,
          location: null,
          locationOutcome: "not_attempted",
        }),
      ),
    ).toBeNull();
    expect(
      closesVisitFor(
        surveyDraftCommand(ctx("0199f3a2-7c41-7abc-8d0f-00000000c006"), {
          assignmentId: ASSIGNMENT_A,
          visitId: VISIT_A,
          surveyVersionId: SURVEY_VERSION,
          answers: {},
        }),
      ),
    ).toBeNull();
  });
});

describe("holding a closure back", () => {
  it("holds the submit of the assignment whose photograph is still on the phone", () => {
    const { send, withheld } = withholdClosuresForUndeliveredMedia(
      [{ command: submitA }],
      new Set([ASSIGNMENT_A]),
    );
    expect(send).toEqual([]);
    expect(withheld.map((held) => held.assignmentId)).toEqual([ASSIGNMENT_A]);
  });

  it("lets the declaration of that very photograph through, which is what unblocks it", () => {
    // The order the fix produces: declare first, against a visit that is still open, and the
    // submit next time. A declaration against an open visit is admitted with no reference to any
    // upload time at all.
    const { send, withheld } = withholdClosuresForUndeliveredMedia(
      [{ command: declareA }, { command: submitA }],
      new Set([ASSIGNMENT_A]),
    );
    expect(send.map((entry) => entry.command.type)).toEqual(["media.declare"]);
    expect(withheld).toHaveLength(1);
  });

  it("does not hold another parcel's work", () => {
    const { send, withheld } = withholdClosuresForUndeliveredMedia(
      [{ command: submitA }, { command: submitB }],
      new Set([ASSIGNMENT_A]),
    );
    expect(send.map((entry) => entry.command.payload.assignmentId)).toEqual([ASSIGNMENT_B]);
    expect(withheld).toHaveLength(1);
  });

  it("holds nothing once the photograph is delivered", () => {
    const { send, withheld } = withholdClosuresForUndeliveredMedia(
      [{ command: submitA }, { command: submitB }],
      new Set(),
    );
    expect(send).toHaveLength(2);
    expect(withheld).toEqual([]);
  });
});

describe("against the device's own database", () => {
  let database: LocalTestDatabase;

  beforeEach(() => {
    database = openTestDatabase();
  });
  afterEach(() => database.close());

  const photograph = async (localId: string, assignmentId = ASSIGNMENT_A) =>
    insertLocalMedia(database.db, {
      localId,
      assignmentLocalId: assignmentId,
      visitServerId: VISIT_A,
      fileUri: `file:///data/eia-field/media/${localId}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1_800_000,
      kind: "parcel",
      note: null,
      locationOutcome: "not_attempted",
      locationSession: null,
    });

  /**
   * Case 1 of the brief: the upload or its finalize fails while the response API is perfectly
   * available. The connection comes back and it is retried.
   */
  it("case 1 · a failed upload holds the response, and delivers both after the retry", async () => {
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000d1");
    await enqueue(database.db, {
      command: submitA,
      entityKind: "survey",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000s1",
    });

    // The upload failed: the row keeps its file, and `server_media_id` is still null.
    await setMediaState(database.db, "0199f3a2-7c41-7abc-8d0f-0000000000d1", {
      state: "PENDING_UPLOAD",
      lastError: "la red falló",
      bumpAttempt: true,
    });

    const firstRun = withholdClosuresForUndeliveredMedia(
      (await pendingCommands(database.db, 50)).map((row) => ({ row, command: row.command })),
      await assignmentsHoldingMedia(database.db),
    );
    expect(firstRun.send).toEqual([]);
    expect(firstRun.withheld).toHaveLength(1);
    // Held, not failed and not lost: the row is still queued where it was.
    expect(await countPending(database.db)).toBe(1);

    // The connection returns. The upload succeeds and the declaration is queued behind the submit.
    await setMediaState(database.db, "0199f3a2-7c41-7abc-8d0f-0000000000d1", {
      state: "UPLOADING",
      storedObjectId: "0199f3a2-7c41-7abc-8d0f-0000000000e1",
      lastError: null,
    });
    await enqueue(database.db, {
      command: declareA,
      entityKind: "media",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
    });

    const secondRun = withholdClosuresForUndeliveredMedia(
      (await pendingCommands(database.db, 50)).map((row) => ({ row, command: row.command })),
      await assignmentsHoldingMedia(database.db),
    );
    // The declaration goes first even though it was queued second, which is the whole fix.
    expect(secondRun.send.map((entry) => entry.command.type)).toEqual(["media.declare"]);

    // The server acknowledges it; the photograph is delivered and the submit is free.
    await setMediaState(database.db, "0199f3a2-7c41-7abc-8d0f-0000000000d1", {
      state: "UPLOADED",
      serverMediaId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
      lastError: null,
    });
    const thirdRun = withholdClosuresForUndeliveredMedia(
      (await pendingCommands(database.db, 50)).map((row) => ({ row, command: row.command })),
      await assignmentsHoldingMedia(database.db),
    );
    expect(thirdRun.withheld).toEqual([]);
    expect(thirdRun.send.map((entry) => entry.command.type)).toContain("survey.submit");
  });

  /**
   * Case 2 of the brief: two photographs, the first fails, so the second has not even asked for
   * its upload authorization yet. Neither may be left behind by the close.
   */
  it("case 2 · two photographs, the first failing, hold the response until both are delivered", async () => {
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000d1");
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000d2");
    await enqueue(database.db, {
      command: submitA,
      entityKind: "survey",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000s1",
    });

    expect(await assignmentsHoldingMedia(database.db)).toEqual(new Set([ASSIGNMENT_A]));

    // The first is delivered. The second has not been uploaded at all, and still holds.
    await setMediaState(database.db, "0199f3a2-7c41-7abc-8d0f-0000000000d1", {
      state: "UPLOADED",
      serverMediaId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
      lastError: null,
    });
    const midway = withholdClosuresForUndeliveredMedia(
      (await pendingCommands(database.db, 50)).map((row) => ({ row, command: row.command })),
      await assignmentsHoldingMedia(database.db),
    );
    expect(midway.withheld).toHaveLength(1);

    await setMediaState(database.db, "0199f3a2-7c41-7abc-8d0f-0000000000d2", {
      state: "UPLOADED",
      serverMediaId: "0199f3a2-7c41-7abc-8d0f-0000000000d2",
      lastError: null,
    });
    const after = withholdClosuresForUndeliveredMedia(
      (await pendingCommands(database.db, 50)).map((row) => ({ row, command: row.command })),
      await assignmentsHoldingMedia(database.db),
    );
    expect(after.withheld).toEqual([]);
  });

  /**
   * One order per photograph in the queue.
   *
   * `uploadPendingMedia` forms a declaration for every unacknowledged photograph on every
   * synchronisation. Without this guard, a declaration still waiting gained an identical twin each
   * time, and the emulator read *"4 elementos sin sincronizar"* for a single photograph.
   */
  it("knows when a photograph already has an order waiting, and when it only has a refusal", async () => {
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000d1");
    expect(
      await pendingCommandExists(database.db, "media", "0199f3a2-7c41-7abc-8d0f-0000000000d1"),
    ).toBe(false);

    await enqueue(database.db, {
      command: declareA,
      entityKind: "media",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
    });
    expect(
      await pendingCommandExists(database.db, "media", "0199f3a2-7c41-7abc-8d0f-0000000000d1"),
    ).toBe(true);

    // A refusal does not block a new attempt — which is exactly how predio 102 recovers once the
    // server has stopped refusing.
    const row = (await pendingCommands(database.db, 50))[0]!;
    await settleCommand(database.db, row.seq, "FAILED", "rechazada");
    expect(
      await pendingCommandExists(database.db, "media", "0199f3a2-7c41-7abc-8d0f-0000000000d1"),
    ).toBe(false);

    // And another photograph's order is not this photograph's.
    expect(
      await pendingCommandExists(database.db, "media", "0199f3a2-7c41-7abc-8d0f-0000000000d2"),
    ).toBe(false);
  });

  /**
   * A photograph on its own is pending work, and the guard must see it.
   *
   * `capture` used to bump only the parcel's own list, leaving the shared summary as it was until
   * the next sync — so a device with nothing else pending could take a photograph and be allowed
   * to sign out, which discards the database and the file. The screen now refreshes the summary;
   * this pins what that summary has to say.
   */
  it("counts a photograph nobody has synced, and refuses sign-out for it alone", async () => {
    expect(decideSignOut(await summarisePendingWork(database.db)).kind).toBe("allowed");

    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000d1");

    const summary = await summarisePendingWork(database.db);
    expect(summary.pendingMedia).toBe(1);
    expect(summary.outboxPending).toBe(0);
    const decision = decideSignOut(summary);
    expect(decision.kind).toBe("blocked");
    if (decision.kind !== "blocked") return;
    expect(decision.blocking).toContain("pendingMedia");
  });

  /**
   * Predio 102's residue: the order the server refused is `FAILED`, which is excluded from the
   * retry queue and **counted** as pending work. Left alone it blocks sign-out and the project
   * switch for ever, over a photograph that has since arrived.
   */
  it("stops counting the refused order once a later one delivered the same photograph", async () => {
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000d1");
    await enqueue(database.db, {
      command: declareA,
      entityKind: "media",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
    });
    const refused = (await pendingCommands(database.db, 50))[0]!;
    await settleCommand(
      database.db,
      refused.seq,
      "FAILED",
      "esa visita está terminada, y este archivo no se subió antes de cerrarse",
    );

    // An unrelated order the server also refused. It must keep blocking.
    await enqueue(database.db, {
      command: submitB,
      entityKind: "survey",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000s2",
    });
    const other = (await pendingCommands(database.db, 50))[0]!;
    await settleCommand(database.db, other.seq, "FAILED", "otra cosa distinta");

    expect((await summarisePendingWork(database.db)).outboxFailed).toBe(2);

    // The photograph is declared again and acknowledged, which is what the engine does.
    const second = mediaDeclareCommand(ctx("0199f3a2-7c41-7abc-8d0f-00000000c009"), {
      assignmentId: ASSIGNMENT_A,
      visitId: VISIT_A,
      localId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
      storedObjectId: "0199f3a2-7c41-7abc-8d0f-0000000000e1",
      kind: "parcel",
      note: null,
      location: null,
    });
    const superseded = await supersedeResolvedCommands(database.db, {
      entityKind: "media",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
      byCommandId: second.commandId,
    });
    expect(superseded).toBe(1);
    await setMediaState(database.db, "0199f3a2-7c41-7abc-8d0f-0000000000d1", {
      state: "UPLOADED",
      serverMediaId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
      lastError: null,
    });

    const summary = await summarisePendingWork(database.db);
    // One, not zero: the other refusal is still a refusal.
    expect(summary.outboxFailed).toBe(1);
    expect(summary.pendingMedia).toBe(0);

    // The traceability the brief asks for: the rejection text is still on the row, and the row
    // records which later command resolved it.
    const row = database.raw
      .prepare(`select state, last_error from sync_outbox where command_id = ?`)
      .get(refused.commandId) as { state: string; last_error: string };
    expect(row.state).toBe("SUPERSEDED");
    expect(row.last_error).toContain("no se subió antes de cerrarse");
    expect(row.last_error).toContain(second.commandId);

    // And the guard still protects the work that really is undelivered.
    expect(decideSignOut(summary).kind).toBe("blocked");
  });

  it("releases the sign-out guard when the recovered photograph was the only thing pending", async () => {
    await photograph("0199f3a2-7c41-7abc-8d0f-0000000000d1");
    await enqueue(database.db, {
      command: declareA,
      entityKind: "media",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
    });
    const refused = (await pendingCommands(database.db, 50))[0]!;
    await settleCommand(database.db, refused.seq, "FAILED", "rechazada");

    await supersedeResolvedCommands(database.db, {
      entityKind: "media",
      entityLocalId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
      byCommandId: "0199f3a2-7c41-7abc-8d0f-00000000c00a",
    });
    database.raw.exec(`delete from local_media`); // the sweep, after the acknowledgement

    const summary = await summarisePendingWork(database.db);
    expect(summary).toMatchObject({ outboxPending: 0, outboxFailed: 0, pendingMedia: 0 });
    expect(decideSignOut(summary).kind).toBe("allowed");
  });
});

/**
 * The device's half of a refusal whose answer was lost.
 *
 * The server replays the refusal (`packages/application/src/field/sync.ts`); this is what the
 * client must then do with it — and above all what it must *not* do, which is release the file.
 */
describe("a refused photograph keeps its file", () => {
  const refused = {
    commandId: "0199f3a2-7c41-7abc-8d0f-00000000c003",
    outcome: "rejected" as const,
    visitId: null,
    instanceId: null,
    instanceStatus: null,
    assignmentStatus: null,
    conflictReason: null,
    message: "esa visita está terminada, y este archivo no se subió antes de cerrarse",
  };

  it("treats the replayed refusal as a refusal, not as a delivery", () => {
    const disposition = dispositionFor(refused);
    expect(disposition.kind).toBe("failed");
    // `done` is the only branch that calls `acknowledgeMedia`, which is the only thing that sets
    // `server_media_id`, which is the only thing that releases the file.
    expect(disposition.kind).not.toBe("done");
  });

  it("keeps the local file, because nothing acknowledged the row", () => {
    const row = {
      localId: "0199f3a2-7c41-7abc-8d0f-0000000000d1",
      assignmentId: ASSIGNMENT_A,
      visitId: VISIT_A,
      fileUri: "file:///data/eia-field/media/d1.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1_800_000,
      state: "PENDING_UPLOAD" as const,
      storedObjectId: "0199f3a2-7c41-7abc-8d0f-0000000000e1",
      serverMediaId: null,
      attempts: 3,
    };
    expect(deletableFiles([row])).toEqual([]);
    // Nor does the stored object alone release it: bytes in a bucket are not a `field_media` row.
    expect(deletableFiles([{ ...row, state: "UPLOADED" }])).toEqual([]);
    // Both conditions, and only together: the state and the server's own acknowledgement.
    expect(
      deletableFiles([{ ...row, state: "UPLOADED", serverMediaId: row.localId }]),
    ).toHaveLength(1);
  });
});
