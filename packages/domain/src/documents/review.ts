import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { assertPermittedFindingLanguage } from "../quality/requirements";
import { resolveCitedIndices, type RetrievedPassage } from "./retrieval";

/**
 * AI document review: a model reads the project's own passages and **proposes** things a
 * specialist might want to check (ADR-035).
 *
 * The product rule this file exists to hold:
 *
 * > **Rules calculate. AI proposes. A human validates. The system preserves all three.**
 *
 * The Quality Gate calculates. Five deterministic rules compare two values and say they disagree;
 * the comparison is reproducible by hand, and a finding names the rule and its version. **Nothing
 * in this file is that.** A candidate here is a suggestion from a language model, produced from
 * passages it was handed, and it is stored in its own tables, rendered in its own words, and can
 * never become a `quality_finding` — because a `quality_finding` carries a `requirement_key`, and
 * minting one for a model's suggestion would make a rule appear to have detected something no rule
 * ran (ADR-035 §3).
 *
 * ## What the model is allowed to be
 *
 * It may **retrieve** (the retriever does that, before the model is asked anything), **compare**,
 * **classify**, **suggest** and **draft**. It is not an environmental auditor, a compliance
 * authority, a legal reviewer, or a source of project facts. The three mechanisms that make that
 * more than a sentence:
 *
 * | Rule | Mechanism |
 * |---|---|
 * | No passage, no claim | a lens retrieves first; with nothing retrieved the model is never called |
 * | No citation, no candidate | every candidate names passage indices, resolved against the set that was actually retrieved. An index that was not retrieved fails the candidate — it is never dropped, because dropping it leaves the observation standing and looking sourced |
 * | No compliance conclusion | `assertPermittedFindingLanguage` runs over every field of every candidate, with the same forbidden vocabulary invariant 11 already imposes on the rule catalogue |
 *
 * ## Two sides, or it stays a suggestion
 *
 * A finding in this product is a **disagreement between two named sources**; that is what
 * `finding_evidence` enforces with exactly one `SOURCE_A` and one `SOURCE_B`. A candidate that
 * names only one passage has not shown a disagreement — it has made an assertion, and a model is
 * not entitled to one. Such a candidate is kept, shown and dismissible, and **cannot be accepted**:
 * `decideCandidate` refuses it, and the surface says why.
 */
export const DOCUMENT_REVIEW_PROMPT_VERSION = "document-review@1";

/**
 * The bounded set of things a review may look for.
 *
 * Bounded rather than free-form because "review this study" is not a task with an answer: it is an
 * invitation to produce plausible text of unbounded scope, which is exactly what a model is best at
 * and what this product must not publish. A lens names one comparison, carries the search probes
 * that find the passages for it, and is the candidate's whole classification — there is no second
 * taxonomy for a model to choose badly from.
 *
 * `probes` are full-text queries against the project's own corpus, in the language studies here are
 * written in. They are **not** prompts: they decide which passages exist to be compared, and they
 * run whether or not a model is available.
 *
 * They are deliberately **short**. `websearch_to_tsquery` ANDs every term, so a probe written as a
 * sentence — *"número de predios afectados en total"* — matches only a passage carrying all five
 * stems, which almost none do. Two or three words per probe and several probes per lens is what
 * actually retrieves; the results are merged and de-duplicated before the model sees them.
 */
