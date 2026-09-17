import {
  acceptsOptions,
  assertAuthoredDraftSavable,
  assertAuthoredVersionPublishable,
  assertLocaleCoverage,
  assertSectionsContiguous,
  CANONICAL_SURVEY_LOCALE,
  declaredLocales,
  MAX_QUESTIONS_PER_VERSION,
  nextSurveyVersionLabel,
  sectionsOf,
  SURVEY_LOCALES,
  SurveyNotAuthorable,
  SurveyNotPublishable,
  surveyVersionHash,
  toSurveyQuestionDefinitions,
  type AuthoredDefinition,
  type AuthoredQuestion,
} from "../src/index";
import { describe, expect, it } from "vitest";

/**
 * What a questionnaire written inside the product may and may not be (ADR-037).
 */
const question = (overrides: Partial<AuthoredQuestion> = {}): AuthoredQuestion => ({
  code: "tenure_category",
  ordinal: 0,
  type: "SHORT_TEXT",
  prompt: "¿Relación con el predio?",
  helpText: null,
  required: true,
  sensitivity: "NON_PERSONAL",
  section: null,
  options: [],
  translations: {},
  ...overrides,
});

const definition = (questions: AuthoredQuestion[]): AuthoredDefinition => ({ questions });

describe("the vocabulary a questionnaire is written in", () => {
  it("speaks exactly the two languages the product speaks, and names one as the definition", () => {
    expect(SURVEY_LOCALES).toContain(CANONICAL_SURVEY_LOCALE);
    expect(SURVEY_LOCALES.length).toBe(2);
  });

  it("offers options only for the question types whose answers are codes", () => {
    expect(acceptsOptions("SINGLE_CHOICE")).toBe(true);
    expect(acceptsOptions("MULTI_CHOICE")).toBe(true);
    expect(acceptsOptions("SHORT_TEXT")).toBe(false);
    expect(acceptsOptions("INTEGER")).toBe(false);
  });
});

describe("saving a draft, which is deliberately more forgiving than publishing", () => {
  /*
   * The distinction this whole module rests on. A form being written is *incomplete*, and refusing
   * to store it until it is finished means the author keeps the work in a browser tab.
   */
  it("stores a half-written questionnaire", () => {
    expect(() =>
      assertAuthoredDraftSavable(
        definition([question({ prompt: "", type: "SINGLE_CHOICE", options: [] })]),
      ),
    ).not.toThrow();
  });

  it("refuses two questions with the same code, because a code is identity", () => {
    expect(() =>
      assertAuthoredDraftSavable(definition([question({ ordinal: 0 }), question({ ordinal: 1 })])),
    ).toThrow(SurveyNotAuthorable);
  });

  it("refuses two questions in the same position, because order must be deterministic", () => {
    expect(() =>
      assertAuthoredDraftSavable(
        definition([question({ code: "a_one" }), question({ code: "a_two" })]),
      ),
    ).toThrow(SurveyNotAuthorable);
  });

  it("refuses a code that is not a code", () => {
    expect(() =>
      assertAuthoredDraftSavable(definition([question({ code: "Tenure Category" })])),
    ).toThrow(SurveyNotAuthorable);
  });

  it("refuses a language this product cannot render", () => {
    expect(() =>
      assertAuthoredDraftSavable(
        definition([
          question({
            translations: { fr: { prompt: "Relation ?", helpText: null, section: null } },
          }),
        ]),
      ),
    ).toThrow(SurveyNotAuthorable);
  });

  /*
   * `es-EC` is what `survey_question.prompt` holds. A row claiming to translate the definition into
   * the definition's own language would be a second place the canonical wording lives.
   */
  it("refuses the canonical language as a translation of itself", () => {
    expect(() =>
      assertAuthoredDraftSavable(
        definition([
          question({
            translations: { "es-EC": { prompt: "otra cosa", helpText: null, section: null } },
          }),
        ]),
      ),
    ).toThrow(SurveyNotAuthorable);
  });

  it("refuses more questions than a form holds", () => {
    const many = Array.from({ length: MAX_QUESTIONS_PER_VERSION + 1 }, (_, index) =>
      question({ code: `q_${index}`, ordinal: index }),
    );
    expect(() => assertAuthoredDraftSavable(definition(many))).toThrow(SurveyNotAuthorable);
  });
});

