import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * The questionnaire, and the rule that makes answers mean anything (design v0.2, invariant 9).
 *
 * ## Template versus version
 *
 * A `SurveyTemplate` is the questionnaire as a *concept* — "ficha socioeconómica" — and it is a
 * name and an owner, nothing more. A `SurveyVersion` is a **definition**: the exact questions,
 * their order, their types and their options. Answers reference a version, never a template.
 *
 * ## Why a published version is immutable
 *
 * An answer is only interpretable against the question that was asked. If a question meant one
 * thing when people answered it and someone later edits it to mean another, those answers
 * silently change meaning and nothing in the data records that it happened. That is not an edge
 * case; it is the ordinary way a questionnaire evolves during fieldwork.
 *
 * So: a `DRAFT` version may be edited freely, a `PUBLISHED` version may not be edited at all, and
 * changing a published questionnaire means publishing a **new version**. Old responses keep
 * pointing at the old version, which stays readable after it is `RETIRED`. The database enforces
 * this with triggers, because an application rule that lives only in a use-case is one repository
 * call away from being bypassed.
 */
export const SURVEY_VERSION_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export const surveyVersionStatusSchema = z.enum(SURVEY_VERSION_STATUSES);
export type SurveyVersionStatus = z.infer<typeof surveyVersionStatusSchema>;

/**
 * Question types this slice supports — the ones the road/social demonstration actually needs.
 *
 * Deliberately absent: matrices, repeating groups, signatures, skip-logic expressions and any
 * calculation language. Each of those is a small language, and a small language is a large
 * feature; none is needed to capture the demo questionnaire, and inventing them now would fix
 * their semantics before a real form has asked for them.
 */
export const QUESTION_TYPES = [
  "SHORT_TEXT",
  "LONG_TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "DATE",
] as const;
export const questionTypeSchema = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof questionTypeSchema>;

/** Types whose answers come from `SurveyOption` rows belonging to the same version. */
export const CHOICE_QUESTION_TYPES: ReadonlyArray<QuestionType> = ["SINGLE_CHOICE", "MULTI_CHOICE"];

export function isChoiceQuestion(type: QuestionType): boolean {
  return CHOICE_QUESTION_TYPES.includes(type);
}

/**
 * What kind of data a question collects, recorded on the question itself.
 *
 * Cheap to store, and it is the hook a later retention or export policy needs: an exporter can ask
 * "does this version contain sensitive answers" without a human re-reading the form. It is a
 * classification, not an authorization — nothing in this slice grants or denies on it, and it is
 * not a claim that collecting a category is lawful (SECURITY.md §10a).
 */
export const QUESTION_SENSITIVITY = ["NON_PERSONAL", "PERSONAL", "SENSITIVE"] as const;
export const questionSensitivitySchema = z.enum(QUESTION_SENSITIVITY);
export type QuestionSensitivity = z.infer<typeof questionSensitivitySchema>;

export interface SurveyOptionDefinition {
  readonly code: string;
  readonly label: string;
  readonly ordinal: number;
}

export interface SurveyQuestionDefinition {
  /** Stable per version; what an answer row points at, and what tabulation groups by. */
  readonly code: string;
  readonly ordinal: number;
  readonly type: QuestionType;
  readonly prompt: string;
  readonly helpText: string | null;
  readonly required: boolean;
  readonly sensitivity: QuestionSensitivity;
  readonly options: ReadonlyArray<SurveyOptionDefinition>;
}

export const surveyQuestionCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "a question code is lower snake_case, e.g. tenure_category");

export const surveyOptionCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "an option code is lower snake_case, e.g. owner_occupier");

/** Raised when a draft version cannot become a questionnaire people can answer. */
export class SurveyNotPublishable extends InvalidInput {
  constructor(reason: string) {
    super(`this survey version cannot be published: ${reason}`);
    this.name = "SurveyNotPublishable";
  }
}

