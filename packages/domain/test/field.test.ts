import { describe, expect, it } from "vitest";

import {
  answerInputSchema,
  ASSIGNMENT_STATUSES,
  assertCampaignActivatable,
  assertCaptureChannelSatisfiesOfflineMode,
  assertInstanceEditable,
  assertAssignmentTransition,
  assertSubmissionComplete,
  assertSurveyVersionPublishable,
  campaignProgress,
  captureChannel,
  captureChannelSatisfiesOfflineMode,
  CAPTURE_CHANNELS,
  FIELD_OFFLINE_MODES,
  InstanceAlreadySubmitted,
  InvalidAssignmentTransition,
  OfflineCaptureUnsupported,
  surveyVersionHash,
  validateAnswer,
  visitLocationSchema,
  type AnswerInput,
  type AssignmentStatus,
  type SurveyQuestionDefinition,
} from "../src/index";

/** The demo questionnaire's shape, small enough to read and typed like the real one. */
const question = (
  overrides: Partial<SurveyQuestionDefinition> & Pick<SurveyQuestionDefinition, "code" | "type">,
): SurveyQuestionDefinition => ({
  ordinal: 0,
  prompt: "¿Pregunta?",
  helpText: null,
  required: false,
  sensitivity: "NON_PERSONAL",
  options: [],
  ...overrides,
});

const tenure = question({
  code: "tenure_category",
  type: "SINGLE_CHOICE",
  ordinal: 0,
  required: true,
  options: [
    { code: "owner_occupier", label: "Propietario residente", ordinal: 0 },
    { code: "tenant", label: "Arrendatario", ordinal: 1 },
  ],
});
const services = question({
  code: "services_present",
  type: "MULTI_CHOICE",
  ordinal: 1,
  options: [
    { code: "water", label: "Agua", ordinal: 0 },
    { code: "power", label: "Energía", ordinal: 1 },
  ],
});
const years = question({ code: "years_in_parcel", type: "INTEGER", ordinal: 2 });
const note = question({ code: "field_note", type: "LONG_TEXT", ordinal: 3 });

describe("offline capture is configuration, not capability (D-020)", () => {
  it("names three modes and no fifteenth capability key", () => {
    expect(FIELD_OFFLINE_MODES).toEqual(["disabled", "optional", "required"]);
  });

  it("the only capture channel we built says plainly that it cannot work offline", () => {
    expect(CAPTURE_CHANNELS).toEqual(["NATIVE_WEB"]);
    expect(captureChannel("NATIVE_WEB").supportsOffline).toBe(false);
  });

  it("disabled and optional accept the online-only channel", () => {
    for (const mode of ["disabled", "optional"] as const) {
      expect(captureChannelSatisfiesOfflineMode("NATIVE_WEB", mode)).toBe(true);
      expect(() => assertCaptureChannelSatisfiesOfflineMode("NATIVE_WEB", mode)).not.toThrow();
    }
  });

  it("required refuses the online-only channel rather than pretending", () => {
    expect(captureChannelSatisfiesOfflineMode("NATIVE_WEB", "required")).toBe(false);
    expect(() => assertCaptureChannelSatisfiesOfflineMode("NATIVE_WEB", "required")).toThrow(
      OfflineCaptureUnsupported,
    );
  });

  it("the refusal names the setting a coordinator has to change", () => {
    try {
      assertCaptureChannelSatisfiesOfflineMode("NATIVE_WEB", "required");
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("field.surveys.offline_mode");
      expect((error as Error).message).toContain("NATIVE_WEB");
    }
  });
});

describe("campaign activation", () => {
  const activatable = {
    status: "DRAFT",
    surveyVersionStatus: "PUBLISHED",
    assignmentCount: 3,
    captureChannel: "NATIVE_WEB",
    offlineMode: "disabled",
  } as const;

  it("accepts a draft with a published questionnaire and work to do", () => {
    expect(() => assertCampaignActivatable(activatable)).not.toThrow();
  });

  it("refuses a draft questionnaire, because it can still change under the answers", () => {
    expect(() =>
      assertCampaignActivatable({ ...activatable, surveyVersionStatus: "DRAFT" }),
    ).toThrow(/published/i);
  });

  it("refuses a campaign nobody has been assigned to", () => {
    expect(() => assertCampaignActivatable({ ...activatable, assignmentCount: 0 })).toThrow(
      /assignments/i,
    );
  });

  it("refuses to reopen a closed campaign", () => {
    expect(() => assertCampaignActivatable({ ...activatable, status: "CLOSED" })).toThrow(
      /closed/i,
    );
  });

  it("fails at activation when the project requires offline capture (D-020)", () => {
    expect(() => assertCampaignActivatable({ ...activatable, offlineMode: "required" })).toThrow(
      OfflineCaptureUnsupported,
    );
  });
});

