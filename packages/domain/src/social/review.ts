import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { assertCategoriesBelong, type TaxonomyDefinition } from "./taxonomy";

/**
 * The human decision, which is the one the product treats as true.
 *
 * A specialist looks at an open response, sees what the model proposed, and either agrees or
 * changes it. Two things must survive that moment: the model's proposal, unedited, and the
 * specialist's final labels. Analytics read the second; evaluation reads both.
 */
export const REVIEW_DECISIONS = ["ACCEPTED", "CORRECTED"] as const;
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const REVIEW_DECISION_LABEL: Readonly<Record<ReviewDecision, string>> = {
  ACCEPTED: "Aceptada",
  CORRECTED: "Corregida",
};

/**
 * The decision is *derived* from the labels, never taken on trust from the client.
 *
 * If a reviewer's final set equals the proposal, the decision is ACCEPTED; if it differs in any
 * way, it is CORRECTED. Letting the client send the decision would allow a correction to be
 * recorded as an acceptance, which is precisely the number an evaluation later depends on.
 */
export function decideReview(
  proposed: ReadonlyArray<string>,
  final: ReadonlyArray<string>,
): ReviewDecision {
  return setsEqual(proposed, final) ? "ACCEPTED" : "CORRECTED";
}

export class InvalidReview extends InvalidInput {
  override readonly name = "InvalidReview";
}

/**
 * A review must select at least one category of the same version the proposal used.
 *
 * The version is fixed by the classification being reviewed; the review page cannot change it. A
 * reviewer who thinks the scheme itself is wrong needs a new taxonomy version, which is a
 * different action with a different audit trail.
 */
export function assertReviewSelectable(
  taxonomy: TaxonomyDefinition,
  final: ReadonlyArray<string>,
): void {
  if (final.length === 0) {
    throw new InvalidReview(
      "a review must keep at least one category; if nothing applies, choose the residual category",
    );
  }
  if (new Set(final).size !== final.length) {
    throw new InvalidReview("a review cannot select the same category twice");
  }
  assertCategoriesBelong(taxonomy, final);
}

/**
 * How a proposal and a final coding compare, computed deterministically.
 *
 * The taxonomy is multi-label, so "did the model get it right" is not a yes/no on one label. What
 * is well defined is the set relationship: identical, or which labels the human added and removed.
 *
 * **This is agreement, not accuracy.** The reviewer saw the proposal before deciding, so their
 * final labels are not an independent gold standard and the rate at which the two coincide is an
 * operational measure of how often the specialist let the proposal stand. Calling it accuracy
 * would attribute to the model a correctness nobody measured (AI_GOVERNANCE.md; §31 of the slice
 * brief). A gold standard needs blinded, independent coding and adjudication, which this slice
 * deliberately does not implement.
 */
export interface LabelAgreement {
  readonly exactMatch: boolean;
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly kept: ReadonlyArray<string>;
}

export function compareLabels(
  proposed: ReadonlyArray<string>,
  final: ReadonlyArray<string>,
): LabelAgreement {
  const proposedSet = new Set(proposed);
  const finalSet = new Set(final);
  const added = [...finalSet].filter((code) => !proposedSet.has(code)).sort();
  const removed = [...proposedSet].filter((code) => !finalSet.has(code)).sort();
  const kept = [...finalSet].filter((code) => proposedSet.has(code)).sort();
  return { exactMatch: added.length === 0 && removed.length === 0, added, removed, kept };
}

function setsEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  for (const value of b) if (!left.has(value)) return false;
  return left.size === new Set(b).size;
}

/**
 * Aggregate agreement over many reviews. Every field is a count or a ratio of counts — arithmetic,
 * not inference — and every name says "agreement" or "override" rather than "accuracy".
 */
export interface AgreementSummary {
  readonly reviewed: number;
  readonly exactMatches: number;
  readonly overrides: number;
  /** Reviews whose final set equals the proposal, over reviews made. Null when none were made. */
  readonly agreementRate: number | null;
  readonly overrideRate: number | null;
  readonly labelsAdded: number;
  readonly labelsRemoved: number;
}

export function summariseAgreement(comparisons: ReadonlyArray<LabelAgreement>): AgreementSummary {
  const reviewed = comparisons.length;
  const exactMatches = comparisons.filter((c) => c.exactMatch).length;
  const overrides = reviewed - exactMatches;
  return {
    reviewed,
    exactMatches,
    overrides,
    agreementRate: reviewed === 0 ? null : exactMatches / reviewed,
    overrideRate: reviewed === 0 ? null : overrides / reviewed,
    labelsAdded: comparisons.reduce((total, c) => total + c.added.length, 0),
    labelsRemoved: comparisons.reduce((total, c) => total + c.removed.length, 0),
  };
}

/**
 * The wording the product uses for that number, kept beside the calculation so a screen cannot
 * quietly rename it.
 */
export const AGREEMENT_SEMANTICS = {
  label: "Coincidencia IA · especialista",
  help:
    "Proporción de respuestas en las que el especialista mantuvo exactamente las categorías " +
    "propuestas. El especialista revisó viendo la propuesta, así que esto mide concordancia " +
    "operativa, no acierto del modelo frente a una codificación independiente.",
  overrideLabel: "Corregidas por el especialista",
} as const;
