import type { CommandResult } from "@eia/field-sync-contract";
import { describe, expect, it } from "vitest";

import {
  backoffFor,
  dispositionFor,
  dispositionForTransportFailure,
  RETRY_BACKOFF_MS,
} from "../src/core/outbox-policy";

const base: Omit<CommandResult, "outcome"> = {
  commandId: "00000000-0000-4000-8000-000000000001",
  visitId: null,
  instanceId: null,
  instanceStatus: null,
  assignmentStatus: null,
  conflictReason: null,
  message: null,
};

describe("what the queue does with each answer", () => {
  it("removes a command the server settled, however it settled it", () => {
    for (const outcome of ["applied", "duplicate", "superseded"] as const) {
      expect(dispositionFor({ ...base, outcome }).kind, outcome).toBe("done");
    }
  });

  it("stops retrying a conflict and keeps the local work", () => {
    const disposition = dispositionFor({
      ...base,
      outcome: "conflict",
      conflictReason: "assignment_reassigned",
      message: "Tu trabajo local se conservó.",
    });
    expect(disposition.kind).toBe("conflict");
    if (disposition.kind === "conflict") {
      expect(disposition.reason).toBe("assignment_reassigned");
      expect(disposition.message).toContain("conservó");
    }
  });

  it("stops retrying something the server refused", () => {
    // The failure this prevents: one impossible command at the head of the queue blocking every
    // command behind it, for ever, while the technician watches a count that never reaches zero.
    expect(dispositionFor({ ...base, outcome: "rejected" }).kind).toBe("failed");
  });

  it("always retries a command that never reached the server", () => {
    const disposition = dispositionForTransportFailure("network request failed");
    expect(disposition.kind).toBe("retry");
  });
});

describe("backoff", () => {
  it("starts immediately and levels off rather than growing without bound", () => {
    expect(backoffFor(0)).toBe(0);
    expect(backoffFor(1)).toBeGreaterThan(0);
    expect(backoffFor(99)).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i += 1) {
      expect(backoffFor(i)).toBeGreaterThan(backoffFor(i - 1));
    }
  });
});
