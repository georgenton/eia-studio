import { z } from "zod";

import { InvalidInput } from "../core/errors";
import {
  assertSurveyVersionPublishable,
  isChoiceQuestion,
  questionSensitivitySchema,
  questionTypeSchema,
  surveyOptionCodeSchema,
  surveyQuestionCodeSchema,
  SurveyNotPublishable,
  type QuestionSensitivity,
  type QuestionType,
  type SurveyQuestionDefinition,
} from "./survey";

/**
 * Writing a questionnaire inside the product, and the four things it deliberately cannot do
 * (ADR-037).
 *
 * ## Why this is not a survey designer
 *
 * A generic instrument designer is a language: expressions, calculations, skip rules, matrices,
 * repeating groups, custom types. Every one of those has to be interpreted identically by the web
 * form, by the phone, by the tabulator and by whatever reads the archive in five years — and the
 * moment two of them disagree, an answer means two things. So this module authors **exactly the
 * questionnaire this product already knows how to ask, answer, synchronise and count**: the eight
 * `QUESTION_TYPES`, their options, their order, and a second language for the words.
 *
 * What is absent is the design. There is no conditional logic, because the domain has never had
 * any and inventing a semantics for it here would fix it before a real form asked for it. There is
 * no expression syntax and no calculated question. There is no new question type. A *section* is a
 * heading somebody reads, and §4 says why that is all it is.
 *
 * ## The one rule everything else follows from
 *
 * A `DRAFT` may be rewritten freely and a `PUBLISHED` version may not be touched at all — by
 * trigger, not by intention (migration 0014). Editing a published questionnaire therefore means
 * **copying it into a new draft**, and the answers already given keep pointing at the definition
 * they were given. This module never offers any other shape.
 */

/**
 * The languages a questionnaire may be authored in.
 *
 * The same two the product speaks. It is restated here rather than imported because `@eia/domain`
 * depends on zod alone (ADR-015) — `packages/i18n/test/i18n.test.ts` asserts the two lists agree,
 * so a third language cannot be added to one of them quietly.
 */
export const SURVEY_LOCALES = ["es-EC", "en"] as const;
export type SurveyLocale = (typeof SURVEY_LOCALES)[number];

/**
 * The language a definition's own columns are in.
 *
 * `survey_question.prompt` and `survey_option.label` are the canonical words; every other language
 * is a translation row keyed by question or option id (ADR-029). One definition, one set of codes,
 * one denominator — which is what makes "the same question in two languages" true rather than
 * merely claimed.
 */
export const CANONICAL_SURVEY_LOCALE: SurveyLocale = "es-EC";

/** A questionnaire a person can hold in their head, and a phone can render without paging. */
export const MAX_QUESTIONS_PER_VERSION = 120;
export const MAX_OPTIONS_PER_QUESTION = 30;
export const MAX_SECTION_LENGTH = 80;
export const MAX_PROMPT_LENGTH = 400;
export const MAX_HELP_TEXT_LENGTH = 600;
export const MAX_OPTION_LABEL_LENGTH = 200;

export const surveyTemplateKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "a questionnaire key is lower snake_case, e.g. socioeconomic_sheet");

/**
 * `v1`, `v2`, `v3`. Deliberately not free text: the label is what a campaign, a field pack and a
 * technician's screen all name, and "v2 (final, corregida)" is a sentence rather than a version.
 */
export const surveyVersionLabelSchema = z
  .string()
  .trim()
  .regex(/^v[1-9][0-9]{0,2}$/, "a version label is v1, v2, v3 …");

/**
 * A heading, and nothing else.
 *
 * It groups questions on screen so a long form reads as a form rather than a list. It is **not** an
 * entity: no id, no ordering of its own, no rules, and nothing about an answer depends on it. Two
 * questions in different sections are exactly as unrelated as two questions in the same one, and
 * moving a question between sections changes no code, no option and no denominator.
 */
export const surveySectionSchema = z.string().trim().min(1).max(MAX_SECTION_LENGTH);

export interface AuthoredOption {
  readonly code: string;
  readonly ordinal: number;
  /** The canonical words, stored on `survey_option`. */
  readonly label: string;
  /** Labels in the other languages, keyed by locale; stored as `survey_option_translation`. */
  readonly translations: Readonly<Record<string, string>>;
}

export interface AuthoredQuestion {
  readonly code: string;
  readonly ordinal: number;
  readonly type: QuestionType;
  readonly prompt: string;
  readonly helpText: string | null;
  readonly required: boolean;
  readonly sensitivity: QuestionSensitivity;
  /** The heading this question sits under, or null for the questions before the first heading. */
  readonly section: string | null;
  readonly options: ReadonlyArray<AuthoredOption>;
  readonly translations: Readonly<
    Record<
      string,
      {
        readonly prompt: string;
        readonly helpText: string | null;
        /** The heading in this language. A section is words, so it is translated like words. */
        readonly section: string | null;
      }
    >
  >;
}

export interface AuthoredDefinition {
  readonly questions: ReadonlyArray<AuthoredQuestion>;
}

