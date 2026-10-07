import { answerInputSchema } from "@eia/domain";
import { describe, expect, it } from "vitest";

import {
  COMMAND_OUTCOMES,
  commandResultSchema,
  CONFLICT_REASONS,
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_PACK_SCHEMA_VERSION_V4,
  FIELD_SYNC_PROTOCOL_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION_V4,
  LOCAL_SURVEY_STATES,
  syncCommandSchema,
  syncPushRequestSchema,
  SYNC_PUSH_LIMIT,
  v4CommandResultSchema,
  wireAnswerSchema,
  workPullRequestSchema,
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
  it("names the states and reasons the phone puts into words", () => {
    // The words are `mobile.localSurveyState.*` and `mobile.conflictReason.*` in `@eia/i18n`, in
    // both languages; a protocol that carried one language's copy would change version every time
    // a sentence was reworded. What the wire owns is the set, and the catalogue is checked
    // against it.
    expect([...LOCAL_SURVEY_STATES]).toContain("READY_TO_SYNC");
    expect([...CONFLICT_REASONS]).toContain("assignment_reassigned");
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

/* ---------------------------------------------------------------------------------------------
 * Protocol v4 (ADR-041), and the v3 it must not disturb
 * ------------------------------------------------------------------------------------------ */

describe("the v4 pull request is one shape, shared by both ends", () => {
  /*
   * It briefly was not: the contract declared a `cursor` while the route and the client both
   * sent two arrays of ids. A wire format only one side believes in is exactly what this
   * package exists to prevent, so the schema now *is* the wire — the route imports it and the
   * client parses against it on the way out.
   */
  const valid = {
    tenantSlug: "consultora",
    projectSlug: "via-a",
    knownAssignmentIds: ["0199f3a2-7c41-7abc-8d0f-000000000001"],
    knownInvitationIds: [],
  };

  it("accepts what the device actually sends", () => {
    expect(workPullRequestSchema.parse(valid)).toEqual(valid);
  });

  it("defaults the two arrays, so a first pull need not spell them out", () => {
    const parsed = workPullRequestSchema.parse({ tenantSlug: "c", projectSlug: "v" });
    expect(parsed.knownAssignmentIds).toEqual([]);
    expect(parsed.knownInvitationIds).toEqual([]);
  });

  it("refuses the cursor it used to declare, and anything else unknown", () => {
    // `.strict()`: a field the server does not read must not be one a client can believe in.
    expect(workPullRequestSchema.safeParse({ ...valid, cursor: "abc" }).success).toBe(false);
    expect(workPullRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe("v3 is not disturbed by v4", () => {
  it("keeps its version numbers, so a signed build is not silently re-pointed", () => {
    expect(FIELD_SYNC_PROTOCOL_VERSION).toBe(3);
    expect(FIELD_PACK_SCHEMA_VERSION).toBe(1);
    expect(FIELD_SYNC_PROTOCOL_VERSION_V4).toBe(4);
    expect(FIELD_PACK_SCHEMA_VERSION_V4).toBe(2);
  });

  it("and a v3 command still parses exactly as it did", () => {
    // The case that matters for an update: a command already in the outbox when the application
    // was replaced. Its `commandId` is untouched, its meaning is untouched, and the v4 route
    // rewrites only the envelope's version before handing it to v3's own engine.
    const v3Command = {
      commandId: "0199f3a2-7c41-7abc-8d0f-000000000001",
      protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
      deviceRevision: 1,
      occurredAt: "2026-11-12T19:00:00.000Z",
      appVersion: "0.1.0",
      packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
      type: "visit.finish",
      payload: {
        assignmentId: "0199f3a2-7c41-7abc-8d0f-000000000002",
        visitId: "0199f3a2-7c41-7abc-8d0f-000000000003",
      },
    };
    expect(syncCommandSchema.safeParse(v3Command).success).toBe(true);

    // The same command with a v4 envelope is refused by v3's union — which is what the version
    // number is for — and accepted once the route rewrites it.
    const withV4Envelope = { ...v3Command, protocolVersion: FIELD_SYNC_PROTOCOL_VERSION_V4 };
    expect(syncCommandSchema.safeParse(withV4Envelope).success).toBe(false);
    expect(
      syncCommandSchema.safeParse({
        ...withV4Envelope,
        protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
      }).success,
    ).toBe(true);
  });

  it("and v3's result object refuses the two fields a delivery carries", () => {
    // The reason a v4 receipt is read with v4's schema: `.strict()` doing its job.
    const v4Shaped = {
      commandId: "0199f3a2-7c41-7abc-8d0f-000000000001",
      outcome: "applied",
      visitId: null,
      instanceId: null,
      instanceStatus: null,
      assignmentStatus: null,
      conflictReason: null,
      message: null,
      attemptId: "0199f3a2-7c41-7abc-8d0f-000000000004",
      invitationStatus: "DELIVERED",
    };
    expect(commandResultSchema.safeParse(v4Shaped).success).toBe(false);
    expect(v4CommandResultSchema.safeParse(v4Shaped).success).toBe(true);
  });
});
