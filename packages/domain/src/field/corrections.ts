import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * Correcting a submitted response, without ever editing one (ADR-038).
 *
 * ## The invariant, stated before the schema
 *
 * **A submitted response is never edited. A correction is a new response, captured in the ordinary
 * way, and an explicit relation says which response it replaces.** The original keeps its answers,
 * its technician, its visit and its provenance; the correction has its own of each; and *which one
 * the study currently means* is a question the relation answers, never a timestamp and never a
 * mutable flag on the row.
 *
 * Migration 0014 already said this, in the comment beside the trigger that refuses the write:
 * *"Correction, when it exists, will be a reviewed workflow that records who changed what — not an
 * UPDATE that leaves no trace."* This module is that workflow.
 *
 * ## Why a correction is a new assignment
 *
 * `survey_instance` is unique on `(tenant, assignment, version)` — the constraint that makes a
 * retried submit find the row it already wrote rather than create a second household. A correction
 * captured against the *same* assignment would either violate it or require relaxing the one
 * invariant that makes offline retry safe.
 *
 * So the correction gets an assignment of its own, in the **same campaign** (tabulation is scoped
 * by campaign) and on the **same parcel**, carrying `corrects_assignment_id`. Three things follow
 * for free: the offline path needs no new command, because a correction assignment is an
 * assignment; *who was originally assigned* and *who performed the correction* are two rows rather
 * than one overwritten column; and every correction capture has its own visit.
 *
 * ## Why the questionnaire does not move
 *
 * A correcting response answers **the same `SurveyVersion`** the original answered. *What did we
 * ask?* and *what is the effective answer?* are different questions (ADR-037, ADR-006). Producing a
 * new version because one household's answer was wrong would reinterpret every other response in
 * the campaign.
 */

/**
 * Three states, and the two that are deliberately absent.
 *
 * There is no `IN_PROGRESS`: whether a technician has started is already on the correction's own
 * assignment and its visit, and a second copy of that fact is a second thing to keep in step. There
 * is no `SUBMITTED` beside `APPLIED` either — that pair would imply an approval step between
 * submitting a correction and it taking effect, and there is no such step. Submitting **is**
 * applying, and inventing a state for a review nobody performs is the same fiction as a report
 * status nobody sets (TD-060).
 */
export const CORRECTION_STATES = ["REQUESTED", "APPLIED", "CANCELLED"] as const;
export const correctionStateSchema = z.enum(CORRECTION_STATES);
export type CorrectionState = z.infer<typeof correctionStateSchema>;

/**
 * Why this response is being corrected, in a person's words.
 *
 * At least twelve characters, the bound `specialist_review.justification` already uses: "ok" cannot
 * stand as the recorded reason a household's answer was replaced. It is **operational** text — a
 * coordinator writing *"el técnico registró 3 personas y la informante indica 5"* is describing the
 * error, and this field is shown beside the lineage. It is never written to the audit log, because
 * a reason can quote an answer (SECURITY.md §9).
 */
export const correctionReasonSchema = z
  .string()
  .trim()
  .min(12, "say why this response is being corrected, in at least a few words")
  .max(500);

export class ResponseNotCorrectable extends InvalidInput {
  constructor(reason: string) {
    super(`this response cannot be corrected: ${reason}`);
    this.name = "ResponseNotCorrectable";
  }
}

export class CorrectionNotOpen extends InvalidInput {
  constructor(state: CorrectionState) {
    super(
      `this correction is ${state.toLowerCase()} and is not open; a further correction is ` +
        "requested against the response that is currently effective",
    );
    this.name = "CorrectionNotOpen";
  }
}

export interface CorrectionRequestFacts {
  /** The status of the response somebody wants corrected. */
  readonly instanceStatus: string;
  /** Whether that response is the one the study currently means. */
  readonly isEffective: boolean;
  /** Whether a correction of it is already open. */
  readonly hasOpenCorrection: boolean;
}

