import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * What a quality finding is, and what it is careful never to be.
 *
 * A finding says *this pair of statements does not agree*. It never says which one is wrong, and
 * it never says the study is non-compliant — that is invariant 11, and it is the reason the
 * vocabulary in this file is constrained by a lint rather than by taste. "Posible inconsistencia"
 * is a thing a system can honestly detect; "incumplimiento" is a legal conclusion, and a rule that
 * compares two numbers is not entitled to one.
 *
 * The finding therefore holds both sides of the disagreement as evidence, states which rule
 * noticed it, and waits. A person decides.
 */
export const FINDING_TYPES = [
  /** Two sources state different counts, totals or measurements. */
  "NUMERICAL_MISMATCH",
  /** A place, jurisdiction or institution that does not belong to this project's territory. */
  "GEOGRAPHICAL_MISMATCH",
  /** Planned and actual dates diverge, or a sequence is out of order. */
  "TEMPORAL_MISMATCH",
  /** An expected document, section or field is absent. */
  "DOCUMENT_COMPLETENESS",
  /** Two documents assert things that cannot both be describing the same reality. */
  "CROSS_DOCUMENT_INCONSISTENCY",
  /** A conclusion is stated without the evidence the study would need to support it. */
  "MISSING_EVIDENCE",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

/** How much attention it wants. Not how wrong it is — nothing here decides that. */
export const FINDING_SEVERITIES = ["high", "medium", "low"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * The lifecycle (ADR-008 §4).
 *
 * `ACCEPTED` and `RESOLVED` are genuinely different and both are needed: accepting says *yes, this
 * disagreement is real*, resolving says *and the underlying artefact has been corrected*. Collapse
 * them and a study cannot distinguish "we know" from "we fixed it".
 */
export const FINDING_STATES = [
  "OPEN",
  "UNDER_REVIEW",
  "ACCEPTED",
  "DISMISSED",
  "RESOLVED",
] as const;
export type FindingState = (typeof FINDING_STATES)[number];

/**
 * What a person may decide. Each one is a row in `specialist_review`, never an UPDATE of a
 * previous decision: the history of who thought what, and why, is the record.
 */
export const FINDING_DECISIONS = [
  /** Take it: move OPEN → UNDER_REVIEW and put my name on it. */
  "START_REVIEW",
  /** Yes, the disagreement is real. */
  "ACCEPT",
  /** No: the sources are consistent, or the rule misread them. */
  "DISMISS",
  /** Accepted, and the artefact has since been corrected. */
  "RESOLVE",
  /** Needs a second discipline before it can be settled. */
  "REQUEST_INTERDISCIPLINARY",
  /** New evidence, or a mistaken decision: put it back in the queue. */
  "REOPEN",
] as const;
export type FindingDecision = (typeof FINDING_DECISIONS)[number];

/**
 * The transition table. Written as data rather than as a switch so that the UI, the use-case and
 * the tests all read the same one, and so that an unlisted transition is impossible rather than
 * merely unimplemented.
 */
const TRANSITIONS: Readonly<
  Record<FindingDecision, { from: readonly FindingState[]; to: FindingState }>
> = {
  START_REVIEW: { from: ["OPEN"], to: "UNDER_REVIEW" },
  ACCEPT: { from: ["OPEN", "UNDER_REVIEW"], to: "ACCEPTED" },
  DISMISS: { from: ["OPEN", "UNDER_REVIEW"], to: "DISMISSED" },
  RESOLVE: { from: ["ACCEPTED", "UNDER_REVIEW"], to: "RESOLVED" },
  REQUEST_INTERDISCIPLINARY: { from: ["OPEN", "UNDER_REVIEW"], to: "UNDER_REVIEW" },
  REOPEN: { from: ["DISMISSED", "RESOLVED", "ACCEPTED"], to: "OPEN" },
};

/**
 * Justification is mandatory on every decision, and a token word is not a justification.
 *
 * Twelve characters is not a quality bar — nothing can be — but it stops "ok", "sí" and "." from
 * standing as the recorded reason a finding about a study was dismissed. The real enforcement is
 * that the text is kept forever and attributed.
 */
export const MIN_JUSTIFICATION = 12;
export const MAX_JUSTIFICATION = 2000;

export const reviewSubmissionSchema = z
  .object({
    decision: z.enum(FINDING_DECISIONS),
    justification: z.string().trim().min(MIN_JUSTIFICATION).max(MAX_JUSTIFICATION),
  })
  .strict();
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

export interface DecidedTransition {
  readonly decision: FindingDecision;
  readonly fromState: FindingState;
  readonly toState: FindingState;
  readonly justification: string;
  /** `REQUEST_INTERDISCIPLINARY` is the only decision that raises the flag. */
  readonly interdisciplinaryRequired: boolean;
}

/**
 * Apply a decision to a finding's current state, or refuse.
 *
 * Refusing is the point: a client that could post `RESOLVE` at a `DISMISSED` finding would be
 * writing a history that never happened, and the state a report later reads would be a fiction.
 */
export function decideFinding(
  current: FindingState,
  submission: ReviewSubmission,
): DecidedTransition {
  const parsed = reviewSubmissionSchema.parse(submission);
  const transition = TRANSITIONS[parsed.decision];
  if (!transition.from.includes(current)) {
    throw new InvalidInput(
      `a finding in ${current} cannot be ${parsed.decision}: allowed from ${transition.from.join(", ")}`,
    );
  }
  return {
    decision: parsed.decision,
    fromState: current,
    toState: transition.to,
    justification: parsed.justification,
    interdisciplinaryRequired: parsed.decision === "REQUEST_INTERDISCIPLINARY",
  };
}

/** Which decisions a person may take right now. Used by the UI; re-checked by the use-case. */
export function availableDecisions(current: FindingState): ReadonlyArray<FindingDecision> {
  return FINDING_DECISIONS.filter((decision) => TRANSITIONS[decision].from.includes(current));
}

/** A finding nobody has decided yet. The queue's definition of "needs attention". */
export function isOpenForReview(state: FindingState): boolean {
  return state === "OPEN" || state === "UNDER_REVIEW";
}

/**
 * The stable identity of a finding across runs.
 *
 * A run that finds the same disagreement again must update the finding it already raised, not
 * raise a second one — otherwise a weekly check turns one real problem into fifty rows and a
 * specialist's dismissal is undone by the next run. The fingerprint is the rule version plus the
 * normalised identity of what it compared; it deliberately does **not** include the values, so a
 * count changing from 70 to 72 updates the same finding rather than creating a new one and
 * silently abandoning the decision somebody already made about it.
 */
export function findingFingerprint(input: {
  readonly requirementKey: string;
  readonly requirementVersion: string;
  readonly subject: readonly string[];
}): string {
  const subject = input.subject
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .sort();
  if (subject.length === 0) {
    throw new InvalidInput("a finding fingerprint needs at least one subject identifier");
  }
  return [input.requirementKey, input.requirementVersion, ...subject].join("|");
}
