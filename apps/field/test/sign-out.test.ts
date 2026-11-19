import { describe, expect, it } from "vitest";

import { decideSignOut } from "../src/core/sign-out";
import type { PendingWorkSummary } from "../src/core/project-switch";

const NOTHING: PendingWorkSummary = {
  outboxPending: 0,
  outboxFailed: 0,
  unsyncedSurveys: 0,
  pendingMedia: 0,
  unsettledDeliveries: 0,
  pendingEvidence: 0,
};

/**
 * Signing out deletes the local database, so this decision is the last thing standing between a
 * stray tap and a technician's day. Each case below is a shape the previous guard — "are there
 * commands in state PENDING?" — answered *allowed* while the device was still holding work.
 */
describe("decideSignOut", () => {
  it("allows it when the device is holding nothing", () => {
    expect(decideSignOut(NOTHING)).toEqual({ kind: "allowed" });
  });

  it("refuses for a draft that never produced a command", () => {
    const decision = decideSignOut({ ...NOTHING, unsyncedSurveys: 1 });
    expect(decision.kind).toBe("blocked");
    if (decision.kind !== "blocked") return;
    expect(decision.blocking).toEqual(["unsyncedSurveys"]);
    expect(decision.total).toBe(1);
  });

  it("refuses for a photograph still waiting to upload, with the queue empty", () => {
    const decision = decideSignOut({ ...NOTHING, pendingMedia: 2 });
    expect(decision.kind).toBe("blocked");
    if (decision.kind !== "blocked") return;
    expect(decision.blocking).toEqual(["pendingMedia"]);
    expect(decision.total).toBe(2);
  });

  it("refuses for a command that failed, which is not PENDING", () => {
    expect(decideSignOut({ ...NOTHING, outboxFailed: 1 }).kind).toBe("blocked");
  });

  it("refuses for a delivery attempt whose evidence has not gone up", () => {
    expect(decideSignOut({ ...NOTHING, pendingEvidence: 1 }).kind).toBe("blocked");
  });

  it("names every kind that is holding it up, and totals them", () => {
    const decision = decideSignOut({
      ...NOTHING,
      outboxPending: 1,
      unsyncedSurveys: 2,
      pendingMedia: 3,
    });
    expect(decision.kind).toBe("blocked");
    if (decision.kind !== "blocked") return;
    expect(decision.blocking).toEqual(["outboxPending", "unsyncedSurveys", "pendingMedia"]);
    expect(decision.total).toBe(6);
  });
});