/**
 * What must hold before a correction may be requested.
 *
 * The middle condition is the one that prevents a fork. A correction always applies to the response
 * that is **currently effective**, so a lineage stays a line: original → correction 1 → correction
 * 2. Requesting a second correction of the *original* after correction 1 was applied would create
 * two claimants to the same lineage, and nothing downstream could decide between them.
 */
export function assertCorrectionRequestable(facts: CorrectionRequestFacts): void {
  if (facts.instanceStatus !== "SUBMITTED") {
    throw new ResponseNotCorrectable(
      "it has not been submitted. A response still being captured is edited, not corrected",
    );
  }
  if (!facts.isEffective) {
    throw new ResponseNotCorrectable(
      "it has already been superseded by a correction. Correct the response that is currently " +
        "effective instead, so the lineage stays a line rather than a fork",
    );
  }
  if (facts.hasOpenCorrection) {
    throw new ResponseNotCorrectable(
      "a correction of it is already open. Complete or cancel that one first, so there is one " +
        "answer to what is being corrected",
    );
  }
}

/** A correction settles once: `REQUESTED` → `APPLIED`, or `REQUESTED` → `CANCELLED`. */
export function assertCorrectionTransition(from: CorrectionState, to: CorrectionState): void {
  if (from !== "REQUESTED") throw new CorrectionNotOpen(from);
  if (to === "REQUESTED") {
    throw new InvalidInput("a correction does not return to requested");
  }
}

export interface CorrectionLink {
  readonly originalInstanceId: string;
  readonly correctingInstanceId: string | null;
  readonly state: CorrectionState;
}

/**
 * **The rule, in one place.** Which response a lineage currently means.
 *
 * Follow applied corrections from the root; stop at the first response that has none. A
 * `REQUESTED` correction is not followed — the original stays effective until the correction is
 * actually captured — and a `CANCELLED` one never was.
 *
 * `app.effective_survey_instance` is the same rule in SQL, and it is what every analytic reads: a
 * view rather than a repeated predicate, so *"where superseded = false"* cannot be invented twice
 * and drift. This function is the specification that view is tested against, and
 * `packages/testing/test/rls/survey-corrections.integration.test.ts` asserts the two agree over
 * generated chains.
 *
 * Wall-clock time decides nothing here. The chain is an explicit relation, so two corrections
 * recorded in the same millisecond still have one order.
 */
export function resolveEffectiveInstance(
  rootInstanceId: string,
  links: ReadonlyArray<CorrectionLink>,
): string {
  const applied = new Map<string, string>();
  for (const link of links) {
    if (link.state !== "APPLIED" || link.correctingInstanceId === null) continue;
    if (applied.has(link.originalInstanceId)) {
      // Refused by a partial unique index in the database; unreachable from a real read.
      throw new InvalidInput(
        `response ${link.originalInstanceId} has more than one applied correction`,
      );
    }
    applied.set(link.originalInstanceId, link.correctingInstanceId);
  }

  const seen = new Set<string>([rootInstanceId]);
  let current = rootInstanceId;
  for (;;) {
    const next = applied.get(current);
    if (next === undefined) return current;
    if (seen.has(next)) {
      // Refused by a trigger; stated here so the pure rule terminates on any input.
      throw new InvalidInput(`correction chain from ${rootInstanceId} contains a cycle`);
    }
    seen.add(next);
    current = next;
  }
}

/** How many corrections deep the effective response is. Zero means the original still stands. */
export function correctionGeneration(
  rootInstanceId: string,
  links: ReadonlyArray<CorrectionLink>,
): number {
  const effective = resolveEffectiveInstance(rootInstanceId, links);
  let generation = 0;
  let current = rootInstanceId;
  const applied = new Map(
    links
      .filter((link) => link.state === "APPLIED" && link.correctingInstanceId !== null)
      .map((link) => [link.originalInstanceId, link.correctingInstanceId as string]),
  );
  while (current !== effective) {
    current = applied.get(current) as string;
    generation += 1;
  }
  return generation;
}
