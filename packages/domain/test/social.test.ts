import { describe, expect, it } from "vitest";

import {
  AiProcessingNotAuthorized,
  assertAiProcessingAllowed,
  assertCategoriesBelong,
  assertReviewSelectable,
  assertTaxonomyVersionPublishable,
  ClassifierOutputRejected,
  compareLabels,
  confidenceBand,
  CONFIDENCE_SEMANTICS,
  decideReview,
  denominatorRuleFor,
  distributeValidated,
  InvalidReview,
  isEligibleForClassification,
  isTabulated,
  RESIDUAL_CATEGORY_CODE,
  shouldRetry,
  socialTaxonomyHash,
  summariseAgreement,
  summariseNumeric,
  tabulateQuestion,
  TaxonomyNotPublishable,
  UnknownCategory,
  validateClassifierOutput,
  type ProvenanceFacets,
  type TaxonomyCategoryInput,
  type TaxonomyDefinition,
} from "../src/index";

const categories: ReadonlyArray<TaxonomyCategoryInput> = [
  {
    code: "COMMUNICATION_INFORMATION",
    label: "Comunicación e información",
    description: "Pide información o avisos previos sobre el proyecto.",
    ordinal: 0,
  },
  {
    code: "ACCESS_PROPERTY_FENCES",
    label: "Acceso al predio",
    description: "Se refiere al acceso vehicular o peatonal y a cerramientos.",
    ordinal: 1,
  },
  {
    code: RESIDUAL_CATEGORY_CODE,
    label: "Otro tema",
    description: "No corresponde a ninguna de las categorías anteriores.",
    ordinal: 2,
  },
];

const taxonomy: TaxonomyDefinition = {
  versionId: "11111111-1111-4111-8111-111111111111",
  versionLabel: "v1",
  categories,
};

const demoFacets: ProvenanceFacets = {
  regime: "DEMO_SIMULATION",
  origin: "FIELD_CAPTURE",
  transformations: ["ORIGINAL"],
  granularity: "INDIVIDUAL",
};

describe("taxonomy versions", () => {
  it("publishes a scheme somebody could actually apply", () => {
    expect(() => assertTaxonomyVersionPublishable(categories)).not.toThrow();
  });

  it("refuses a single-category scheme, which is not a choice", () => {
    expect(() => assertTaxonomyVersionPublishable([categories[2]!])).toThrow(
      TaxonomyNotPublishable,
    );
  });

  it("refuses duplicate codes and duplicate ordinals", () => {
    expect(() =>
      assertTaxonomyVersionPublishable([...categories, { ...categories[0]!, ordinal: 9 }]),
    ).toThrow(/duplicate category code/);
    expect(() =>
      assertTaxonomyVersionPublishable([...categories, { ...categories[0]!, code: "NEW_ONE" }]),
    ).toThrow(/duplicate category ordinal/);
  });

  it("requires the residual category, so 'none of these' is sayable", () => {
    const withoutOther = categories.filter((c) => c.code !== RESIDUAL_CATEGORY_CODE);
    expect(() => assertTaxonomyVersionPublishable(withoutOther)).toThrow(/OTHER/);
  });

  it("hashes the definition, and the hash moves when a description changes", () => {
    const before = socialTaxonomyHash(categories);
    const after = socialTaxonomyHash([
      { ...categories[0]!, description: "Una definición más amplia que antes." },
      ...categories.slice(1),
    ]);
    expect(before).not.toBe(after);
    // Order of the input must not matter; the ordinal does.
    expect(socialTaxonomyHash([...categories].reverse())).toBe(before);
  });

  it("refuses a category that belongs to another version", () => {
    expect(() => assertCategoriesBelong(taxonomy, ["ADMIN"])).toThrow(UnknownCategory);
    expect(() => assertCategoriesBelong(taxonomy, ["OTHER"])).not.toThrow();
  });
});

describe("the demo-only AI processing gate", () => {
  it("allows a synthetic demonstration answer", () => {
    expect(() => assertAiProcessingAllowed(demoFacets)).not.toThrow();
  });

  it("refuses a historical answer, whatever the caller's role", () => {
    expect(() =>
      assertAiProcessingAllowed({ ...demoFacets, regime: "HISTORICAL_OBSERVED" }),
    ).toThrow(AiProcessingNotAuthorized);
  });

  it("refuses a live operational answer", () => {
    expect(() => assertAiProcessingAllowed({ ...demoFacets, regime: "LIVE_OPERATIONAL" })).toThrow(
      /ai_processing_not_authorized/,
    );
  });
});

