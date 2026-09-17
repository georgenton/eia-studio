import {
  assertReviewableCorpus,
  assertRunTransition,
  blockedSources,
  decideCandidate,
  DOCUMENT_REVIEW_PROMPT_VERSION,
  FORBIDDEN_FINDING_WORDS,
  groundCandidate,
  InvalidInput,
  lensFor,
  lensRef,
  MAX_CANDIDATES_PER_RUN,
  REVIEW_CANDIDATE_STATES,
  REVIEW_LENSES,
  REVIEW_LENS_KEYS,
  ReviewCorpusRefused,
  reviewOutputSchema,
  type RetrievedPassage,
  type ReviewableSource,
} from "../src/index";
import { describe, expect, it } from "vitest";

/**
 * What AI document review must never do (ADR-035): send a document nobody cleared, keep a
 * candidate it cannot ground, state a conclusion about compliance, or let a one-sided suggestion
 * be accepted as a disagreement between two sources.
 */
const passage = (index: number, text: string): RetrievedPassage => ({
  chunkId: `00000000-0000-0000-0000-00000000000${index}`,
  documentId: "11111111-1111-1111-1111-111111111111",
  documentCode: `DOC-00${index}`,
  documentTitle: "Informe social",
  documentVersionId: "22222222-2222-2222-2222-222222222222",
  versionLabel: "v1",
  ordinal: index,
  locatorKind: "PAGE",
  pageFrom: index + 1,
  pageTo: index + 1,
  sectionPath: null,
  text,
  score: 1 - index / 10,
});

const passages = [
  passage(0, "El expediente registra 70 predios afectados por el trazado."),
  passage(1, "El anexo de afectaciones enumera 71 predios frentistas al corredor."),
  passage(2, "La ficha socioeconómica se aplicó en los predios del área de influencia directa."),
];

const candidate = (over: Record<string, unknown> = {}) => ({
  title: "Dos cifras de predios afectados no coinciden",
  observation:
    "Un pasaje registra 70 predios y otro enumera 71; a partir de su texto no se puede " +
    "establecer que se refieran a conteos distintos.",
  suggestedCheck: "Contrastar el anexo de afectaciones con el informe social del expediente.",
  sourceA: 0,
  sourceB: 1,
  context: [],
  ...over,
});

describe("the lens catalogue, which is the whole classification", () => {
  it("is bounded, versioned and carries its own retrieval probes", () => {
    expect(REVIEW_LENS_KEYS).toHaveLength(7);
    for (const lens of REVIEW_LENSES) {
      expect(lens.probes.length).toBeGreaterThan(0);
      expect(lensRef(lens.key)).toBe(`${lens.key}@${lens.version}`);
    }
  });

  /*
   * The failure this prevents: a free-form "review this study" lens. A model asked an unbounded
   * question produces unbounded plausible text, which is precisely what must not end up beside a
   * consultancy's deliverable.
   */
  it("refuses a lens nobody declared", () => {
    expect(() => lensFor("check_everything")).toThrow(InvalidInput);
  });

  it("names its prompt version, so a candidate's origin stays legible", () => {
    expect(DOCUMENT_REVIEW_PROMPT_VERSION).toBe("document-review@1");
  });
});

