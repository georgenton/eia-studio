import {
  assertCorrectionRequestable,
  assertCorrectionTransition,
  CORRECTION_STATES,
  correctionGeneration,
  correctionReasonSchema,
  CorrectionNotOpen,
  InvalidInput,
  resolveEffectiveInstance,
  ResponseNotCorrectable,
  type CorrectionLink,
} from "../src/index";
import { describe, expect, it } from "vitest";

/**
 * Which response a study currently means, and the ways it must refuse to answer (ADR-038).
 */
const link = (
  originalInstanceId: string,
  correctingInstanceId: string | null,
  state: CorrectionLink["state"] = "APPLIED",
): CorrectionLink => ({ originalInstanceId, correctingInstanceId, state });

describe("the states, and the two that are deliberately absent", () => {
  it("has exactly requested, applied and cancelled", () => {
    expect([...CORRECTION_STATES]).toEqual(["REQUESTED", "APPLIED", "CANCELLED"]);
  });

  /*
   * `SUBMITTED` beside `APPLIED` would imply an approval step between capturing a correction and
   * it taking effect. There is none, and a state for a review nobody performs is the same fiction
   * as a report status nobody sets (TD-060).
   */
  it("does not pretend a correction is approved after it is captured", () => {
    expect(CORRECTION_STATES).not.toContain("SUBMITTED");
    expect(CORRECTION_STATES).not.toContain("IN_PROGRESS");
  });

  it("settles once, and never reopens", () => {
    expect(() => assertCorrectionTransition("REQUESTED", "APPLIED")).not.toThrow();
    expect(() => assertCorrectionTransition("REQUESTED", "CANCELLED")).not.toThrow();
    expect(() => assertCorrectionTransition("APPLIED", "CANCELLED")).toThrow(CorrectionNotOpen);
    expect(() => assertCorrectionTransition("CANCELLED", "APPLIED")).toThrow(CorrectionNotOpen);
    expect(() => assertCorrectionTransition("REQUESTED", "REQUESTED")).toThrow(InvalidInput);
  });
});

describe("what may be corrected", () => {
  const ok = { instanceStatus: "SUBMITTED", isEffective: true, hasOpenCorrection: false };

  it("accepts the submitted response a study currently means", () => {
    expect(() => assertCorrectionRequestable(ok)).not.toThrow();
  });

  it("refuses a response still being captured, which is edited rather than corrected", () => {
    expect(() => assertCorrectionRequestable({ ...ok, instanceStatus: "IN_PROGRESS" })).toThrow(
      ResponseNotCorrectable,
    );
  });

  /*
   * The rule that keeps a lineage a line. Correcting the original *after* correction 1 was applied
   * would leave two claimants to one household's answer, and nothing downstream could choose.
   */
  it("refuses a response that has already been superseded", () => {
    expect(() => assertCorrectionRequestable({ ...ok, isEffective: false })).toThrow(
      ResponseNotCorrectable,
    );
  });

  it("refuses a second request while one is open", () => {
    expect(() => assertCorrectionRequestable({ ...ok, hasOpenCorrection: true })).toThrow(
      ResponseNotCorrectable,
    );
  });
});

describe("the reason, which is words somebody wrote", () => {
  it("refuses an empty one and refuses 'ok'", () => {
    expect(correctionReasonSchema.safeParse("").success).toBe(false);
    expect(correctionReasonSchema.safeParse("ok").success).toBe(false);
    expect(correctionReasonSchema.safeParse("   listo   ").success).toBe(false);
  });

  it("accepts a sentence a coordinator would actually write", () => {
    const parsed = correctionReasonSchema.safeParse(
      "  La informante indica 5 personas y se registraron 3.  ",
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe(
      "La informante indica 5 personas y se registraron 3.",
    );
  });
});

describe("the effective response", () => {
  it("is the original when nothing has been corrected", () => {
    expect(resolveEffectiveInstance("a", [])).toBe("a");
  });

  it("is the correction once one has been applied", () => {
    expect(resolveEffectiveInstance("a", [link("a", "b")])).toBe("b");
  });

  it("follows a chain of corrections to its end", () => {
    const links = [link("a", "b"), link("b", "c"), link("c", "d")];
    expect(resolveEffectiveInstance("a", links)).toBe("d");
    expect(correctionGeneration("a", links)).toBe(3);
  });

  /*
   * The property that makes requesting a correction safe: asking for one changes no count. Only a
   * correction somebody actually captured supersedes anything.
   */
  it("ignores a correction that has been requested and not captured", () => {
    expect(resolveEffectiveInstance("a", [link("a", null, "REQUESTED")])).toBe("a");
    expect(correctionGeneration("a", [link("a", null, "REQUESTED")])).toBe(0);
  });

  it("ignores a cancelled correction entirely, even one that names a response", () => {
    expect(resolveEffectiveInstance("a", [link("a", "b", "CANCELLED")])).toBe("a");
  });

  it("keeps the first generations effective for their own lineage and no other", () => {
    const links = [link("a", "b"), link("x", "y")];
    expect(resolveEffectiveInstance("a", links)).toBe("b");
    expect(resolveEffectiveInstance("x", links)).toBe("y");
  });

  /*
   * Refused by a partial unique index in the database; stated here so the pure rule is total. A
   * function that silently picked one of two forks is how two screens come to disagree.
   */
  it("refuses a fork rather than choosing a branch", () => {
    expect(() => resolveEffectiveInstance("a", [link("a", "b"), link("a", "c")])).toThrow(
      InvalidInput,
    );
  });

  it("refuses a cycle rather than looping", () => {
    expect(() => resolveEffectiveInstance("a", [link("a", "b"), link("b", "a")])).toThrow(
      InvalidInput,
    );
  });

  /*
   * Order comes from the relation, never from a clock. Two corrections recorded in the same
   * millisecond still have exactly one order, which is why the links carry no timestamp at all.
   */
  it("does not depend on the order the links are read in", () => {
    const forwards = [link("a", "b"), link("b", "c")];
    const backwards = [link("b", "c"), link("a", "b")];
    expect(resolveEffectiveInstance("a", forwards)).toBe(resolveEffectiveInstance("a", backwards));
  });
});
