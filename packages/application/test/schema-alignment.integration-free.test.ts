import { appSchema, reviewSchema } from "@eia/db";
import { describe, expect, it } from "vitest";

import {
  REVIEW_CANDIDATE_DECISIONS,
  REVIEW_CANDIDATE_STATES,
  REVIEW_EVIDENCE_ROLES,
  REVIEW_LENS_KEYS,
  REVIEW_RUN_STATUSES,
  REVIEW_SUPPORT_KINDS,
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

  /*
   * AI document review (ADR-035). `@eia/db` must not import `@eia/domain`, so these vocabularies
   * exist twice; this is the test that keeps the two copies from drifting. The lens list is the
   * one that matters most — it is a candidate's whole classification, and a key in the database
   * the domain does not know would be a candidate nothing could render.
   */
  it("the review vocabularies in the database equal the domain's", () => {
    expect([...reviewSchema.reviewLens.enumValues]).toEqual([...REVIEW_LENS_KEYS]);
    expect([...reviewSchema.reviewRunStatus.enumValues]).toEqual([...REVIEW_RUN_STATUSES]);
    expect([...reviewSchema.reviewCandidateState.enumValues]).toEqual([...REVIEW_CANDIDATE_STATES]);
    expect([...reviewSchema.reviewCandidateDecision.enumValues]).toEqual([
      ...REVIEW_CANDIDATE_DECISIONS,
    ]);
    expect([...reviewSchema.reviewSupportKind.enumValues]).toEqual([...REVIEW_SUPPORT_KINDS]);
    expect([...reviewSchema.reviewEvidenceRole.enumValues]).toEqual([...REVIEW_EVIDENCE_ROLES]);
  });

  it("a review candidate carries no severity and no confidence", () => {
    // Both would be a model deciding something it has nothing to calibrate against (ADR-035 §5).
    const columns = Object.keys(reviewSchema.documentReviewCandidate);
    expect(columns).not.toContain("severity");
    expect(columns).not.toContain("confidence");
    expect(columns).not.toContain("score");
  });
});