describe("grounding a candidate", () => {
  it("resolves both sides to passages that were actually retrieved", () => {
    const grounded = groundCandidate(candidate(), passages);
    expect(grounded.support).toBe("TWO_SIDED");
    expect(grounded.evidence.map((item) => item.role)).toEqual(["SOURCE_A", "SOURCE_B"]);
    // The quote is the passage's own words, and the test asserts it is *the passage*, not a copy
    // of whatever the model wrote about it.
    expect(grounded.evidence[0]!.passage.text).toBe(passages[0]!.text);
  });

  /*
   * The failure that makes a citing product worse than no product. An index outside the set is a
   * failed candidate, never a dropped citation: dropping it would leave the observation standing
   * and looking sourced.
   */
  it("refuses a candidate that cites a passage it never received", () => {
    expect(() => groundCandidate(candidate({ sourceB: 9 }), passages)).toThrow(InvalidInput);
    expect(() => groundCandidate(candidate({ context: [7] }), passages)).toThrow(InvalidInput);
  });

  it("refuses one passage cited as both sides of a disagreement", () => {
    expect(() => groundCandidate(candidate({ sourceB: 0 }), passages)).toThrow(InvalidInput);
  });

  it("keeps a single-source candidate, and says so rather than inventing a second side", () => {
    const grounded = groundCandidate(candidate({ sourceB: null }), passages);
    expect(grounded.support).toBe("SINGLE_SOURCE");
    expect(grounded.evidence).toHaveLength(1);
  });

  it("carries context passages without promoting them to a side", () => {
    const grounded = groundCandidate(candidate({ context: [2] }), passages);
    expect(grounded.evidence.map((item) => item.role)).toEqual(["SOURCE_A", "SOURCE_B", "CONTEXT"]);
  });

  /*
   * Invariant 11, in the one place a model could most easily breach it. The vocabulary is the
   * Quality Gate's own list, so the two features cannot drift into saying different things about
   * what this product may assert.
   */
  it("refuses a candidate that declares a compliance conclusion, in either language", () => {
    for (const word of ["incumplimiento", "el sistema determina", "violation", "non-compliance"]) {
      expect(FORBIDDEN_FINDING_WORDS).toContain(word);
      expect(() =>
        groundCandidate(
          candidate({ observation: `Esto es un ${word} del estudio y debe corregirse.` }),
          passages,
        ),
      ).toThrow(InvalidInput);
    }
  });

  it("refuses a shape the schema does not admit", () => {
    expect(() => groundCandidate({ title: "corto" }, passages)).toThrow(InvalidInput);
    expect(() => groundCandidate(candidate({ severity: "high" }), passages)).toThrow(InvalidInput);
  });

  it("bounds how many candidates one run may produce", () => {
    const many = Array.from({ length: MAX_CANDIDATES_PER_RUN + 1 }, () => candidate());
    expect(reviewOutputSchema.safeParse({ candidates: many }).success).toBe(false);
  });
});

describe("what a person may decide", () => {
  it("accepts or dismisses a proposal, and a decided one can be reopened", () => {
    const accepted = decideCandidate("PROPOSED", "TWO_SIDED", {
      decision: "ACCEPT",
      justification: "Verificado contra el anexo: son dos conteos distintos.",
    });
    expect(accepted.toState).toBe("ACCEPTED");
    expect(
      decideCandidate("DISMISSED", "TWO_SIDED", {
        decision: "REOPEN",
        justification: "Aparece evidencia nueva en la versión corregida.",
      }).toState,
    ).toBe("PROPOSED");
  });

  /*
   * The rule that keeps a model from making an assertion. Accepting means *this is a real
   * disagreement between two named sources*; a candidate resting on one passage has not shown one,
   * whatever it says about it.
   */
  it("refuses to accept a candidate that rests on a single passage", () => {
    expect(() =>
      decideCandidate("PROPOSED", "SINGLE_SOURCE", {
        decision: "ACCEPT",
        justification: "Parece razonable y lo damos por bueno.",
      }),
    ).toThrow(InvalidInput);
    // Dismissing one is fine: deciding it is nothing is a decision a person is entitled to make.
    expect(
      decideCandidate("PROPOSED", "SINGLE_SOURCE", {
        decision: "DISMISS",
        justification: "El pasaje no sostiene ninguna discrepancia.",
      }).toState,
    ).toBe("DISMISSED");
  });

  it("refuses a transition nobody defined", () => {
    expect(() =>
      decideCandidate("ACCEPTED", "TWO_SIDED", {
        decision: "ACCEPT",
        justification: "Aceptado otra vez, por si acaso.",
      }),
    ).toThrow(InvalidInput);
  });

  it("refuses a token word as the recorded reason", () => {
    expect(() =>
      decideCandidate("PROPOSED", "TWO_SIDED", { decision: "DISMISS", justification: "ok" }),
    ).toThrow();
  });

  it("has three states and no RESOLVED, because nothing here tracks a correction", () => {
    expect(REVIEW_CANDIDATE_STATES).toEqual(["PROPOSED", "ACCEPTED", "DISMISSED"]);
  });
});