export const REVIEW_LENSES = [
  {
    key: "numerical_consistency",
    version: "1",
    probes: [
      "predios afectados",
      "superficie hectáreas",
      "fichas aplicadas",
      "participantes asamblea",
      "total registrado",
    ],
  },
  {
    key: "dates_chronology",
    version: "1",
    probes: ["fecha levantamiento", "cronograma", "fecha asamblea", "período ejecución", "plazo"],
  },
  {
    key: "project_identity",
    version: "1",
    probes: ["nombre proyecto", "código contrato", "promotor", "objeto estudio", "alcance"],
  },
  {
    key: "locations_institutions",
    version: "1",
    probes: [
      "cantón parroquia",
      "provincia",
      "gobierno autónomo",
      "competencia",
      "área influencia",
    ],
  },
  {
    key: "social_conclusions_support",
    version: "1",
    probes: [
      "conclusiones sociales",
      "vulnerabilidad",
      "percepción población",
      "recomendaciones",
      "línea base",
    ],
  },
  {
    key: "management_plan_application_area",
    version: "1",
    probes: [
      "lugar aplicación",
      "medida responsable",
      "frecuencia seguimiento",
      "programa manejo",
      "plan manejo",
    ],
  },
  {
    key: "general_cross_document",
    version: "1",
    probes: ["informe social", "anexo", "plan manejo", "metodología", "línea base"],
  },
] as const;

export type ReviewLensKey = (typeof REVIEW_LENSES)[number]["key"];
export const REVIEW_LENS_KEYS: ReadonlyArray<ReviewLensKey> = REVIEW_LENSES.map((lens) => lens.key);

/* A lens's words are `documents.reviewLens.*` in `@eia/i18n` (ADR-029). The key is the claim. */

export function lensFor(key: string): (typeof REVIEW_LENSES)[number] {
  const lens = REVIEW_LENSES.find((candidate) => candidate.key === key);
  if (!lens) throw new InvalidInput(`no review lens named ${key}`);
  return lens;
}

/** `numerical_consistency@1` — recorded on the run, so a candidate's origin stays legible. */
export function lensRef(key: ReviewLensKey): string {
  return `${key}@${lensFor(key).version}`;
}

/**
 * What a review run may do next.
 *
 * The same four states the extraction queue uses, for the same reason: a run that a worker could
 * never process must not exist, and a run that failed must be askable again. `COMPLETED` is
 * terminal — a second opinion is a second run, and both are kept.
 */
export const REVIEW_RUN_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type ReviewRunStatus = (typeof REVIEW_RUN_STATUSES)[number];

