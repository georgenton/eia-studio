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

  /**
   * The badge reads *Dato histórico*, so the regime has to say the datum is historical.
   *
   * A live campaign's progress is `[ORIGINAL]` and `AGGREGATE` — the same shape a verified
   * historical figure has — so without the regime condition it earned the badge and told the
   * reader a figure computed minutes ago was a fact of the finished study. The demonstration
   * project could not show this, because there the aggregates really are historical.
   */
  it("an operational aggregate is not a historical one", () => {
    expect(
      deriveSourceTypeLabel({
        regime: "LIVE_OPERATIONAL",
        origin: "SYSTEM_GENERATED",
        transformations: ["ORIGINAL"],
        granularity: "AGGREGATE",
      }),
    ).toBeNull();
    // The same facets, only historical, keep the badge they always had.
    expect(
      deriveSourceTypeLabel({
        regime: "HISTORICAL_OBSERVED",
        origin: "SYSTEM_GENERATED",
        transformations: ["ORIGINAL"],
        granularity: "AGGREGATE",
      }),
    ).toBe("REAL_AGGREGATE");
  });

  it("the other three labels are unaffected by the regime condition", () => {
    // Demo still wins over everything, including an operational aggregate.
    expect(
      deriveSourceTypeLabel({
        regime: "DEMO_SIMULATION",
        origin: "SYSTEM_GENERATED",
        transformations: ["ORIGINAL"],
        granularity: "AGGREGATE",
      }),
    ).toBe("SYNTHETIC");
    // An operational derived figure keeps *Dato calculado*.
    expect(
      deriveSourceTypeLabel({
        regime: "LIVE_OPERATIONAL",
        origin: "SYSTEM_GENERATED",
        transformations: ["ORIGINAL", "DERIVED"],
        granularity: "AGGREGATE",
      }),
    ).toBe("RECONSTRUCTED");
    // Anonymised keeps its precedence whatever the regime.
    expect(
      deriveSourceTypeLabel({
        regime: "LIVE_OPERATIONAL",
        origin: "FIELD_CAPTURE",
        transformations: ["ANONYMIZED"],
        granularity: "AGGREGATE",
      }),
    ).toBe("ANONYMIZED");
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