describe("assignment lifecycle", () => {
  it("moves forward only", () => {
    expect(() => assertAssignmentTransition("PENDING", "IN_PROGRESS")).not.toThrow();
    expect(() => assertAssignmentTransition("IN_PROGRESS", "COMPLETED")).not.toThrow();
    expect(() => assertAssignmentTransition("COMPLETED", "IN_PROGRESS")).toThrow(
      InvalidAssignmentTransition,
    );
    expect(() => assertAssignmentTransition("CANCELLED", "PENDING")).toThrow(
      InvalidAssignmentTransition,
    );
  });

  it("a completed assignment is terminal", () => {
    expect(() => assertAssignmentTransition("COMPLETED", "CANCELLED")).toThrow();
  });
});

describe("a submitted response is final", () => {
  it("a draft is editable", () => {
    expect(() => assertInstanceEditable("IN_PROGRESS", "id")).not.toThrow();
  });

  it("a submitted response is not edited in place", () => {
    expect(() => assertInstanceEditable("SUBMITTED", "id")).toThrow(InstanceAlreadySubmitted);
  });
});

describe("progress is counted, never stored", () => {
  const counts = (over: Partial<Record<AssignmentStatus, number>>) => {
    const base = Object.fromEntries(ASSIGNMENT_STATUSES.map((s) => [s, 0])) as Record<
      AssignmentStatus,
      number
    >;
    return { ...base, ...over };
  };

  it("divides completed by the assignable total", () => {
    const progress = campaignProgress(counts({ PENDING: 6, IN_PROGRESS: 2, COMPLETED: 4 }));
    expect(progress.total).toBe(12);
    expect(progress.completionRatio).toBeCloseTo(4 / 12);
  });

  it("excludes cancelled work from the denominator, not from the total", () => {
    const progress = campaignProgress(counts({ COMPLETED: 4, PENDING: 4, CANCELLED: 4 }));
    expect(progress.total).toBe(12);
    expect(progress.completionRatio).toBeCloseTo(4 / 8);
  });

  it("reports no ratio rather than zero when nothing is assignable", () => {
    expect(campaignProgress(counts({})).completionRatio).toBeNull();
    expect(campaignProgress(counts({ CANCELLED: 3 })).completionRatio).toBeNull();
  });
});

describe("a questionnaire that can be answered", () => {
  it("accepts the demo shape", () => {
    expect(() => assertSurveyVersionPublishable([tenure, services, years, note])).not.toThrow();
  });

  it("refuses an empty version", () => {
    expect(() => assertSurveyVersionPublishable([])).toThrow(/no questions/i);
  });

  it("refuses duplicate codes and duplicate positions, so order is deterministic", () => {
    expect(() =>
      assertSurveyVersionPublishable([years, { ...note, code: "years_in_parcel" }]),
    ).toThrow(/more than once/i);
    expect(() => assertSurveyVersionPublishable([years, { ...note, ordinal: 2 }])).toThrow(
      /position/i,
    );
  });

  it("refuses a choice question with fewer than two options", () => {
    expect(() =>
      assertSurveyVersionPublishable([{ ...tenure, options: [tenure.options[0]!] }]),
    ).toThrow(/two options/i);
  });

  it("refuses options on a question that has no options", () => {
    expect(() => assertSurveyVersionPublishable([{ ...years, options: tenure.options }])).toThrow(
      /carries options/i,
    );
  });

  it("refuses a code that is not lower snake_case", () => {
    expect(() => assertSurveyVersionPublishable([{ ...years, code: "Years In Parcel" }])).toThrow(
      /valid code/i,
    );
  });
});

describe("the definition fingerprint", () => {
  it("is stable across question order in the array, but not across a real edit", () => {
    const a = surveyVersionHash([tenure, services, years]);
    const b = surveyVersionHash([years, tenure, services]);
    expect(a).toBe(b);

    const renamed = surveyVersionHash([{ ...tenure, prompt: "¿Otra cosa?" }, services, years]);
    expect(renamed).not.toBe(a);
  });

  it("changes when an option is removed", () => {
    const before = surveyVersionHash([tenure]);
    const after = surveyVersionHash([{ ...tenure, options: [tenure.options[0]!] }]);
    expect(after).not.toBe(before);
  });
});

