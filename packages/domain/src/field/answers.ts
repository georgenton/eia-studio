import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { isChoiceQuestion, type QuestionType, type SurveyQuestionDefinition } from "./survey";

/**
 * Typed answers (design v0.2 §05).
 *
 * ## Why not one JSONB blob
 *
 * A blob is quick to write and expensive for ever after. It cannot be constrained, so nothing
 * stops a number arriving where a date belongs; it cannot be indexed usefully, so the Social
 * slice's tabulation becomes a scan with casts; and a choice answer in a blob is a string that
 * nobody guarantees still exists as an option of that version. Every one of those costs is paid by
 * the next slice, which is exactly the slice this foundation exists for.
 *
 * So an answer is a row with **mutually exclusive typed columns**, and a multi-choice answer is
 * rows in a join table pointing at options of the *same* version. The database enforces the
 * exclusivity and the option ownership; this module is the same rule where the user can be told
 * about it.
 */
export const ANSWER_VALUE_COLUMNS = [
  "textValue",
  "numberValue",
  "booleanValue",
  "dateValue",
  "optionId",
] as const;

/** Which column a question type is allowed to fill. `MULTI_CHOICE` fills none: it uses the join. */
export const ANSWER_COLUMN_FOR_TYPE: Readonly<
  Record<QuestionType, (typeof ANSWER_VALUE_COLUMNS)[number] | null>
> = {
  SHORT_TEXT: "textValue",
  LONG_TEXT: "textValue",
  INTEGER: "numberValue",
  DECIMAL: "numberValue",
  BOOLEAN: "booleanValue",
  DATE: "dateValue",
  SINGLE_CHOICE: "optionId",
  MULTI_CHOICE: null,
};

/** What a caller submits for one question, before it becomes a row. */
export type AnswerInput =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "option"; readonly optionCode: string }
  | { readonly kind: "options"; readonly optionCodes: ReadonlyArray<string> }
  | { readonly kind: "blank" };

export const answerInputSchema: z.ZodType<AnswerInput> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string().max(4000) }).strict(),
  z.object({ kind: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal("option"), optionCode: z.string().min(1).max(40) }).strict(),
  z
    .object({
      kind: z.literal("options"),
      optionCodes: z.array(z.string().min(1).max(40)).max(50),
    })
    .strict(),
  z.object({ kind: z.literal("blank") }).strict(),
]);

export class AnswerTypeMismatch extends InvalidInput {
  constructor(
    readonly questionCode: string,
    reason: string,
  ) {
    super(`answer to "${questionCode}" is not valid: ${reason}`);
    this.name = "AnswerTypeMismatch";
  }
}

export class RequiredAnswerMissing extends InvalidInput {
  constructor(readonly questionCodes: ReadonlyArray<string>) {
    super(`these required questions have no answer: ${questionCodes.join(", ")}`);
    this.name = "RequiredAnswerMissing";
  }
}

function isBlank(input: AnswerInput): boolean {
  if (input.kind === "blank") return true;
  if (input.kind === "text") return input.value.trim().length === 0;
  if (input.kind === "options") return input.optionCodes.length === 0;
  return false;
}

/**
 * Check one answer against the question that was actually asked.
 *
 * Type, and option membership: a `SINGLE_CHOICE` answer must name an option **of this question of
 * this version**, which is what stops a v2 option code being accepted against a v1 response.
 */
export function validateAnswer(question: SurveyQuestionDefinition, input: AnswerInput): void {
  if (isBlank(input)) return;

  const optionCodes = new Set(question.options.map((option) => option.code));

  switch (question.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      if (input.kind !== "text") {
        throw new AnswerTypeMismatch(question.code, `${question.type} expects text`);
      }
      if (question.type === "SHORT_TEXT" && input.value.length > 300) {
        throw new AnswerTypeMismatch(
          question.code,
          "a short text answer is at most 300 characters",
        );
      }
      return;

    case "INTEGER":
      if (input.kind !== "number") {
        throw new AnswerTypeMismatch(question.code, "INTEGER expects a number");
      }
      if (!Number.isInteger(input.value)) {
        throw new AnswerTypeMismatch(
          question.code,
          `INTEGER expects a whole number, got ${input.value}`,
        );
      }
      return;

    case "DECIMAL":
      if (input.kind !== "number") {
        throw new AnswerTypeMismatch(question.code, "DECIMAL expects a number");
      }
      return;

    case "BOOLEAN":
      if (input.kind !== "boolean") {
        throw new AnswerTypeMismatch(question.code, "BOOLEAN expects true or false");
      }
      return;

    case "DATE": {
      if (input.kind !== "date") {
        throw new AnswerTypeMismatch(question.code, "DATE expects an ISO date, YYYY-MM-DD");
      }
      const parsed = new Date(`${input.value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) {
        throw new AnswerTypeMismatch(question.code, `"${input.value}" is not a real date`);
      }
      return;
    }

    case "SINGLE_CHOICE":
      if (input.kind !== "option") {
        throw new AnswerTypeMismatch(question.code, "SINGLE_CHOICE expects exactly one option");
      }
      if (!optionCodes.has(input.optionCode)) {
        throw new AnswerTypeMismatch(
          question.code,
          `"${input.optionCode}" is not an option of this question in this survey version`,
        );
      }
      return;

    case "MULTI_CHOICE": {
      if (input.kind !== "options") {
        throw new AnswerTypeMismatch(question.code, "MULTI_CHOICE expects a list of options");
      }
      const seen = new Set<string>();
      for (const code of input.optionCodes) {
        if (!optionCodes.has(code)) {
          throw new AnswerTypeMismatch(
            question.code,
            `"${code}" is not an option of this question in this survey version`,
          );
        }
        if (seen.has(code)) {
          throw new AnswerTypeMismatch(question.code, `option "${code}" is selected twice`);
        }
        seen.add(code);
      }
      return;
    }
  }
}

/**
 * Validate a whole submission: every answer typed correctly, and every required question answered.
 *
 * Required-ness is checked **on submit**, not while drafting — a technician saving half a form
 * mid-visit is the normal case, and refusing that would push them to invent values. Answers to
 * questions that do not exist in this version are refused rather than dropped, because silently
 * discarding a technician's input is worse than telling them the form has moved on.
 */
export function assertSubmissionComplete(
  questions: ReadonlyArray<SurveyQuestionDefinition>,
  answers: ReadonlyMap<string, AnswerInput>,
): void {
  const byCode = new Map(questions.map((question) => [question.code, question]));

  for (const [code, input] of answers) {
    const question = byCode.get(code);
    if (!question) {
      throw new AnswerTypeMismatch(code, "this question does not exist in this survey version");
    }
    validateAnswer(question, input);
  }

  const missing = questions
    .filter((question) => {
      if (!question.required) return false;
      const input = answers.get(question.code);
      return input === undefined || isBlank(input);
    })
    .map((question) => question.code);

  if (missing.length > 0) throw new RequiredAnswerMissing(missing);
}

/** Which typed column a validated answer belongs in; `null` means the multi-choice join table. */
export function answerColumnFor(question: SurveyQuestionDefinition): string | null {
  return isChoiceQuestion(question.type) && question.type === "MULTI_CHOICE"
    ? null
    : ANSWER_COLUMN_FOR_TYPE[question.type];
}
