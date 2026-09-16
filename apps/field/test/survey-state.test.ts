import type { CommandOutcome, LocalSurveyState } from "@eia/field-sync-contract";
import { LOCAL_SURVEY_STATES } from "@eia/field-sync-contract";
import { describe, expect, it } from "vitest";

import {
  canApply,
  InvalidSurveyTransition,
  isLocallyEditable,
  isPendingSync,
  nextSurveyState,
  stateForOutcome,
} from "../src/core/survey-state";

describe("the local survey state machine", () => {
  it("a survey sent on the device is not a survey the server has", () => {
    const sent = nextSurveyState("DRAFT", { kind: "submitted_locally" });
    expect(sent).toBe("READY_TO_SYNC");
    expect(isPendingSync(sent)).toBe(true);
    expect(nextSurveyState(sent, { kind: "sync_acknowledged" })).toBe("SYNCED");
  });

  it("refuses to edit a survey the technician already sent", () => {
    expect(isLocallyEditable("READY_TO_SYNC")).toBe(false);
    expect(isLocallyEditable("SYNCING")).toBe(false);
    expect(isLocallyEditable("SYNCED")).toBe(false);
    expect(() => nextSurveyState("READY_TO_SYNC", { kind: "edited" })).toThrow(
      InvalidSurveyTransition,
    );
  });

  it("lets a technician fix a survey the server refused", () => {
    // A rejected command is the one case where reopening is right: the work never landed.
    expect(isLocallyEditable("SYNC_ERROR")).toBe(true);
    expect(nextSurveyState("SYNC_ERROR", { kind: "edited" })).toBe("DRAFT");
  });

  it("never leaves a conflicted survey", () => {
    for (const state of LOCAL_SURVEY_STATES) {
      if (state === "CONFLICT") {
        expect(canApply(state, "edited")).toBe(false);
        expect(canApply(state, "sync_started")).toBe(false);
      }
    }
  });

  it("only a state that was actually sent can become SYNCED", () => {
    expect(nextSurveyState("READY_TO_SYNC", { kind: "sync_acknowledged" })).toBe("SYNCED");
    expect(nextSurveyState("SYNCING", { kind: "sync_acknowledged" })).toBe("SYNCED");
    expect(() => nextSurveyState("DRAFT", { kind: "sync_acknowledged" })).toThrow();
  });
});

describe("what each server outcome does to a local survey", () => {
  const cases: ReadonlyArray<[CommandOutcome, LocalSurveyState]> = [
    ["applied", "SYNCED"],
    ["duplicate", "SYNCED"],
    // The subtle one: the server says the intent is obsolete and the work is accounted for. The
    // queue must stop, and the survey is done — not an error the technician has to look at.
    ["superseded", "SYNCED"],
    ["conflict", "CONFLICT"],
    ["rejected", "SYNC_ERROR"],
  ];

  for (const [outcome, expected] of cases) {
    it(`${outcome} → ${expected}`, () => {
      expect(stateForOutcome("READY_TO_SYNC", outcome)).toBe(expected);
    });
  }

  it("does not move a survey that is already settled", () => {
    expect(stateForOutcome("SYNCED", "applied")).toBe("SYNCED");
    expect(stateForOutcome("CONFLICT", "applied")).toBe("CONFLICT");
  });
});
