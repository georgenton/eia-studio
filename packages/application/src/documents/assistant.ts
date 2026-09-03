import { withDbContext, type Database } from "@eia/db";
import {
  answerFromPassages,
  ASSISTANT_PROMPT_VERSION,
  noEvidenceAnswer,
  passagesOnlyAnswer,
  requireCapability,
  requirePermission,
  retrievalQuerySchema,
  RETRIEVAL_SEMANTICS,
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
  readonly strategy: RetrievalStrategy;
  readonly strategyLabel: string;
  readonly strategyHelp: string;
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
    const semantics = RETRIEVAL_SEMANTICS[result.strategy];

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
      strategyLabel: semantics.label,
      strategyHelp: semantics.help,
    };

    if (result.passages.length === 0) {
      return { ...noEvidenceAnswer(query.question), ...base, model: null, promptVersion: null };
    }

    if (config.generator.state !== "AVAILABLE" || !config.create) {
      const reason =
        config.generator.state === "AVAILABLE"
          ? "El generador de texto no está disponible en este entorno."
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

/** The three reasons of IG4-001, said in the reader's language rather than the operator's. */
function narrativeReason(reason: string): string {
  switch (reason) {
    case "NOT_CONFIGURED":
      return (
        "La redacción asistida no está configurada en este entorno, así que no se genera un " +
        "párrafo. Los pasajes citados son la evidencia y se muestran completos."
      );
    case "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT":
      return (
        "Este entorno tiene configurado el generador determinista de pruebas, que no puede " +
        "ejecutarse aquí: su texto sería indistinguible del de un modelo real. Los pasajes " +
        "citados son la evidencia y se muestran completos."
      );
    default:
      return (
        "El proveedor de modelos no está disponible: falta configuración externa. No se sustituye " +
        "por un generador simulado. Los pasajes citados son la evidencia y se muestran completos."
      );
  }
}