/** Raised on any attempt to change a version that answers already depend on. */
export class PublishedSurveyImmutable extends InvalidInput {
  constructor(versionLabel: string) {
    super(
      `survey version ${versionLabel} is published and cannot be edited; publish a new version ` +
        "instead, so existing answers keep the questionnaire they were given",
    );
    this.name = "PublishedSurveyImmutable";
  }
}

/**
 * Everything that must hold before a questionnaire can be answered. Checked before publication,
 * because after it the definition can no longer be corrected in place.
 */
export function assertSurveyVersionPublishable(
  questions: ReadonlyArray<SurveyQuestionDefinition>,
): void {
  if (questions.length === 0) {
    throw new SurveyNotPublishable("it has no questions");
  }

  const codes = new Set<string>();
  const ordinals = new Set<number>();
  for (const question of questions) {
    const parsedCode = surveyQuestionCodeSchema.safeParse(question.code);
    if (!parsedCode.success) {
      throw new SurveyNotPublishable(
        `question code "${question.code}" is not a valid code (${parsedCode.error.issues[0]?.message})`,
      );
    }
    if (codes.has(question.code)) {
      throw new SurveyNotPublishable(`question code "${question.code}" appears more than once`);
    }
    codes.add(question.code);

    if (!Number.isInteger(question.ordinal) || question.ordinal < 0) {
      throw new SurveyNotPublishable(`question "${question.code}" has a non-ordinal position`);
    }
    if (ordinals.has(question.ordinal)) {
      throw new SurveyNotPublishable(
        `two questions share position ${question.ordinal}; question order must be deterministic`,
      );
    }
    ordinals.add(question.ordinal);

    if (question.prompt.trim().length === 0) {
      throw new SurveyNotPublishable(`question "${question.code}" has no prompt`);
    }

    if (isChoiceQuestion(question.type)) {
      if (question.options.length < 2) {
        throw new SurveyNotPublishable(
          `question "${question.code}" is a choice question with fewer than two options`,
        );
      }
      const optionCodes = new Set<string>();
      const optionOrdinals = new Set<number>();
      for (const option of question.options) {
        const parsed = surveyOptionCodeSchema.safeParse(option.code);
        if (!parsed.success) {
          throw new SurveyNotPublishable(
            `option "${option.code}" of question "${question.code}" is not a valid code`,
          );
        }
        if (optionCodes.has(option.code)) {
          throw new SurveyNotPublishable(
            `option "${option.code}" appears twice in question "${question.code}"`,
          );
        }
        optionCodes.add(option.code);
        if (optionOrdinals.has(option.ordinal)) {
          throw new SurveyNotPublishable(
            `two options of question "${question.code}" share position ${option.ordinal}`,
          );
        }
        optionOrdinals.add(option.ordinal);
        if (option.label.trim().length === 0) {
          throw new SurveyNotPublishable(
            `option "${option.code}" of question "${question.code}" has no label`,
          );
        }
      }
    } else if (question.options.length > 0) {
      throw new SurveyNotPublishable(
        `question "${question.code}" is a ${question.type} question but carries options`,
      );
    }
  }
}

/**
 * A deterministic fingerprint of a version's definition.
 *
 * It exists so a mismatch is *detectable*: an external adapter that thinks it is submitting
 * against v1 can be told it is not, and a test can assert a published definition never moved. It
 * is FNV-1a over a canonical rendering — not a cryptographic hash, and not identity. The version's
 * UUID is identity.
 */
export function surveyVersionHash(questions: ReadonlyArray<SurveyQuestionDefinition>): string {
  const canonical = [...questions]
    .sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code))
    .map((question) =>
      [
        question.ordinal,
        question.code,
        question.type,
        question.required ? "1" : "0",
        question.sensitivity,
        question.prompt.trim(),
        [...question.options]
          .sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code))
          .map((option) => `${option.ordinal}:${option.code}:${option.label.trim()}`)
          .join("|"),
      ].join(""),
    )
    .join("");

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
