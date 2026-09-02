import { describe, expect, it } from "vitest";

import { deriveSourceTypeLabel, needsDemoBadge } from "../src/index";

describe("deriveSourceTypeLabel (PROVENANCE.md §2.5 worked examples)", () => {
  it("maps the worked examples", () => {
    expect(
      deriveSourceTypeLabel({
        regime: "HISTORICAL_OBSERVED",
        origin: "IMPORTED_DOCUMENT",
        transformations: ["ORIGINAL"],
        granularity: "AGGREGATE",
      }),
    ).toBe("REAL_AGGREGATE");
    expect(
      deriveSourceTypeLabel({
        regime: "HISTORICAL_OBSERVED",
        origin: "IMPORTED_DATASET",
        transformations: ["ANONYMIZED"],
        granularity: "INDIVIDUAL",
      }),
    ).toBe("ANONYMIZED");
    expect(
      deriveSourceTypeLabel({
        regime: "HISTORICAL_OBSERVED",
        origin: "SYSTEM_GENERATED",
        transformations: ["ANONYMIZED", "DERIVED"],
        granularity: "AGGREGATE",
      }),
    ).toBe("ANONYMIZED");
    expect(
      deriveSourceTypeLabel({
        regime: "HISTORICAL_OBSERVED",
        origin: "IMPORTED_DATASET",
        transformations: ["RECONSTRUCTED"],
        granularity: null,
      }),
    ).toBe("RECONSTRUCTED");
    expect(
      deriveSourceTypeLabel({
        regime: "DEMO_SIMULATION",
        origin: "SYSTEM_GENERATED",
        transformations: ["ORIGINAL"],
        granularity: "INDIVIDUAL",
      }),
    ).toBe("SYNTHETIC");
    expect(
      deriveSourceTypeLabel({
        regime: "LIVE_OPERATIONAL",
        origin: "SYSTEM_GENERATED",
        transformations: ["DERIVED"],
        granularity: "AGGREGATE",
      }),
    ).toBe("RECONSTRUCTED");
    expect(
      deriveSourceTypeLabel({
        regime: "LIVE_OPERATIONAL",
        origin: "FIELD_CAPTURE",
        transformations: ["ORIGINAL"],
        granularity: "INDIVIDUAL",
      }),
    ).toBeNull();
  });

  it("DEMO regime always wins", () => {
    expect(
      deriveSourceTypeLabel({
        regime: "DEMO_SIMULATION",
        origin: "IMPORTED_DOCUMENT",
        transformations: ["ANONYMIZED", "DERIVED"],
        granularity: "AGGREGATE",
      }),
    ).toBe("SYNTHETIC");
    expect(
      needsDemoBadge([
        {
          regime: "HISTORICAL_OBSERVED",
          origin: "IMPORTED_DOCUMENT",
          transformations: ["ORIGINAL"],
          granularity: "AGGREGATE",
        },
        {
          regime: "DEMO_SIMULATION",
          origin: "SYSTEM_GENERATED",
          transformations: ["DERIVED"],
          granularity: "AGGREGATE",
        },
      ]),
    ).toBe(true);
  });
});
