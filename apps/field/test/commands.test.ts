import { FIELD_SYNC_PROTOCOL_VERSION, syncCommandSchema } from "@eia/field-sync-contract";
import { describe, expect, it } from "vitest";

import {
  surveyDraftCommand,
  surveySubmitCommand,
  visitStartCommand,
  withResolvedVisitId,
  type CommandContext,
} from "../src/core/commands";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function context(id: number, revision = 1): CommandContext {
  return {
    appVersion: "0.1.0",
    deviceRevision: revision,
    occurredAt: new Date("2026-10-01T12:00:00.000Z"),
    newId: () => uuid(id),
  };
}

describe("forming a command", () => {
  it("produces something the shared contract accepts", () => {
    const command = visitStartCommand(context(1), {
      assignmentId: uuid(10),
      location: null,
      locationOutcome: "not_attempted",
    });
    expect(syncCommandSchema.safeParse(command).success).toBe(true);
    expect(command.protocolVersion).toBe(FIELD_SYNC_PROTOCOL_VERSION);
  });

  it("names the version the device downloaded, so the server can refuse a mismatch", () => {
    const command = surveySubmitCommand(context(2), {
      assignmentId: uuid(10),
      visitId: uuid(11),
      surveyVersionId: uuid(12),
      answers: {},
    });
    if (command.type !== "survey.submit") throw new Error("expected a submit");
    expect(command.payload.surveyVersionId).toBe(uuid(12));
  });

  it("carries the device revision, which is what orders one device's own edits", () => {
    const first = surveyDraftCommand(context(3, 1), {
      assignmentId: uuid(10),
      visitId: null,
      surveyVersionId: uuid(12),
      answers: {},
    });
    const second = surveyDraftCommand(context(4, 2), {
      assignmentId: uuid(10),
      visitId: null,
      surveyVersionId: uuid(12),
      answers: {},
    });
    expect(second.deviceRevision).toBeGreaterThan(first.deviceRevision);
  });
});

describe("filling in a visit id the device did not have yet", () => {
  /**
   * The sequence: a technician starts a visit and fills the whole survey with no signal, so the
   * submit is formed before `visit.start` was ever acknowledged and cannot name a server visit.
   */
  it("patches the payload and leaves the command id alone", () => {
    const submit = surveySubmitCommand(context(5), {
      assignmentId: uuid(10),
      visitId: null,
      surveyVersionId: uuid(12),
      answers: {},
    });
    const patched = withResolvedVisitId(submit, uuid(13));
    expect(patched.type).toBe("survey.submit");
    if (patched.type === "survey.submit") expect(patched.payload.visitId).toBe(uuid(13));
    // The identity of the intent must survive the patch, or the server would see a new command.
    expect(patched.commandId).toBe(submit.commandId);
  });

  it("never overwrites a visit id the device already knows", () => {
    const submit = surveySubmitCommand(context(6), {
      assignmentId: uuid(10),
      visitId: uuid(14),
      surveyVersionId: uuid(12),
      answers: {},
    });
    const patched = withResolvedVisitId(submit, uuid(99));
    if (patched.type === "survey.submit") expect(patched.payload.visitId).toBe(uuid(14));
  });

  it("leaves a visit command untouched", () => {
    const start = visitStartCommand(context(7), {
      assignmentId: uuid(10),
      location: null,
      locationOutcome: "denied",
    });
    expect(withResolvedVisitId(start, uuid(15))).toBe(start);
  });
});