describe("a heading, which groups and does nothing else", () => {
  it("accepts a contiguous run under one heading", () => {
    expect(() =>
      assertSectionsContiguous(
        definition([
          question({ code: "a_one", ordinal: 0, section: "Vivienda" }),
          question({ code: "a_two", ordinal: 1, section: "Vivienda" }),
          question({ code: "b_one", ordinal: 2, section: "Servicios" }),
        ]),
      ),
    ).not.toThrow();
  });

  /*
   * *Vivienda · Servicios · Vivienda* is a form whose grouping says one thing and whose order says
   * another, and every renderer would have to guess which.
   */
  it("refuses a heading interrupted and resumed", () => {
    expect(() =>
      assertSectionsContiguous(
        definition([
          question({ code: "a_one", ordinal: 0, section: "Vivienda" }),
          question({ code: "b_one", ordinal: 1, section: "Servicios" }),
          question({ code: "a_two", ordinal: 2, section: "Vivienda" }),
        ]),
      ),
    ).toThrow(SurveyNotAuthorable);
  });

  it("groups the questions before the first heading as their own run", () => {
    const groups = sectionsOf(
      definition([
        question({ code: "intro_one", ordinal: 0 }),
        question({ code: "a_one", ordinal: 1, section: "Vivienda" }),
        question({ code: "a_two", ordinal: 2, section: "Vivienda" }),
      ]),
    );
    expect(groups.map((group) => group.section)).toEqual([null, "Vivienda"]);
    expect(groups[1]!.questions.map((q) => q.code)).toEqual(["a_one", "a_two"]);
  });

  /*
   * Invariant 9's consequence, stated as a test: an answer means what it means because of a code,
   * and a heading touches no code. So moving a question between headings changes no fingerprint.
   */
  it("does not change the definition's fingerprint", () => {
    const flat = definition([question({ section: null })]);
    const grouped = definition([question({ section: "Vivienda" })]);
    expect(surveyVersionHash(toSurveyQuestionDefinitions(grouped))).toBe(
      surveyVersionHash(toSurveyQuestionDefinitions(flat)),
    );
  });
});

describe("a second language is complete or it is absent", () => {
  const bilingual = (extra: Partial<AuthoredQuestion> = {}) =>
    definition([
      question({
        type: "SINGLE_CHOICE",
        options: [
          { code: "owner", label: "Propietario", ordinal: 0, translations: { en: "Owner" } },
          { code: "tenant", label: "Arrendatario", ordinal: 1, translations: { en: "Tenant" } },
        ],
        translations: {
          en: { prompt: "Relationship to the parcel?", helpText: null, section: null },
        },
        ...extra,
      }),
    ]);

  it("reports the languages the rows actually carry, canonical first", () => {
    expect(declaredLocales(bilingual())).toEqual(["es-EC", "en"]);
    expect(declaredLocales(definition([question()]))).toEqual(["es-EC"]);
  });

  it("accepts a version whose every word exists in both", () => {
    expect(() => assertAuthoredVersionPublishable(bilingual())).not.toThrow();
  });

  /*
   * A technician who switched the phone to English and met a Spanish prompt halfway down would be
   * answering a questionnaire nobody wrote — and tabulation would count it beside the others.
   */
  it("refuses an option whose English label nobody wrote", () => {
    const partial = definition([
      question({
        type: "SINGLE_CHOICE",
        options: [
          { code: "owner", label: "Propietario", ordinal: 0, translations: { en: "Owner" } },
          { code: "tenant", label: "Arrendatario", ordinal: 1, translations: {} },
        ],
        translations: {
          en: { prompt: "Relationship to the parcel?", helpText: null, section: null },
        },
      }),
    ]);
    expect(() => assertLocaleCoverage(partial)).toThrow(SurveyNotPublishable);
  });

  it("refuses a heading with no English wording when the version declares English", () => {
    expect(() => assertLocaleCoverage(bilingual({ section: "Vivienda" }))).toThrow(
      SurveyNotPublishable,
    );
  });

  it("accepts the same heading once it is written in both", () => {
    expect(() =>
      assertLocaleCoverage(
        bilingual({
          section: "Vivienda",
          translations: {
            en: { prompt: "Relationship to the parcel?", helpText: null, section: "Housing" },
          },
        }),
      ),
    ).not.toThrow();
  });

  it("keeps one identity across both languages", () => {
    const [only] = bilingual().questions;
    expect(only!.code).toBe("tenure_category");
    expect(only!.options.map((option) => option.code)).toEqual(["owner", "tenant"]);
    // The English wording lives beside the codes, never instead of them.
    expect(Object.keys(only!.translations)).toEqual(["en"]);
  });
});

describe("publishing, which reuses the rule that already existed", () => {
  it("refuses a choice question with one option, as the field slice always did", () => {
    expect(() =>
      assertAuthoredVersionPublishable(
        definition([
          question({
            type: "SINGLE_CHOICE",
            options: [{ code: "owner", label: "Propietario", ordinal: 0, translations: {} }],
          }),
        ]),
      ),
    ).toThrow(SurveyNotPublishable);
  });

  it("refuses a questionnaire with no questions", () => {
    expect(() => assertAuthoredVersionPublishable(definition([]))).toThrow(SurveyNotPublishable);
  });

  it("refuses a question with no prompt", () => {
    expect(() =>
      assertAuthoredVersionPublishable(definition([question({ prompt: "  " })])),
    ).toThrow(SurveyNotPublishable);
  });
});

describe("the next version's label", () => {
  it("starts at v1 and never reuses a number", () => {
    expect(nextSurveyVersionLabel([])).toBe("v1");
    expect(nextSurveyVersionLabel(["v1"])).toBe("v2");
    expect(nextSurveyVersionLabel(["v1", "v2", "v3"])).toBe("v4");
    // A label nobody in this scheme wrote does not lower the count.
    expect(nextSurveyVersionLabel(["v1", "borrador final"])).toBe("v2");
  });
});