const optionInput = z
  .object({
    code: surveyOptionCodeSchema,
    ordinal: z.number().int().min(0).max(MAX_OPTIONS_PER_QUESTION),
    label: z.string().trim().max(MAX_OPTION_LABEL_LENGTH),
    translations: z.record(z.string(), z.string().trim().max(MAX_OPTION_LABEL_LENGTH)),
  })
  .strict();

const questionInput = z
  .object({
    code: surveyQuestionCodeSchema,
    ordinal: z.number().int().min(0).max(MAX_QUESTIONS_PER_VERSION),
    type: questionTypeSchema,
    prompt: z.string().trim().max(MAX_PROMPT_LENGTH),
    helpText: z.string().trim().max(MAX_HELP_TEXT_LENGTH).nullable(),
    required: z.boolean(),
    sensitivity: questionSensitivitySchema,
    section: surveySectionSchema.nullable(),
    options: z.array(optionInput).max(MAX_OPTIONS_PER_QUESTION),
    translations: z.record(
      z.string(),
      z
        .object({
          prompt: z.string().trim().max(MAX_PROMPT_LENGTH),
          helpText: z.string().trim().max(MAX_HELP_TEXT_LENGTH).nullable(),
          section: surveySectionSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

/** The shape a draft arrives in. Bounds and codes only — completeness is publication's question. */
export const authoredDefinitionSchema = z
  .object({ questions: z.array(questionInput).max(MAX_QUESTIONS_PER_VERSION) })
  .strict();

/** Raised when a draft cannot even be stored as written. */
export class SurveyNotAuthorable extends InvalidInput {
  constructor(reason: string) {
    super(`this questionnaire cannot be saved: ${reason}`);
    this.name = "SurveyNotAuthorable";
  }
}

export function isSurveyLocale(value: string): value is SurveyLocale {
  return (SURVEY_LOCALES as readonly string[]).includes(value);
}

/**
 * Every language this definition claims to be written in, canonical first.
 *
 * Derived from the rows rather than declared beside them: a version "published in English" whose
 * English prompts nobody wrote would otherwise be a statement the data does not support.
 */
export function declaredLocales(definition: AuthoredDefinition): ReadonlyArray<SurveyLocale> {
  const found = new Set<SurveyLocale>([CANONICAL_SURVEY_LOCALE]);
  for (const question of definition.questions) {
    for (const locale of Object.keys(question.translations)) {
      if (isSurveyLocale(locale)) found.add(locale);
    }
    for (const option of question.options) {
      for (const locale of Object.keys(option.translations)) {
        if (isSurveyLocale(locale)) found.add(locale);
      }
    }
  }
  return SURVEY_LOCALES.filter((locale) => found.has(locale));
}

/**
 * What must hold before a draft can be stored at all.
 *
 * Deliberately narrower than publication: a form being written is *incomplete*, and refusing to
 * save it until it is finished would mean the author holds the work in a browser tab instead. What
 * is checked here is what cannot be corrected later without breaking something else — the codes,
 * because they are identity; the ordinals, because they are order; the locales, because an unknown
 * one would be a language this product cannot render.
 */
export function assertAuthoredDraftSavable(definition: AuthoredDefinition): void {
  const parsed = authoredDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SurveyNotAuthorable(
      `${issue?.path.join(".") ?? "definition"}: ${issue?.message ?? "invalid"}`,
    );
  }

  const codes = new Set<string>();
  const ordinals = new Set<number>();
  for (const question of definition.questions) {
    if (codes.has(question.code)) {
      throw new SurveyNotAuthorable(`question code "${question.code}" appears more than once`);
    }
    codes.add(question.code);
    if (ordinals.has(question.ordinal)) {
      throw new SurveyNotAuthorable(
        `two questions share position ${question.ordinal}; question order must be deterministic`,
      );
    }
    ordinals.add(question.ordinal);

    const optionCodes = new Set<string>();
    const optionOrdinals = new Set<number>();
    for (const option of question.options) {
      if (optionCodes.has(option.code)) {
        throw new SurveyNotAuthorable(
          `option "${option.code}" appears twice in question "${question.code}"`,
        );
      }
      optionCodes.add(option.code);
      if (optionOrdinals.has(option.ordinal)) {
        throw new SurveyNotAuthorable(
          `two options of question "${question.code}" share position ${option.ordinal}`,
        );
      }
      optionOrdinals.add(option.ordinal);
    }

    for (const locale of [
      ...Object.keys(question.translations),
      ...question.options.flatMap((option) => Object.keys(option.translations)),
    ]) {
      if (!isSurveyLocale(locale)) {
        throw new SurveyNotAuthorable(
          `"${locale}" is not a language this product renders; the questionnaire speaks ` +
            SURVEY_LOCALES.join(" and "),
        );
      }
      if (locale === CANONICAL_SURVEY_LOCALE) {
        throw new SurveyNotAuthorable(
          `${CANONICAL_SURVEY_LOCALE} is the definition's own language and is not a translation ` +
            "of itself",
        );
      }
    }
  }

  assertSectionsContiguous(definition);
}

/**
 * A heading may not be interrupted.
 *
 * *Vivienda · Servicios · Vivienda* is not two sections and a return; it is a form whose grouping
 * says one thing and whose order says another, and the phone and the browser would each have to
 * guess which. Refused while it is still a draft, because after publication nothing is correctable.
 */
export function assertSectionsContiguous(definition: AuthoredDefinition): void {
  const ordered = [...definition.questions].sort((a, b) => a.ordinal - b.ordinal);
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const question of ordered) {
    const section = question.section;
    if (section === previous) continue;
    if (section !== null && seen.has(section)) {
      throw new SurveyNotAuthorable(
        `section "${section}" is interrupted by other questions; a heading groups a contiguous ` +
          "run of questions",
      );
    }
    if (section !== null) seen.add(section);
    previous = section;
  }
}

/** The definitions the existing publication check reads. Sections and translations are not its. */
export function toSurveyQuestionDefinitions(
  definition: AuthoredDefinition,
): ReadonlyArray<SurveyQuestionDefinition> {
  return definition.questions.map((question) => ({
    code: question.code,
    ordinal: question.ordinal,
    type: question.type,
    prompt: question.prompt,
    helpText: question.helpText,
    required: question.required,
    sensitivity: question.sensitivity,
    options: question.options.map((option) => ({
      code: option.code,
      label: option.label,
      ordinal: option.ordinal,
    })),
  }));
}

/**
 * A second language is complete or it is absent.
 *
 * The identity of a question is its **code**, and of an option its code within that question — in
 * both languages, because there is one definition and the other language is rows hanging off it.
 * So a version that carries any English at all must carry all of it: a technician who switched the
 * phone to English and met a Spanish prompt halfway down would be answering a questionnaire nobody
 * wrote, and the tabulation would count it beside the others as though they had been asked the
 * same thing.
 */
export function assertLocaleCoverage(definition: AuthoredDefinition): void {
  for (const locale of declaredLocales(definition)) {
    if (locale === CANONICAL_SURVEY_LOCALE) continue;
    for (const question of definition.questions) {
      const translated = question.translations[locale];
      if (translated === undefined || translated.prompt.trim().length === 0) {
        throw new SurveyNotPublishable(
          `question "${question.code}" has no ${locale} prompt, and this questionnaire declares ` +
            `${locale}`,
        );
      }
      if (question.section !== null && (translated.section ?? "").trim().length === 0) {
        throw new SurveyNotPublishable(
          `question "${question.code}" is under a heading with no ${locale} wording, and this ` +
            `questionnaire declares ${locale}`,
        );
      }
      for (const option of question.options) {
        const label = option.translations[locale];
        if (label === undefined || label.trim().length === 0) {
          throw new SurveyNotPublishable(
            `option "${option.code}" of question "${question.code}" has no ${locale} label, and ` +
              `this questionnaire declares ${locale}`,
          );
        }
      }
    }
  }
}

/**
 * Everything that must hold before people may be asked this.
 *
 * Reuses `assertSurveyVersionPublishable` rather than restating it: "a questionnaire people can
 * answer" is one rule, and a second implementation of it beside the first is how the authoring
 * surface and the seeder eventually disagree about what a valid form is.
 */
export function assertAuthoredVersionPublishable(definition: AuthoredDefinition): void {
  assertAuthoredDraftSavable(definition);
  assertSurveyVersionPublishable(toSurveyQuestionDefinitions(definition));
  assertLocaleCoverage(definition);
}

export interface SurveySection {
  /** Null for the run of questions before the first heading. */
  readonly section: string | null;
  readonly questions: ReadonlyArray<AuthoredQuestion>;
}

/** The form as it is read: headings in question order, each with the run of questions under it. */
export function sectionsOf(definition: AuthoredDefinition): ReadonlyArray<SurveySection> {
  const ordered = [...definition.questions].sort((a, b) => a.ordinal - b.ordinal);
  const groups: Array<{ section: string | null; questions: AuthoredQuestion[] }> = [];
  for (const question of ordered) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.section === question.section) {
      last.questions.push(question);
    } else {
      groups.push({ section: question.section, questions: [question] });
    }
  }
  return groups;
}

/**
 * The next label for a template, from the labels it already has.
 *
 * `v1` when there are none; otherwise one past the highest, so a gap left by nothing is never
 * reused and two drafts cannot both be called `v2`.
 */
export function nextSurveyVersionLabel(existing: ReadonlyArray<string>): string {
  let highest = 0;
  for (const label of existing) {
    const match = /^v([1-9][0-9]{0,2})$/.exec(label.trim());
    if (match === null) continue;
    highest = Math.max(highest, Number.parseInt(match[1] as string, 10));
  }
  return `v${highest + 1}`;
}

/** Whether a question of this type may carry options at all — the surface asks before offering. */
export function acceptsOptions(type: QuestionType): boolean {
  return isChoiceQuestion(type);
}
