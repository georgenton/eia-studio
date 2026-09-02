import { appSchema } from "@eia/db";
import { describe, expect, it } from "vitest";

import {
  PROJECT_ROLES,
  TENANT_ROLES,
  REGIMES,
  ORIGINS,
  TRANSFORMATIONS,
  GRANULARITIES,
  provenanceFacetsSchema,
} from "@eia/domain";

describe("db ↔ domain vocabulary alignment", () => {
  it("role enums in the database equal the domain role lists (D-015)", () => {
    expect([...appSchema.tenantRole.enumValues]).toEqual([...TENANT_ROLES]);
    expect([...appSchema.projectRole.enumValues]).toEqual([...PROJECT_ROLES]);
    expect(appSchema.projectRole.enumValues).not.toContain("CLIENT");
  });

  it("provenance facets are the four approved vocabularies (D-013), not a source_type enum", () => {
    expect(REGIMES).toEqual(["HISTORICAL_OBSERVED", "LIVE_OPERATIONAL", "DEMO_SIMULATION"]);
    expect(ORIGINS).toEqual([
      "FIELD_CAPTURE",
      "IMPORTED_DOCUMENT",
      "IMPORTED_DATASET",
      "SYSTEM_GENERATED",
    ]);
    expect(TRANSFORMATIONS).toEqual(["ORIGINAL", "RECONSTRUCTED", "DERIVED", "ANONYMIZED"]);
    expect(GRANULARITIES).toEqual(["INDIVIDUAL", "AGGREGATE"]);
    expect(
      provenanceFacetsSchema.safeParse({
        regime: "DEMO_SIMULATION",
        origin: "SYSTEM_GENERATED",
        transformations: [],
        granularity: null,
      }).success,
    ).toBe(false);
    expect(
      provenanceFacetsSchema.safeParse({
        regime: "HISTORICAL_OBSERVED",
        origin: "IMPORTED_DOCUMENT",
        transformations: ["ORIGINAL"],
        granularity: "AGGREGATE",
        source_type: "REAL_AGGREGATE",
      }).success,
    ).toBe(false);
  });
});
