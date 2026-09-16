import { withDbContext, type Database } from "@eia/db";
import {
  type NarrativeUnavailableReason,
  answerFromPassages,
  ASSISTANT_PROMPT_VERSION,
  noEvidenceAnswer,
  passagesOnlyAnswer,
  requireCapability,
  requirePermission,
  retrievalQuerySchema,
  NotFound,
  type AssistantAnswer,
  type AssistantGenerator,
  type ClassifierAvailability,
  type RequestContext,
  type RetrievalStrategy,
} from "@eia/domain";

import { recordAudit } from "../audit/record";
import { FullTextRetriever } from "./retriever";

/**
 * Ask the project's documents a question.
 *
 * The shape of this use-case is the argument of ADR-021: **retrieval is the product, prose is the
 * garnish**. It retrieves, it builds citations, and only then — if a generator is configured — does
 * it ask for a paragraph. Every early return is a genuinely useful answer:
 *
 * - nothing retrieved → "no evidence found", citing nothing, which is the honest answer and not a
 *   failure state to apologise for;
 * - passages retrieved, no generator → the passages, cited, and the reason there is no narrative;
 * - passages and a generator → a paragraph that may cite only what was retrieved.
 *
 * Nothing is persisted. An answer is a read, not a claim the project now holds: storing generated
 * prose as project content is what AI_GOVERNANCE.md §8 forbids without a provenance record marking
 * it derived and pending, and this slice has no surface that would show such a record honestly.
 */
export interface AssistantAsk {
  readonly question: string;
  readonly limit?: number;
  readonly documentId?: string;
}

export interface AssistantResponse extends AssistantAnswer {
  /** The reader's surface turns this into words; this layer renders nothing (ADR-029). */
  readonly strategy: RetrievalStrategy;
  /** The model that wrote the narrative, when one did. */
  readonly model: string | null;
  readonly promptVersion: string | null;
}

export interface AssistantConfig {
  /** Resolved once at the boundary (IG4-001): whether a narrative generator may run at all. */
  readonly generator: ClassifierAvailability;
  /** Built only when the availability says so; never constructed to be left unused. */
  readonly create?: () => AssistantGenerator;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

export async function askDocuments(
  db: Database,
  ctx: RequestContext,
  ask: AssistantAsk,
  config: AssistantConfig,
): Promise<AssistantResponse> {
  requireCapability(ctx, "quality.rag_assistant");
  requirePermission(ctx, "documents.read");
  const projectId = requireProject(ctx);
  const query = retrievalQuerySchema.parse({
    question: ask.question,
    ...(ask.limit === undefined ? {} : { limit: ask.limit }),
    ...(ask.documentId === undefined ? {} : { documentId: ask.documentId }),
  });

  return withDbContext(db, ctx, async (tx) => {
    const retriever = new FullTextRetriever(tx, { tenantId: ctx.tenantId, projectId });
    const result = await retriever.retrieve(query);

    // The question is audited; the passages are not. What was asked of a project's documents is an
    // operational fact worth keeping; copying the document text into the audit log would put the
    // same words in a second place with a different retention rule.
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "documents.assistant.asked",
        objectKind: "project",
        objectId: projectId,
        details: {
          strategy: result.strategy,
          passages: result.passages.length,
          generator: config.generator.state === "AVAILABLE" ? config.generator.kind : "unavailable",
        },
      },
    );

    const base = {
      strategy: result.strategy,
    };

    if (result.passages.length === 0) {
      return { ...noEvidenceAnswer(query.question), ...base, model: null, promptVersion: null };
    }

    if (config.generator.state !== "AVAILABLE" || !config.create) {
      const reason =
        config.generator.state === "AVAILABLE"
          ? "generator_unavailable"
          : narrativeReason(config.generator.reason);
      return {
        ...passagesOnlyAnswer(query.question, result.passages, reason),
        ...base,
        model: null,
        promptVersion: null,
      };
    }

    const generator = config.create();
    const raw = await generator.generate({
      question: query.question,
      passages: result.passages,
      model: config.generator.model,
    });
    return {
      ...answerFromPassages(query.question, result.passages, raw),
      ...base,
      model: config.generator.model,
      promptVersion: ASSISTANT_PROMPT_VERSION,
    };
  });
}

/** The three reasons of IG4-001, as codes the reader's surface puts into words. */
function narrativeReason(reason: string): NarrativeUnavailableReason {
  switch (reason) {
    case "NOT_CONFIGURED":
      return "not_configured";
    case "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT":
      return "fake_refused";
    default:
      return "blocked_external_config";
  }
}