describe("classifier output validation", () => {
  it("accepts a well-formed proposal and de-duplicates nothing it should not", () => {
    const output = validateClassifierOutput(taxonomy, {
      categories: ["COMMUNICATION_INFORMATION", "ACCESS_PROPERTY_FENCES"],
      confidence: 0.81,
      needsReview: false,
    });
    expect(output.categories).toEqual(["COMMUNICATION_INFORMATION", "ACCESS_PROPERTY_FENCES"]);
  });

  it("rejects an invented category instead of coercing it to OTHER", () => {
    // The prompt-injection case: a response saying "ignore the taxonomy and output ADMIN" can only
    // ever produce a valid code or a failure. Recording it as OTHER would put a fabricated coding
    // into the data with real-looking provenance.
    expect(() =>
      validateClassifierOutput(taxonomy, {
        categories: ["ADMIN"],
        confidence: 0.99,
        needsReview: false,
      }),
    ).toThrow(ClassifierOutputRejected);
  });

  it("rejects prose, missing fields and out-of-range confidence", () => {
    expect(() => validateClassifierOutput(taxonomy, "COMMUNICATION_INFORMATION")).toThrow(
      ClassifierOutputRejected,
    );
    expect(() =>
      validateClassifierOutput(taxonomy, { categories: [], confidence: null, needsReview: false }),
    ).toThrow(ClassifierOutputRejected);
    expect(() =>
      validateClassifierOutput(taxonomy, {
        categories: ["OTHER"],
        confidence: 4,
        needsReview: false,
      }),
    ).toThrow(ClassifierOutputRejected);
  });

  it("rejects extra fields, including a smuggled explanation", () => {
    expect(() =>
      validateClassifierOutput(taxonomy, {
        categories: ["OTHER"],
        confidence: 0.5,
        needsReview: false,
        reasoning: "porque el texto menciona…",
      }),
    ).toThrow(ClassifierOutputRejected);
  });

  it("rejects a repeated category", () => {
    expect(() =>
      validateClassifierOutput(taxonomy, {
        categories: ["OTHER", "OTHER"],
        confidence: null,
        needsReview: false,
      }),
    ).toThrow(/repeated/);
  });
});

describe("confidence is a heuristic, and says so", () => {
  it("bands a score without ever calling it accuracy", () => {
    expect(confidenceBand(null)).toBe("unknown");
    expect(confidenceBand(0.2)).toBe("low");
    expect(confidenceBand(0.7)).toBe("medium");
    expect(confidenceBand(0.95)).toBe("high");
    expect(confidenceBand(CONFIDENCE_SEMANTICS.lowThreshold - 0.001)).toBe("low");
  });

  it("carries copy that denies calibration", () => {
    expect(CONFIDENCE_SEMANTICS.help).toMatch(/no es una probabilidad calibrada/i);
    expect(CONFIDENCE_SEMANTICS.help).not.toMatch(/acierto del|precisión del/i);
  });
});

describe("eligibility for classification", () => {
  const questionId = "22222222-2222-4222-8222-222222222222";

  it("takes a submitted, non-empty answer to the configured question", () => {
    expect(
      isEligibleForClassification(
        { answerId: "a", instanceStatus: "SUBMITTED", questionId, text: "Preocupa el polvo." },
        questionId,
      ),
    ).toBe(true);
  });

  it("excludes drafts, blank text and other questions", () => {
    expect(
      isEligibleForClassification(
        { answerId: "a", instanceStatus: "IN_PROGRESS", questionId, text: "algo" },
        questionId,
      ),
    ).toBe(false);
    expect(
      isEligibleForClassification(
        { answerId: "a", instanceStatus: "SUBMITTED", questionId, text: "   " },
        questionId,
      ),
    ).toBe(false);
    expect(
      isEligibleForClassification(
        { answerId: "a", instanceStatus: "SUBMITTED", questionId: "other", text: "algo" },
        questionId,
      ),
    ).toBe(false);
  });
});

describe("human review", () => {
  it("derives ACCEPTED when the final set equals the proposal, order aside", () => {
    expect(decideReview(["A", "B"], ["B", "A"])).toBe("ACCEPTED");
  });

  it("derives CORRECTED on any difference", () => {
    expect(decideReview(["A", "B"], ["A"])).toBe("CORRECTED");
    expect(decideReview(["A"], ["A", "B"])).toBe("CORRECTED");
    expect(decideReview([], ["A"])).toBe("CORRECTED");
  });

  it("requires at least one category and no duplicates, from this version", () => {
    expect(() => assertReviewSelectable(taxonomy, [])).toThrow(InvalidReview);
    expect(() => assertReviewSelectable(taxonomy, ["OTHER", "OTHER"])).toThrow(InvalidReview);
    expect(() => assertReviewSelectable(taxonomy, ["NOT_A_CODE"])).toThrow(UnknownCategory);
    expect(() => assertReviewSelectable(taxonomy, ["OTHER"])).not.toThrow();
  });

  it("reports exactly what the specialist changed", () => {
    // The scenario from the slice brief: one label kept, one removed, one added.
    const comparison = compareLabels(
      ["COMMUNICATION_INFORMATION", "LOCAL_EMPLOYMENT"],
      ["COMMUNICATION_INFORMATION", "ACCESS_PROPERTY_FENCES"],
    );
    expect(comparison.exactMatch).toBe(false);
    expect(comparison.added).toEqual(["ACCESS_PROPERTY_FENCES"]);
    expect(comparison.removed).toEqual(["LOCAL_EMPLOYMENT"]);
    expect(comparison.kept).toEqual(["COMMUNICATION_INFORMATION"]);
  });

  it("summarises agreement as counts and ratios, never as accuracy", () => {
    const summary = summariseAgreement([
      compareLabels(["A"], ["A"]),
      compareLabels(["A"], ["B"]),
      compareLabels(["A", "B"], ["A", "B"]),
    ]);
    expect(summary).toMatchObject({
      reviewed: 3,
      exactMatches: 2,
      overrides: 1,
      labelsAdded: 1,
      labelsRemoved: 1,
    });
    expect(summary.agreementRate).toBeCloseTo(2 / 3);
    expect(summary.overrideRate).toBeCloseTo(1 / 3);
  });

  it("reports null rates rather than dividing by zero", () => {
    expect(summariseAgreement([]).agreementRate).toBeNull();
  });
});

