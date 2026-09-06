import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { isDemo, type ProvenanceFacets } from "../provenance/facets";
import { assertCategoriesBelong, categoryCodes, type TaxonomyDefinition } from "./taxonomy";

/**
 * What a model may propose, and the rules around proposing it.
 *
 * The product invariant this file serves: **rules calculate, AI proposes, a human validates, and
 * the system keeps all three.** An `AIClassification` is a *proposal*. It is never the validated
 * coding, it never overwrites the answer it read, and a human correction never overwrites it.
 */
export const CLASSIFICATION_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export const classificationRunStatusSchema = z.enum(CLASSIFICATION_RUN_STATUSES);
export type ClassificationRunStatus = z.infer<typeof classificationRunStatusSchema>;

export const CLASSIFICATION_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"] as const;
export const classificationStatusSchema = z.enum(CLASSIFICATION_STATUSES);
export type ClassificationStatus = z.infer<typeof classificationStatusSchema>;

/**
 * The structured output the classifier must return, and the only thing that is persisted.
 *
 * Note what is absent: no reasoning, no explanation, no rationale, no raw provider body. Asking a
 * model to narrate its thinking and then storing that narration creates a document that reads like
 * evidence and is not — and in a product that codes what people said about a road project, a
 * plausible-sounding machine rationale is exactly the artefact nobody should be able to quote.
 * The product needs the labels and a review-ordering hint; that is what it gets.
 */
export const classifierOutputSchema = z
  .object({
    /** One or more category codes from the taxonomy version the run was configured with. */
    categories: z.array(z.string()).min(1).max(8),
    /**
     * The model's own confidence, if it emits one. A **heuristic for ordering review**, not a
     * calibrated probability and not an accuracy: see `CONFIDENCE_SEMANTICS`.
     */
    confidence: z.number().min(0).max(1).nullable(),
    /** The model may ask for a human look even when it produced labels. */
    needsReview: z.boolean(),
  })
  .strict();
export type ClassifierOutput = z.infer<typeof classifierOutputSchema>;

/**
 * What a model score is and is not (design v0.2 invariant 10, AI_GOVERNANCE.md).
 *
 * Stated as data so the UI copy and the documentation cannot drift apart from each other.
 */
export const CONFIDENCE_SEMANTICS = {
  label: "Confianza del modelo",
  help:
    "Valor heurístico que el modelo reporta para priorizar la revisión. No es una probabilidad " +
    "calibrada, no es un porcentaje de acierto y no sustituye la validación de un especialista.",
  /** Below this, the queue offers the response for review first and the UI says why. */
  lowThreshold: 0.6,
} as const;

export function confidenceBand(confidence: number | null): "low" | "medium" | "high" | "unknown" {
  if (confidence === null) return "unknown";
  if (confidence < CONFIDENCE_SEMANTICS.lowThreshold) return "low";
  if (confidence < 0.8) return "medium";
  return "high";
}

/**
 * The one thing a classification call may read, assembled deliberately rather than by passing a
 * row through (§12, data minimisation).
 *
 * There is no respondent, no technician, no parcel code, no coordinate, no visit, no membership
 * and no other answer here — not because they are filtered out downstream, but because the type a
 * classifier accepts has nowhere to put them.
 */
export interface ClassificationInput {
  /** The open response, exactly as the person gave it. Untrusted data, never instructions. */
  readonly text: string;
  readonly taxonomy: TaxonomyDefinition;
}

export class AiProcessingNotAuthorized extends InvalidInput {
  override readonly name = "AiProcessingNotAuthorized";
  constructor(reason: string) {
    super(`ai_processing_not_authorized: ${reason}`);
  }
}

/**
 * The privacy gate, in the domain, where every path to a model must pass through it.
 *
 * Until the compliance review authorises real personal data (SECURITY.md §10a), the only answers
 * that may leave this system for an external model are **synthetic demonstration answers**. This
 * is a check on the *provenance of the data*, not on the user's role: a social specialist with
 * every permission still cannot send a `HISTORICAL_OBSERVED` or `LIVE_OPERATIONAL` answer, because
 * the question is not "may this person act" but "may this datum travel".
 *
 * Hiding the button is not the control. The use-case calls this, and the test asserts that the
 * classifier port was never invoked.
 */
export function assertAiProcessingAllowed(facets: ProvenanceFacets): void {
  if (!isDemo(facets)) {
    throw new AiProcessingNotAuthorized(
      `this answer's regime is ${facets.regime}; only DEMO_SIMULATION answers may be sent to an ` +
        `external model until the privacy and vendor review authorises real data`,
    );
  }
}

export class ClassifierOutputRejected extends InvalidInput {
  override readonly name = "ClassifierOutputRejected";
}

