import {
  parcelFieldStateOf,
  PARCEL_FIELD_STATE_PRESENTATION,
  PARCEL_FIELD_STATES,
} from "@eia/domain";
import { describe, expect, it } from "vitest";

/**
 * The order is the logic, so the tests are about which state wins when several are true.
 */
describe("parcelFieldStateOf", () => {
  it("an open correction wins over a submitted response", () => {
    // The parcel has an answer *and* somebody has said it is wrong. "Con ficha" would be a map
    // telling a coordinator the work there is finished.
    expect(parcelFieldStateOf({ assigned: 1, submitted: 1, correctionsOpen: 1 })).toBe(
      "correcting",
    );
  });

  it("a submitted response wins over a bare assignment", () => {
    expect(parcelFieldStateOf({ assigned: 1, submitted: 1, correctionsOpen: 0 })).toBe("answered");
  });

  it("an assignment with nothing back is assigned, not answered", () => {
    expect(parcelFieldStateOf({ assigned: 2, submitted: 0, correctionsOpen: 0 })).toBe("assigned");
  });

  it("no field work at all is a state of its own, not a missing value", () => {
    expect(parcelFieldStateOf({ assigned: 0, submitted: 0, correctionsOpen: 0 })).toBe(
      "unassigned",
    );
    // A parcel the progress query returned no row for can only be one with no work; it is never
    // "we may not tell you", which the read model reports separately and the surface refuses on.
    expect(parcelFieldStateOf(undefined)).toBe("unassigned");
  });

  it("every state has a glyph, because colour alone never carries a state", () => {
    for (const state of PARCEL_FIELD_STATES) {
      expect(PARCEL_FIELD_STATE_PRESENTATION[state].glyph).toMatch(/\S/);
    }
    const glyphs = PARCEL_FIELD_STATES.map((s) => PARCEL_FIELD_STATE_PRESENTATION[s].glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
