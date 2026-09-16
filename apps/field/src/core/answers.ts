import {
  assertSubmissionComplete,
  validateAnswer,
  type SurveyQuestionDefinition,
} from "@eia/domain/mobile";
import type { PackQuestion, WireAnswer } from "@eia/field-sync-contract";
import type { AnswerInput, QuestionType, QuestionSensitivity } from "@eia/domain/mobile";

/**
 * The device validates with the **server's own rules**, not with a second copy of them.
 *
 * `@eia/domain` is pure — zod and nothing else — so the functions that decide whether an answer
 * fits its question and whether a submission is complete run unchanged inside the React Native
 * bundle. That matters more offline than anywhere else: a technician four hours from a signal must
 * find out that a required question is empty *now*, and the answer they get must be the same
 * answer the server would give, or the survey bounces back after the drive home.
 */
export function toQuestionDefinition(question: PackQuestion): SurveyQuestionDefinition {
  return {
    code: question.code,
    ordinal: question.ordinal,
    type: question.type as QuestionType,
    prompt: question.prompt,
    helpText: question.helpText,
    required: question.required,
    sensitivity: question.sensitivity as QuestionSensitivity,
    options: question.options.map((option) => ({
      code: option.code,
      label: option.label,
      ordinal: option.ordinal,
    })),
  };
}

/**
 * The wire shape **is** the domain's input shape.
 *
 * This function is therefore the identity, and it stays as a named function rather than being
 * inlined because it is the single place the equivalence is asserted: if the two unions ever
 * diverge, this stops compiling here rather than failing on a phone.
 */
export function toAnswerInput(answer: WireAnswer): AnswerInput {
  return answer;
}

export interface FieldIssue {
  readonly questionCode: string;
  readonly message: string;
}

/** Per-question validation, for showing an error beside the field as it is typed. */
export function validateField(question: PackQuestion, answer: WireAnswer): FieldIssue | null {
  try {
    validateAnswer(toQuestionDefinition(question), toAnswerInput(answer));
    return null;
  } catch (error) {
    return { questionCode: question.code, message: messageOf(error) };
  }
}

/**
 * The gate in front of *Enviar en el dispositivo*.
 *
 * It runs the domain's `assertSubmissionComplete`, which is the same check the server runs on
 * arrival — required questions present, types right, choices drawn from the version's own options.
 * A survey that passes here is one the server will accept, which is what lets the device call it
 * submitted while still in a valley.
 */
export function validateSubmission(
  questions: ReadonlyArray<PackQuestion>,
  answers: Readonly<Record<string, WireAnswer>>,
): ReadonlyArray<FieldIssue> {
  const issues: FieldIssue[] = [];
  const definitions = questions.map(toQuestionDefinition);
  const map = new Map<string, AnswerInput>();
  for (const [code, answer] of Object.entries(answers)) map.set(code, toAnswerInput(answer));

  for (const definition of definitions) {
    const answer = map.get(definition.code);
    if (!answer) continue;
    try {
      validateAnswer(definition, answer);
    } catch (error) {
      issues.push({ questionCode: definition.code, message: messageOf(error) });
    }
  }
  if (issues.length > 0) return issues;

  try {
    assertSubmissionComplete(definitions, map);
  } catch (error) {
    issues.push({ questionCode: "*", message: messageOf(error) });
  }
  return issues;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Respuesta no válida.";
}