describe("an answer is checked against the question that was asked", () => {
  it("accepts each type in its own column", () => {
    expect(() => validateAnswer(tenure, { kind: "option", optionCode: "tenant" })).not.toThrow();
    expect(() =>
      validateAnswer(services, { kind: "options", optionCodes: ["water", "power"] }),
    ).not.toThrow();
    expect(() => validateAnswer(years, { kind: "number", value: 12 })).not.toThrow();
    expect(() => validateAnswer(note, { kind: "text", value: "sin novedad" })).not.toThrow();
  });

  it("refuses a value of the wrong type", () => {
    expect(() => validateAnswer(years, { kind: "text", value: "doce" })).toThrow(/number/i);
    expect(() => validateAnswer(note, { kind: "number", value: 3 })).toThrow(/text/i);
    expect(() => validateAnswer(tenure, { kind: "text", value: "propietario" })).toThrow(
      /one option/i,
    );
  });

  it("refuses a decimal where a whole number was asked for", () => {
    expect(() => validateAnswer(years, { kind: "number", value: 12.5 })).toThrow(/whole number/i);
  });

  it("refuses an option code that belongs to another version of the questionnaire", () => {
    // The v1/v2 case: `option_z` exists in v2 and never existed here.
    expect(() => validateAnswer(tenure, { kind: "option", optionCode: "option_z" })).toThrow(
      /not an option of this question in this survey version/i,
    );
  });

  it("refuses the same multi-choice option twice", () => {
    expect(() =>
      validateAnswer(services, { kind: "options", optionCodes: ["water", "water"] }),
    ).toThrow(/twice/i);
  });

  it("treats a blank as an answer that is simply absent", () => {
    expect(() => validateAnswer(tenure, { kind: "blank" })).not.toThrow();
    expect(() => validateAnswer(note, { kind: "text", value: "   " })).not.toThrow();
  });
});

describe("submission is complete, drafting need not be", () => {
  const questions = [tenure, services, years, note];

  it("accepts a submission that answers every required question", () => {
    const answers = new Map<string, AnswerInput>([
      ["tenure_category", { kind: "option", optionCode: "owner_occupier" }],
    ]);
    expect(() => assertSubmissionComplete(questions, answers)).not.toThrow();
  });

  it("names the required questions that are missing", () => {
    expect(() => assertSubmissionComplete(questions, new Map())).toThrow(/tenure_category/);
  });

  it("treats a blank required answer as missing, not as answered", () => {
    const answers = new Map<string, AnswerInput>([["tenure_category", { kind: "blank" }]]);
    expect(() => assertSubmissionComplete(questions, answers)).toThrow(/tenure_category/);
  });

  it("refuses an answer to a question this version does not have, rather than dropping it", () => {
    const answers = new Map<string, AnswerInput>([
      ["tenure_category", { kind: "option", optionCode: "tenant" }],
      ["question_from_another_version", { kind: "text", value: "algo" }],
    ]);
    expect(() => assertSubmissionComplete(questions, answers)).toThrow(/does not exist/i);
  });
});

describe("an answer payload from a client is parsed, never trusted", () => {
  it("rejects an unknown kind and unknown keys", () => {
    expect(answerInputSchema.safeParse({ kind: "sql", value: "1" }).success).toBe(false);
    expect(
      answerInputSchema.safeParse({ kind: "text", value: "x", questionId: "spoofed" }).success,
    ).toBe(false);
  });

  it("rejects a date that is not an ISO day", () => {
    expect(answerInputSchema.safeParse({ kind: "date", value: "28/08/2026" }).success).toBe(false);
    expect(answerInputSchema.safeParse({ kind: "date", value: "2026-08-28" }).success).toBe(true);
  });
});

describe("a visit's location is validated, and never invented", () => {
  const base = { latitude: -4.07, longitude: -78.93, accuracyM: 12, capturedAt: new Date() };

  it("accepts a real fix", () => {
    expect(visitLocationSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a fix whose accuracy the device could not report", () => {
    expect(visitLocationSchema.safeParse({ ...base, accuracyM: null }).success).toBe(true);
  });

  it("rejects coordinates outside the world", () => {
    expect(visitLocationSchema.safeParse({ ...base, latitude: 91 }).success).toBe(false);
    expect(visitLocationSchema.safeParse({ ...base, longitude: -181 }).success).toBe(false);
  });

  it("rejects an accuracy that is not a positive distance", () => {
    expect(visitLocationSchema.safeParse({ ...base, accuracyM: 0 }).success).toBe(false);
    expect(visitLocationSchema.safeParse({ ...base, accuracyM: -5 }).success).toBe(false);
  });
});