/**
 * Validate what came back, against the taxonomy version the run was configured with.
 *
 * Unknown category codes are a **failure**, never coerced to the residual category: a model that
 * invented `ADMIN` or answered in prose has not classified anything, and silently recording it as
 * `OTHER` would put a fabricated coding into the data with a real-looking provenance. `OTHER` is a
 * category a classifier may deliberately select; it is not a landing pad for garbage.
 *
 * This is also the last line of the prompt-injection defence: whatever a response text tries to
 * make the model say, the only outputs that survive are category codes of this exact version.
 */
export function validateClassifierOutput(
  taxonomy: TaxonomyDefinition,
  raw: unknown,
): ClassifierOutput {
  const parsed = classifierOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ClassifierOutputRejected(
      `the model's output did not match the required shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }

  const unique = [...new Set(parsed.data.categories)];
  try {
    assertCategoriesBelong(taxonomy, unique);
  } catch (error) {
    throw new ClassifierOutputRejected(
      `the model returned a category that is not in taxonomy version ${taxonomy.versionLabel}: ` +
        `${(error as Error).message}. Unknown categories are a failed classification, never OTHER.`,
    );
  }
  if (unique.length !== parsed.data.categories.length) {
    throw new ClassifierOutputRejected("the model repeated a category");
  }

  return { ...parsed.data, categories: unique };
}

/**
 * Which answers a run may include (§10).
 *
 * Only text answers, only from submitted responses, only non-empty, and only the question the run
 * was configured to code. The eligibility rule lives here so the read model, the use-case and the
 * tests all agree on what "eligible" means.
 */
export interface OpenResponseCandidate {
  readonly answerId: string;
  readonly instanceStatus: string;
  readonly questionId: string;
  readonly text: string | null;
}

export function isEligibleForClassification(
  candidate: OpenResponseCandidate,
  sourceQuestionId: string,
): boolean {
  return (
    candidate.instanceStatus === "SUBMITTED" &&
    candidate.questionId === sourceQuestionId &&
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0
  );
}

/**
 * The largest number of answers one run may send to a model, and why there is a number at all.
 *
 * Nothing else bounds it. A run codes every eligible answer of one question, so the cost of
 * pressing the button is the size of the project's field work — four responses in the pilot, and
 * some other number in a project nobody has run yet. A cap turns "this is expensive" from
 * something discovered on an invoice into something the product refuses to do silently.
 *
 * It is a **refusal, not a truncation**. Coding the first two hundred of a thousand answers and
 * saying nothing would leave a queue whose remainder nobody is waiting for, and a distribution
 * computed over a subset chosen by primary key. The caller is told the count and asked to say what
 * they meant — which is also how a deliberate small run (a live smoke over one or two answers) is
 * expressed: an explicit `limit`.
 */
export const MAX_ANSWERS_PER_CLASSIFICATION_RUN = 200;

export class ClassificationRunTooLarge extends InvalidInput {
  override readonly name = "ClassificationRunTooLarge";
}

/**
 * Which of the eligible answers this run actually sends, in the order they were read.
 *
 * Pure, so the refusal is decided in one place and testable without a database. The caller has
 * already ordered the candidates deterministically; taking a prefix therefore makes a limited run
 * reproducible rather than arbitrary.
 */
export function selectAnswersForRun<T>(
  eligible: ReadonlyArray<T>,
  limit: number | undefined,
): ReadonlyArray<T> {
  if (limit === undefined) {
    if (eligible.length > MAX_ANSWERS_PER_CLASSIFICATION_RUN) {
      throw new ClassificationRunTooLarge(
        `${eligible.length} eligible responses exceeds the ${MAX_ANSWERS_PER_CLASSIFICATION_RUN} ` +
          "a single run may send to a model. Say how many with an explicit limit; the run is not " +
          "truncated for you.",
      );
    }
    return eligible;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ANSWERS_PER_CLASSIFICATION_RUN) {
    throw new ClassificationRunTooLarge(
      `a run limit must be a whole number between 1 and ${MAX_ANSWERS_PER_CLASSIFICATION_RUN}`,
    );
  }
  return eligible.slice(0, limit);
}

/** Bounded retries, for transient provider and schema failures only (§23). */
export const MAX_CLASSIFICATION_ATTEMPTS = 3;

export function shouldRetry(attempts: number): boolean {
  return attempts < MAX_CLASSIFICATION_ATTEMPTS;
}

/** The categories a definition offers, for building the model's allowed set and the UI's chips. */
export function allowedCodes(taxonomy: TaxonomyDefinition): ReadonlyArray<string> {
  return [...categoryCodes(taxonomy)].sort();
}