describe("a run's lifecycle", () => {
  it("can be retried after a failure and never after it completed", () => {
    expect(() => assertRunTransition("FAILED", "QUEUED")).not.toThrow();
    expect(() => assertRunTransition("PROCESSING", "COMPLETED")).not.toThrow();
    // A second opinion is a second run, and both are kept.
    expect(() => assertRunTransition("COMPLETED", "QUEUED")).toThrow(InvalidInput);
    expect(() => assertRunTransition("QUEUED", "COMPLETED")).toThrow(InvalidInput);
  });
});

describe("the privacy gate", () => {
  const clear = (over: Partial<ReviewableSource> = {}): ReviewableSource => ({
    documentVersionId: "33333333-3333-3333-3333-333333333333",
    documentCode: "DOC-001",
    privacyClassification: "NO_PERSONAL_DATA_KNOWN",
    containsPii: false,
    processingState: "READY",
    ...over,
  });

  it("lets a corpus somebody declared clear through", () => {
    expect(() => assertReviewableCorpus([clear()])).not.toThrow();
  });

  /*
   * `REVIEW_REQUIRED` is the default for every uploaded file and means *nobody has looked*. A
   * product that treated "not yet examined" as "safe to send" would be sending exactly the
   * documents nobody has checked.
   */
  it("refuses a version nobody has classified", () => {
    expect(() =>
      assertReviewableCorpus([clear({ privacyClassification: "REVIEW_REQUIRED" })]),
    ).toThrow(ReviewCorpusRefused);
    expect(() =>
      assertReviewableCorpus([clear({ privacyClassification: "CONTAINS_PERSONAL_DATA" })]),
    ).toThrow(ReviewCorpusRefused);
    expect(() => assertReviewableCorpus([clear({ containsPii: true })])).toThrow(
      ReviewCorpusRefused,
    );
  });

  /*
   * The decision this test exists for. Filtering would report on less than was asked for and say
   * nothing about it: "no candidates in the social chapter" would come to mean "the social chapter
   * was never read".
   */
  it("refuses the whole run for a mixed corpus, and names every document that blocked it", () => {
    const sources = [
      clear({ documentCode: "DOC-001" }),
      clear({ documentCode: "DOC-004", privacyClassification: "REVIEW_REQUIRED" }),
      clear({ documentCode: "DOC-007", containsPii: true }),
    ];
    let thrown: ReviewCorpusRefused | null = null;
    try {
      assertReviewableCorpus(sources);
    } catch (error) {
      thrown = error as ReviewCorpusRefused;
    }
    expect(thrown).toBeInstanceOf(ReviewCorpusRefused);
    expect(thrown!.blocked.map((item) => item.documentCode)).toEqual(["DOC-004", "DOC-007"]);
    expect(thrown!.message).toContain("DOC-004");
    expect(thrown!.message).toContain("DOC-007");
    // The clear document is not in the blocked list, and is still not reviewed: the run is refused.
    expect(thrown!.blocked.some((item) => item.documentCode === "DOC-001")).toBe(false);
  });

  it("distinguishes a document that cannot be read from one that may not be", () => {
    const blocked = blockedSources([clear({ processingState: "REQUIRES_OCR" })]);
    expect(blocked[0]!.reason).toBe("NOT_READABLE");
    const pii = blockedSources([clear({ containsPii: true, processingState: "REQUIRES_OCR" })]);
    // Privacy wins the explanation: the reason a reader must act on is the one about the data.
    expect(pii[0]!.reason).toBe("CONTAINS_PII");
  });

  it("refuses an empty corpus rather than reporting a clean review of nothing", () => {
    expect(() => assertReviewableCorpus([])).toThrow(InvalidInput);
  });
});
