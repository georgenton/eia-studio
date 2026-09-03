import type { QuestionType } from "../field/survey";

/**
 * Closed-question tabulation: arithmetic, and nothing else.
 *
 * No model is consulted to produce any number in this file, and none ever should be. Counts,
 * percentages, totals and unanswered figures are the deterministic half of Social Intelligence —
 * the half a reader can reproduce by hand from the same rows, which is what invariant 5 asks of
 * every figure the product shows.
 *
 * ## Denominators are declared, never inherited from a join
 *
 * The commonest way to publish a wrong percentage is to divide by however many rows a query
 * happened to return. Every distribution here therefore carries its denominator *and the name of
 * the rule that chose it*, and the UI prints that name. Three rules exist:
 *
 * - `submitted` — responses submitted for this survey version. The universe.
 * - `answered` — those that answered this question. Percentages of a single choice use this.
 * - `answered_multi` — those that answered a multi-choice question. Each option's share is over
 *   respondents, so the shares **can add up to more than 100 %**, because one person may select
 *   several. Saying so is part of the number.
 *
 * ## One survey version at a time
 *
 * Answers are only interpretable against the version that asked them, so tabulation groups by
 * `SurveyVersion` and does not add two versions together. Aggregating across versions needs a
 * declared mapping between their questions (TD-039); matching on question text would be a guess
 * dressed as a result.
 */
export const DENOMINATOR_RULES = ["submitted", "answered", "answered_multi"] as const;
export type DenominatorRule = (typeof DENOMINATOR_RULES)[number];

export const DENOMINATOR_COPY: Readonly<
  Record<DenominatorRule, { readonly label: string; readonly help: string }>
> = {
  submitted: {
    label: "sobre respuestas enviadas",
    help: "Base: todas las respuestas enviadas de esta versión del cuestionario.",
  },
  answered: {
    label: "sobre quienes respondieron la pregunta",
    help: "Base: respuestas enviadas que contestaron esta pregunta. Los porcentajes suman 100 %.",
  },
  answered_multi: {
    label: "sobre quienes respondieron la pregunta (selección múltiple)",
    help:
      "Base: respuestas enviadas que contestaron esta pregunta. Cada persona puede elegir varias " +
      "opciones, así que la suma de los porcentajes puede superar el 100 %.",
  },
};

export interface CategoryTally {
  readonly code: string;
  readonly label: string;
  readonly count: number;
  /** Share of the declared denominator, 0–1. Null when the denominator is zero. */
  readonly share: number | null;
}

export interface QuestionTabulation {
  readonly questionId: string;
  readonly code: string;
  readonly prompt: string;
  readonly type: QuestionType;
  /** Responses submitted for this survey version — the universe, whatever the question. */
  readonly submitted: number;
  readonly answered: number;
  readonly unanswered: number;
  readonly denominatorRule: DenominatorRule;
  readonly denominator: number;
  readonly tallies: ReadonlyArray<CategoryTally>;
  /** Populated for INTEGER and DECIMAL questions; null elsewhere. */
  readonly numeric: NumericSummary | null;
}

export interface NumericSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
}

/** Which denominator a question type uses, in one place so the UI and the arithmetic agree. */
export function denominatorRuleFor(type: QuestionType): DenominatorRule {
  return type === "MULTI_CHOICE" ? "answered_multi" : "answered";
}

/** A share, or null when dividing would be a lie about a denominator of zero. */
export function share(count: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return count / denominator;
}

export interface TallyInput {
  readonly code: string;
  readonly label: string;
  readonly count: number;
}

/**
 * Build one question's tabulation from counts that were computed in SQL.
 *
 * The counting happens in the database; this function decides the denominator, computes the
 * shares and states the rule. Keeping the second half here — pure, ordered, testable — is what
 * makes the denominator regression tests possible without a database.
 */
export function tabulateQuestion(input: {
  readonly questionId: string;
  readonly code: string;
  readonly prompt: string;
  readonly type: QuestionType;
  readonly submitted: number;
  readonly answered: number;
  readonly tallies: ReadonlyArray<TallyInput>;
  readonly numeric?: NumericSummary | null;
}): QuestionTabulation {
  const rule = denominatorRuleFor(input.type);
  const denominator = input.answered;
  return {
    questionId: input.questionId,
    code: input.code,
    prompt: input.prompt,
    type: input.type,
    submitted: input.submitted,
    answered: input.answered,
    unanswered: Math.max(0, input.submitted - input.answered),
    denominatorRule: rule,
    denominator,
    tallies: input.tallies.map((tally) => ({
      code: tally.code,
      label: tally.label,
      count: tally.count,
      share: share(tally.count, denominator),
    })),
    numeric: input.numeric ?? null,
  };
}

/** Median of a sorted-or-unsorted numeric list, for the numeric summary. */
export function summariseNumeric(values: ReadonlyArray<number>): NumericSummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    median,
  };
}

/**
 * Question types this slice tabulates. `SHORT_TEXT`/`LONG_TEXT` are the open responses, which are
 * coded rather than counted, and `DATE` has no meaningful distribution for four demo responses.
 */
export const TABULATED_QUESTION_TYPES: ReadonlyArray<QuestionType> = [
  "BOOLEAN",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "INTEGER",
  "DECIMAL",
];

export function isTabulated(type: QuestionType): boolean {
  return TABULATED_QUESTION_TYPES.includes(type);
}

/**
 * The validated theme distribution: counts of the categories a *human* settled on.
 *
 * Only reviewed responses take part, and the unreviewed count is reported beside it rather than
 * extrapolated over. A distribution that quietly assumed unreviewed responses look like reviewed
 * ones would be a projection presented as a measurement.
 */
export interface ValidatedDistribution {
  readonly reviewed: number;
  readonly unreviewed: number;
  readonly denominatorRule: DenominatorRule;
  readonly tallies: ReadonlyArray<CategoryTally>;
}

export function distributeValidated(input: {
  readonly reviewed: number;
  readonly unreviewed: number;
  readonly tallies: ReadonlyArray<TallyInput>;
}): ValidatedDistribution {
  return {
    reviewed: input.reviewed,
    unreviewed: input.unreviewed,
    // Multi-label coding: one response can carry several themes, so the shares are over reviewed
    // responses and may sum past 100 %, exactly like a multi-choice question.
    denominatorRule: "answered_multi",
    tallies: input.tallies.map((tally) => ({
      code: tally.code,
      label: tally.label,
      count: tally.count,
      share: share(tally.count, input.reviewed),
    })),
  };
}
