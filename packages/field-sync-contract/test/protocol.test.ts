import { answerInputSchema } from "@eia/domain";
import { describe, expect, it } from "vitest";

import {
  COMMAND_OUTCOMES,
  CONFLICT_REASON_LABEL,
  CONFLICT_REASONS,
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION,
  LOCAL_SURVEY_STATE_LABEL,
  LOCAL_SURVEY_STATES,
  syncCommandSchema,
  syncPushRequestSchema,
  SYNC_PUSH_LIMIT,
  wireAnswerSchema,
} from "../src/index";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const envelope = {
  commandId: uuid(1),
  protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
  deviceRevision: 3,
  occurredAt: "2026-10-01T12:00:00.000Z",
  appVersion: "0.1.0",
  packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
};

describe("the wire answer and the domain answer are the same thing", () => {
  /**
   * The check that matters most in this file. The contract package restates the domain's answer
   * union so it can keep a single dependency; a near-miss would be worse than either, because the
   * mapping between them is where a `MULTI_CHOICE` quietly loses its second option.
   */
  const cases = [
    { kind: "text", value: "una respuesta" },
    { kind: "number", value: 4 },
    { kind: "boolean", value: true },
    { kind: "date", value: "2026-10-01" },
    { kind: "option", optionCode: "SI" },
    { kind: "options", optionCodes: ["A", "B"] },
    { kind: "blank" },
  ];

  it("every shape one accepts, the other accepts", () => {
    for (const value of cases) {
      expect(wireAnswerSchema.safeParse(value).success, JSON.stringify(value)).toBe(true);
      expect(answerInputSchema.safeParse(value).success, JSON.stringify(value)).toBe(true);
    }
  });

  it("every shape one rejects, the other rejects", () => {
    const bad = [
      { kind: "choice", value: ["A"] },
      { kind: "text", value: 4 },
      { kind: "option", optionCode: "" },
      { kind: "number", value: Number.POSITIVE_INFINITY },
      { kind: "date", value: "01/10/2026" },
    ];
    for (const value of bad) {
      expect(wireAnswerSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
      expect(answerInputSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

describe("the command envelope", () => {
  it("accepts a visit, a draft, a submit and a finish", () => {
    const commands = [
      {
        ...envelope,
        type: "visit.start",
        payload: { assignmentId: uuid(2), location: null, locationOutcome: "denied" },
      },
      {
        ...envelope,
        type: "survey.upsert_draft",
        payload: {
          assignmentId: uuid(2),
          visitId: null,
          surveyVersionId: uuid(3),
          answers: { Q1: { kind: "text", value: "x" } },
        },
      },
      {
        ...envelope,
        type: "survey.submit",
        payload: {
          assignmentId: uuid(2),
          visitId: uuid(4),
          surveyVersionId: uuid(3),
          answers: {},
        },
      },
      { ...envelope, type: "visit.finish", payload: { assignmentId: uuid(2), visitId: uuid(4) } },
    ];
    for (const command of commands) {
      expect(syncCommandSchema.safeParse(command).success, command.type).toBe(true);
    }
  });

  it("refuses a command that names a user: identity comes from the session, never the device", () => {
    const forged = {
      ...envelope,
      type: "visit.start",
      userId: uuid(9),
      payload: { assignmentId: uuid(2), location: null, locationOutcome: "denied" },
    };
    expect(syncCommandSchema.safeParse(forged).success).toBe(false);
  });

  it("refuses a protocol version it does not speak", () => {
    const future = {
      ...envelope,
      protocolVersion: 99,
      type: "visit.finish",
      payload: { assignmentId: uuid(2), visitId: uuid(4) },
    };
    expect(syncCommandSchema.safeParse(future).success).toBe(false);
  });

  it("refuses a fabricated coordinate outside the world", () => {
    const impossible = {
      ...envelope,
      type: "visit.start",
      payload: {
        assignmentId: uuid(2),
        location: { latitude: 120, longitude: 0, accuracyM: null, capturedAt: envelope.occurredAt },
        locationOutcome: "captured",
      },
    };
    expect(syncCommandSchema.safeParse(impossible).success).toBe(false);
  });
});

describe("a push", () => {
  it("is bounded: a failure costs a round trip, never a day's work", () => {
    const command = {
      ...envelope,
      type: "visit.finish",
      payload: { assignmentId: uuid(2), visitId: uuid(4) },
    };
    const commands = Array.from({ length: SYNC_PUSH_LIMIT + 1 }, (_, index) => ({
      ...command,
      commandId: uuid(100 + index),
    }));
    expect(
      syncPushRequestSchema.safeParse({ tenantSlug: "t", projectSlug: "p", commands }).success,
    ).toBe(false);
    expect(
      syncPushRequestSchema.safeParse({
        tenantSlug: "t",
        projectSlug: "p",
        commands: commands.slice(0, SYNC_PUSH_LIMIT),
      }).success,
    ).toBe(true);
  });
});

describe("the vocabularies both sides read", () => {
  it("every local state and every conflict reason has Spanish a technician can act on", () => {
    for (const state of LOCAL_SURVEY_STATES) {
      expect(LOCAL_SURVEY_STATE_LABEL[state], state).toBeTruthy();
    }
    for (const reason of CONFLICT_REASONS) {
      expect(CONFLICT_REASON_LABEL[reason], reason).toBeTruthy();
    }
  });

  it("keeps the one distinction the product exists to make", () => {
    expect(LOCAL_SURVEY_STATE_LABEL.READY_TO_SYNC).toContain("dispositivo");
    expect(LOCAL_SURVEY_STATE_LABEL.READY_TO_SYNC).toContain("pendiente");
    expect(LOCAL_SURVEY_STATE_LABEL.SYNCED).toBe("Sincronizada");
  });

  it("names five outcomes, and only three of them settle a command", () => {
    expect([...COMMAND_OUTCOMES].sort()).toEqual([
      "applied",
      "conflict",
      "duplicate",
      "rejected",
      "superseded",
    ]);
  });
});