const RUN_TRANSITIONS: Readonly<Record<ReviewRunStatus, ReadonlyArray<ReviewRunStatus>>> = {
  QUEUED: ["PROCESSING"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
};

export function assertRunTransition(from: ReviewRunStatus, to: ReviewRunStatus): void {
  if (!RUN_TRANSITIONS[from].includes(to)) {
    throw new InvalidInput(`a document review run cannot go from ${from} to ${to}`);
  }
}

/**
 * Why a run produced nothing, when it produced nothing.
 *
 * A completed run with no candidates is a result, not a failure, and the surface says which of
 * these it was. "The model found nothing" and "there was nothing to look at" are different answers
 * and a reader who cannot tell them apart learns nothing from either.
 */
export const REVIEW_EMPTY_REASONS = ["NO_PASSAGES", "NO_CANDIDATES"] as const;
export type ReviewEmptyReason = (typeof REVIEW_EMPTY_REASONS)[number];

/**
 * A candidate's lifecycle. Three states, and no `RESOLVED`.
 *
 * The Quality Gate distinguishes *accepted* from *resolved* because a finding is about an artefact
 * somebody can go and correct. A candidate is about **whether there is something to look at**: a
 * specialist accepts it (yes, worth carrying into the deliverable review) or dismisses it (no).
 * What happens to the document afterwards is the Quality Gate's business, and pretending this
 * table tracks it would be a claim nothing here can support.
 */
export const REVIEW_CANDIDATE_STATES = ["PROPOSED", "ACCEPTED", "DISMISSED"] as const;
export type ReviewCandidateState = (typeof REVIEW_CANDIDATE_STATES)[number];

export const REVIEW_CANDIDATE_DECISIONS = ["ACCEPT", "DISMISS", "REOPEN"] as const;
export type ReviewCandidateDecision = (typeof REVIEW_CANDIDATE_DECISIONS)[number];

const CANDIDATE_TRANSITIONS: Readonly<
  Record<
    ReviewCandidateDecision,
    { from: ReadonlyArray<ReviewCandidateState>; to: ReviewCandidateState }
  >
> = {
  ACCEPT: { from: ["PROPOSED"], to: "ACCEPTED" },
  DISMISS: { from: ["PROPOSED"], to: "DISMISSED" },
  REOPEN: { from: ["ACCEPTED", "DISMISSED"], to: "PROPOSED" },
};

/** What the evidence shows: a disagreement between two sources, or a single-source assertion. */
export const REVIEW_SUPPORT_KINDS = ["TWO_SIDED", "SINGLE_SOURCE"] as const;
export type ReviewSupportKind = (typeof REVIEW_SUPPORT_KINDS)[number];

export const REVIEW_EVIDENCE_ROLES = ["SOURCE_A", "SOURCE_B", "CONTEXT"] as const;
export type ReviewEvidenceRole = (typeof REVIEW_EVIDENCE_ROLES)[number];

/**
 * What the model must return, and everything it may not.
 *
 * `strict()`, closed indices, bounded lengths. The shape is small on purpose: a candidate is a
 * **title**, an **observation** of what two passages say, a **check a person might run**, and the
 * passages it rests on. There is nowhere in it to put a verdict, a severity the model decided, a
 * confidence it cannot calibrate, or a sentence about the law.
 *
 * There is deliberately **no confidence score**. Slice 4 records one because a classifier returns a
 * likelihood over a closed taxonomy and the surface labels it High/Medium/Low with a warning that
 * it is uncalibrated. A number attached to "these two paragraphs might not agree" would have no
 * such referent: it would be a model's opinion of its own prose, and ordering a specialist's queue
 * by it would be worse than ordering it by nothing.
 */
export const MIN_CANDIDATE_TEXT = 12;
export const MAX_CANDIDATE_TITLE = 160;
export const MAX_CANDIDATE_TEXT = 1200;
export const MAX_CANDIDATES_PER_RUN = 12;

export const reviewCandidateOutputSchema = z
  .object({
    title: z.string().trim().min(MIN_CANDIDATE_TEXT).max(MAX_CANDIDATE_TITLE),
    /** What the passages say, in the model's words, without saying which one is right. */
    observation: z.string().trim().min(MIN_CANDIDATE_TEXT).max(MAX_CANDIDATE_TEXT),
    /** What a specialist could do to settle it. A suggestion, never an instruction to the system. */
    suggestedCheck: z.string().trim().min(MIN_CANDIDATE_TEXT).max(MAX_CANDIDATE_TEXT),
    sourceA: z.number().int().min(0),
    /** Null when the candidate rests on one passage. It then cannot be accepted. */
    sourceB: z.number().int().min(0).nullable(),
    context: z.array(z.number().int().min(0)).max(4).default([]),
  })
  .strict();
export type ReviewCandidateOutput = z.infer<typeof reviewCandidateOutputSchema>;

export const reviewOutputSchema = z
  .object({ candidates: z.array(reviewCandidateOutputSchema).max(MAX_CANDIDATES_PER_RUN) })
  .strict();
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

export interface DocumentReviewer {
  readonly kind: string;
  review(input: {
    readonly lens: ReviewLensKey;
    readonly passages: ReadonlyArray<RetrievedPassage>;
    readonly model: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<ReviewOutput>;
}

/** One candidate, grounded: every index resolved to a passage that was actually retrieved. */
export interface GroundedCandidate {
  readonly title: string;
  readonly observation: string;
  readonly suggestedCheck: string;
  readonly support: ReviewSupportKind;
  readonly evidence: ReadonlyArray<{
    readonly role: ReviewEvidenceRole;
    readonly passage: RetrievedPassage;
  }>;
}

/**
 * Turn one raw candidate into a grounded one, or refuse it.
 *
 * Refusal is per candidate rather than per run: a model that produced three good suggestions and
 * one that cites a passage it never saw should not cost the specialist the other three. The
 * refusal is recorded on the run as a count, so *how often* this happens is visible rather than
 * silently absorbed.
 */
export function groundCandidate(
  raw: unknown,
  passages: ReadonlyArray<RetrievedPassage>,
): GroundedCandidate {
  const parsed = reviewCandidateOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidInput(
      `the reviewer returned a candidate the schema refuses: ${parsed.error.issues
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", ")}`,
    );
  }
  const candidate = parsed.data;

  for (const [field, text] of [
    ["title", candidate.title],
    ["observation", candidate.observation],
    ["suggestedCheck", candidate.suggestedCheck],
  ] as const) {
    assertPermittedFindingLanguage(text, `an AI review candidate's ${field}`);
  }

  if (candidate.sourceB !== null && candidate.sourceB === candidate.sourceA) {
    throw new InvalidInput(
      "a candidate's two sources are the same passage, which is not a disagreement between two " +
        "sources but one passage cited twice",
    );
  }

  // The same resolution the assistant's citations take: an index that was not retrieved fails the
  // candidate rather than being dropped.
  const indices = [candidate.sourceA, ...(candidate.sourceB === null ? [] : [candidate.sourceB])];
  resolveCitedIndices(indices, passages);

  const evidence: Array<{ role: ReviewEvidenceRole; passage: RetrievedPassage }> = [
    { role: "SOURCE_A", passage: passages[candidate.sourceA]! },
  ];
  if (candidate.sourceB !== null) {
    evidence.push({ role: "SOURCE_B", passage: passages[candidate.sourceB]! });
  }
  for (const index of candidate.context) {
    const passage = passages[index];
    if (!passage) {
      throw new InvalidInput(`a candidate cited context passage ${index}, which was not retrieved`);
    }
    if (index === candidate.sourceA || index === candidate.sourceB) continue;
    evidence.push({ role: "CONTEXT", passage });
  }

  return {
    title: candidate.title,
    observation: candidate.observation,
    suggestedCheck: candidate.suggestedCheck,
    support: candidate.sourceB === null ? "SINGLE_SOURCE" : "TWO_SIDED",
    evidence,
  };
}

export const MIN_REVIEW_JUSTIFICATION = 12;
export const MAX_REVIEW_JUSTIFICATION = 2000;

export const documentReviewDecisionSchema = z
  .object({
    decision: z.enum(REVIEW_CANDIDATE_DECISIONS),
    justification: z.string().trim().min(MIN_REVIEW_JUSTIFICATION).max(MAX_REVIEW_JUSTIFICATION),
  })
  .strict();
export type DocumentReviewDecisionSubmission = z.infer<typeof documentReviewDecisionSchema>;

export interface DecidedCandidateTransition {
  readonly decision: ReviewCandidateDecision;
  readonly fromState: ReviewCandidateState;
  readonly toState: ReviewCandidateState;
  readonly justification: string;
}

/**
 * Apply a specialist's decision, or refuse it.
 *
 * Three refusals, and the second is the one that matters. A transition nobody defined is refused,
 * as everywhere else. And **a single-source candidate cannot be accepted**: accepting means *this
 * is a real disagreement worth carrying forward*, and a candidate resting on one passage has not
 * shown a disagreement. It can be dismissed, and it stays readable either way.
 */
export function decideCandidate(
  current: ReviewCandidateState,
  support: ReviewSupportKind,
  raw: DocumentReviewDecisionSubmission,
): DecidedCandidateTransition {
  // Validated here rather than only at the boundary: the mandatory justification is a rule about
  // the record, and a rule that only holds when somebody remembered to parse first is not one.
  const submission = documentReviewDecisionSchema.parse(raw);
  const transition = CANDIDATE_TRANSITIONS[submission.decision];
  if (!transition.from.includes(current)) {
    throw new InvalidInput(
      `a candidate in ${current} cannot be ${submission.decision.toLowerCase()}ed`,
    );
  }
  if (submission.decision === "ACCEPT" && support === "SINGLE_SOURCE") {
    throw new InvalidInput(
      "a candidate resting on a single passage cannot be accepted: acceptance means a " +
        "disagreement between two named sources, and one passage does not show one. Dismiss it, " +
        "or run a lens that finds the other side.",
    );
  }
  return {
    decision: submission.decision,
    fromState: current,
    toState: transition.to,
    justification: submission.justification,
  };
}

/**
 * The privacy gate: which document versions may be read by a model at all.
 *
 * `privacy_classification` is a **claim somebody made**, and `REVIEW_REQUIRED` — the default for
 * every uploaded file — means nobody has looked. Only `NO_PERSONAL_DATA_KNOWN` is AI-eligible, and
 * a version that is anything else stops the run.
 *
 * ## The run is refused, never filtered
 *
 * The tempting implementation is to drop the ineligible documents and review the rest. It is the
 * wrong one, and dangerously so: the specialist asked for *this corpus* to be looked at, and would
 * be shown a result that silently covered less than they chose. "No candidates in the social
 * chapter" would then mean "the social chapter was never read", and nothing on screen would say
 * so. So a mixed selection is **REFUSED entirely**, and the refusal names every document that
 * blocked it, so the person can decide what to do about each one.
 */
export interface ReviewableSource {
  readonly documentVersionId: string;
  readonly documentCode: string;
  readonly privacyClassification: string;
  readonly containsPii: boolean;
  readonly processingState: string;
}

export const AI_ELIGIBLE_PRIVACY_CLASSIFICATION = "NO_PERSONAL_DATA_KNOWN";

export interface BlockedSource {
  readonly documentVersionId: string;
  readonly documentCode: string;
  readonly reason: "PRIVACY_NOT_AI_SAFE" | "CONTAINS_PII" | "NOT_READABLE";
}

export class ReviewCorpusRefused extends InvalidInput {
  constructor(readonly blocked: ReadonlyArray<BlockedSource>) {
    super(
      "this review was refused because the selected corpus includes documents that may not be " +
        `read by a model: ${blocked.map((item) => item.documentCode).join(", ")}. The whole run ` +
        "is refused rather than quietly reviewing the rest, which would report on less than was " +
        "asked for and say nothing about it.",
    );
    this.name = "ReviewCorpusRefused";
  }
}

export function blockedSources(
  sources: ReadonlyArray<ReviewableSource>,
): ReadonlyArray<BlockedSource> {
  const blocked: BlockedSource[] = [];
  for (const source of sources) {
    if (source.containsPii) {
      blocked.push({
        documentVersionId: source.documentVersionId,
        documentCode: source.documentCode,
        reason: "CONTAINS_PII",
      });
      continue;
    }
    if (source.privacyClassification !== AI_ELIGIBLE_PRIVACY_CLASSIFICATION) {
      blocked.push({
        documentVersionId: source.documentVersionId,
        documentCode: source.documentCode,
        reason: "PRIVACY_NOT_AI_SAFE",
      });
      continue;
    }
    if (source.processingState !== "READY") {
      // Not a privacy refusal: a version with no chunks has nothing to retrieve, and a run over it
      // would report "no candidates" about a document nobody has read.
      blocked.push({
        documentVersionId: source.documentVersionId,
        documentCode: source.documentCode,
        reason: "NOT_READABLE",
      });
    }
  }
  return blocked;
}

/** Throws `ReviewCorpusRefused` naming every blocking document, or returns. */
export function assertReviewableCorpus(sources: ReadonlyArray<ReviewableSource>): void {
  if (sources.length === 0) {
    throw new InvalidInput("a review needs at least one document version to read");
  }
  const blocked = blockedSources(sources);
  if (blocked.length > 0) throw new ReviewCorpusRefused(blocked);
}