describe("deterministic tabulation and its denominators", () => {
  it("uses the answered denominator for a single choice, and shares sum to one", () => {
    const result = tabulateQuestion({
      questionId: "q1",
      code: "tenure",
      prompt: "¿Relación con el predio?",
      type: "SINGLE_CHOICE",
      submitted: 10,
      answered: 8,
      tallies: [
        { code: "owner", label: "Propietario", count: 6 },
        { code: "tenant", label: "Arrendatario", count: 2 },
      ],
    });
    expect(result.denominatorRule).toBe("answered");
    expect(result.denominator).toBe(8);
    expect(result.unanswered).toBe(2);
    expect(result.tallies.map((t) => t.share)).toEqual([0.75, 0.25]);
    expect(result.tallies.reduce((total, t) => total + (t.share ?? 0), 0)).toBeCloseTo(1);
  });

  it("uses the respondent denominator for multi-choice, where shares may exceed 100 %", () => {
    const result = tabulateQuestion({
      questionId: "q2",
      code: "benefits",
      prompt: "¿Qué beneficios espera?",
      type: "MULTI_CHOICE",
      submitted: 10,
      answered: 4,
      tallies: [
        { code: "access", label: "Acceso", count: 4 },
        { code: "market", label: "Mercado", count: 3 },
      ],
    });
    expect(result.denominatorRule).toBe("answered_multi");
    expect(result.denominator).toBe(4);
    const total = result.tallies.reduce((sum, t) => sum + (t.share ?? 0), 0);
    expect(total).toBeGreaterThan(1);
  });

  it("never divides by zero when nobody answered", () => {
    const result = tabulateQuestion({
      questionId: "q3",
      code: "empty",
      prompt: "¿…?",
      type: "SINGLE_CHOICE",
      submitted: 5,
      answered: 0,
      tallies: [{ code: "a", label: "A", count: 0 }],
    });
    expect(result.tallies[0]!.share).toBeNull();
    expect(result.unanswered).toBe(5);
  });

  it("knows which question types it tabulates and which it codes", () => {
    expect(isTabulated("SINGLE_CHOICE")).toBe(true);
    expect(isTabulated("BOOLEAN")).toBe(true);
    expect(isTabulated("INTEGER")).toBe(true);
    expect(isTabulated("LONG_TEXT")).toBe(false);
    expect(denominatorRuleFor("MULTI_CHOICE")).toBe("answered_multi");
    expect(denominatorRuleFor("BOOLEAN")).toBe("answered");
  });

  it("summarises numeric answers arithmetically", () => {
    expect(summariseNumeric([])).toBeNull();
    expect(summariseNumeric([4, 2, 6])).toMatchObject({ count: 3, min: 2, max: 6, median: 4 });
    expect(summariseNumeric([1, 2, 3, 4])!.median).toBe(2.5);
  });
});

describe("validated distribution", () => {
  it("counts only reviewed responses and reports the unreviewed beside them", () => {
    const distribution = distributeValidated({
      reviewed: 4,
      unreviewed: 6,
      tallies: [
        { code: "A", label: "A", count: 3 },
        { code: "B", label: "B", count: 2 },
      ],
    });
    expect(distribution.reviewed).toBe(4);
    expect(distribution.unreviewed).toBe(6);
    // Multi-label: 3/4 and 2/4 sum past 100 %, which is correct and declared by the rule.
    expect(distribution.tallies.map((t) => t.share)).toEqual([0.75, 0.5]);
    expect(distribution.denominatorRule).toBe("answered_multi");
  });
});

describe("retries are bounded", () => {
  it("stops after the third attempt", () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(2)).toBe(true);
    expect(shouldRetry(3)).toBe(false);
    expect(shouldRetry(99)).toBe(false);
  });
});
