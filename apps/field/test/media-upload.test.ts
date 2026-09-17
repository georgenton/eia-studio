import { describe, expect, it } from "vitest";

import {
  deletableFiles,
  mediaStateFor,
  uploadOneMedia,
  type LocalMediaRow,
  type MediaTransport,
} from "../src/core/media-upload";
import { mediaDeclareCommand } from "../src/core/commands";

/**
 * Getting a photograph off a phone, tested where it actually fails.
 *
 * The happy path is one assertion. The rest of this file is the sequence failing at each of its
 * four steps, because that is what a valley with four seconds of signal produces — and the
 * property that must hold every time is the same: **the local file is still there**.
 */
const ROW: LocalMediaRow = {
  localId: "33333333-3333-4333-8333-333333333333",
  assignmentId: "11111111-1111-4111-8111-111111111111",
  visitId: "22222222-2222-4222-8222-222222222222",
  fileUri: "file:///data/eia-field/media/33333333.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1_842_000,
  state: "PENDING_UPLOAD",
  storedObjectId: null,
  serverMediaId: null,
  attempts: 0,
};

function transport(over: Partial<MediaTransport> = {}): MediaTransport {
  return {
    requestIntent: async () => ({
      intentId: "44444444-4444-4444-8444-444444444444",
      url: "https://provider.test/signed",
      headers: { "content-type": "image/jpeg" },
      objectKey: "t/a/p/b/field-media/c",
    }),
    putFile: async () => undefined,
    finalize: async () => ({ storedObjectId: "55555555-5555-4555-8555-555555555555" }),
    ...over,
  };
}

describe("advancing one photograph", () => {
  it("asks, uploads, finalizes, and hands back what the declaration must name", async () => {
    const step = await uploadOneMedia(ROW, transport());
    expect(step).toEqual({
      kind: "ready_to_declare",
      storedObjectId: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("holds a photograph taken before the visit was acknowledged", async () => {
    // Captured with no signal at all: `visit.start` is still queued, so there is no server visit
    // for the photograph to belong to. It waits, with its file, exactly as a draft does.
    const step = await uploadOneMedia({ ...ROW, visitId: null }, transport());
    expect(step).toEqual({ kind: "hold", reason: "no_visit_yet" });
  });

  it("does nothing to one the server has already acknowledged", async () => {
    const step = await uploadOneMedia({ ...ROW, serverMediaId: "m1" }, transport());
    expect(step).toEqual({ kind: "hold", reason: "already_uploaded" });
  });

  it("does not upload the same bytes twice when a previous attempt verified them", async () => {
    let asked = 0;
    const step = await uploadOneMedia(
      { ...ROW, storedObjectId: "55555555-5555-4555-8555-555555555555" },
      transport({
        requestIntent: async () => {
          asked += 1;
          throw new Error("should not be reached");
        },
      }),
    );
    expect(step).toEqual({
      kind: "ready_to_declare",
      storedObjectId: "55555555-5555-4555-8555-555555555555",
    });
    expect(asked).toBe(0);
  });
});

describe("every way the connection can fail", () => {
  const failures: ReadonlyArray<[string, Partial<MediaTransport>]> = [
    [
      "the intent never arrives",
      { requestIntent: async () => Promise.reject(new Error("offline")) },
    ],
    ["the PUT is cut off", { putFile: async () => Promise.reject(new Error("socket hang up")) }],
    ["the finalize is lost", { finalize: async () => Promise.reject(new Error("timeout")) }],
  ];

  it.each(failures)("%s: retry, and the row keeps its file", async (_label, over) => {
    const step = await uploadOneMedia(ROW, transport(over));
    expect(step.kind).toBe("retry");
    // Nothing in the sequence deletes, and nothing in it reports success it did not have.
    expect(deletableFiles([ROW])).toEqual([]);
  });

  it("bounds what a failure puts on the diagnostics screen", async () => {
    const step = await uploadOneMedia(
      ROW,
      transport({ requestIntent: async () => Promise.reject(new Error("x".repeat(5_000))) }),
    );
    expect(step.kind).toBe("retry");
    if (step.kind !== "retry") return;
    expect(step.detail.length).toBeLessThanOrEqual(200);
  });
});

describe("when a local file may be removed", () => {
  /*
   * The one irreversible action this feature takes. A file removed because an upload *looked*
   * finished is a photograph that no longer exists anywhere.
   */
  it("only after the server acknowledged the row", () => {
    const uploaded = { ...ROW, state: "UPLOADED" as const, serverMediaId: "m1" };
    expect(deletableFiles([uploaded])).toEqual([uploaded]);

    // Verified bytes are not an acknowledged row: the finalize succeeded and the declaration did
    // not, which is exactly the window a lost response opens.
    expect(
      deletableFiles([
        { ...ROW, state: "UPLOADED", storedObjectId: "o1", serverMediaId: null },
        { ...ROW, state: "UPLOADING", serverMediaId: null },
        { ...ROW, state: "FAILED", serverMediaId: null },
        ROW,
      ]),
    ).toEqual([]);
  });
});

describe("what the technician is told", () => {
  it("a photograph waiting for signal is pending, never failed", () => {
    expect(mediaStateFor(ROW)).toBe("PENDING_UPLOAD");
    expect(mediaStateFor({ ...ROW, state: "UPLOADING" })).toBe("UPLOADING");
    expect(mediaStateFor({ ...ROW, state: "FAILED" })).toBe("FAILED");
    // The server's acknowledgement wins over whatever the row last wrote about itself.
    expect(mediaStateFor({ ...ROW, state: "FAILED", serverMediaId: "m1" })).toBe("UPLOADED");
  });
});

describe("the declaration a retry sends", () => {
  it("carries the same localId however many times it is formed", () => {
    let n = 0;
    const ctx = {
      appVersion: "1.0.0",
      deviceRevision: 0,
      occurredAt: new Date("2026-09-17T14:05:00.000Z"),
      newId: () => `command-${(n += 1)}`.padEnd(36, "0"),
    };
    const input = {
      assignmentId: ROW.assignmentId,
      visitId: ROW.visitId!,
      localId: ROW.localId,
      storedObjectId: "55555555-5555-4555-8555-555555555555",
      kind: "parcel" as const,
      note: null,
      location: null,
    };
    // Two commands, because the caller formed the intent twice; one photograph, because `localId`
    // is what the server keys on.
    const first = mediaDeclareCommand(
      { ...ctx, newId: () => "66666666-6666-4666-8666-666666666666" },
      input,
    );
    const second = mediaDeclareCommand(
      { ...ctx, newId: () => "77777777-7777-4777-8777-777777777777" },
      input,
    );
    expect(first.commandId).not.toBe(second.commandId);
    if (first.type !== "media.declare" || second.type !== "media.declare") throw new Error("type");
    expect(first.payload.localId).toBe(second.payload.localId);
  });
});
