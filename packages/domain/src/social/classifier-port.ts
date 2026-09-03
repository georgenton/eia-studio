import type { ClassificationInput, ClassifierOutput } from "./classification";

/**
 * The only way this product talks to a language model.
 *
 * One method, one task: given one open response and one immutable taxonomy definition, return the
 * category codes it belongs to. There are no tools, no retrieval, no message history, no browsing,
 * no filesystem and no database on the other side of this boundary — a classifier that could do
 * any of those would be a different kind of component with a different threat model, and this
 * slice does not need one.
 *
 * The port lives in the domain so that use-cases depend on the *task*, not on a vendor. Tests pass
 * a deterministic fake; the live adapter (application layer) uses the AI SDK through the Vercel AI
 * Gateway. Neither is visible from here, which is the point: swapping the provider must not change
 * a single domain test.
 */
export interface OpenTextClassifier {
  /**
   * Classify one response. Implementations either return validated structured output or throw;
   * they never invent a classification, and they never substitute a placeholder on failure.
   */
  classify(input: ClassificationInput, options: ClassifierCallOptions): Promise<ClassifierResult>;
  /** Identifies the implementation in a run record: `fake`, `ai-gateway`, … */
  readonly kind: string;
}

export interface ClassifierCallOptions {
  /** The model the run was configured with, e.g. `anthropic/claude-sonnet-4.5`. */
  readonly model: string;
  /** Identifies the prompt text used, recorded on the run for auditability. */
  readonly promptVersion: string;
  readonly abortSignal?: AbortSignal;
}

/**
 * What the adapter reports back: the validated proposal, plus the metadata a later evaluation
 * needs — which model actually answered, how long it took, what it cost in tokens.
 *
 * `modelId` is the model the *provider says it used*, which is not always the model that was
 * requested (a gateway may resolve an alias). Both are recorded, because an evaluation that
 * assumed the requested one would be reporting a model it never ran.
 */
export interface ClassifierResult {
  readonly output: ClassifierOutput;
  readonly modelId: string | null;
  readonly provider: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly latencyMs: number;
}

/**
 * A classifier failure that is worth another attempt (a timeout, a 5xx, a malformed structure)
 * as opposed to one that is not (an unauthorised key, an unknown model). The adapter decides;
 * the worker only reads `retryable`.
 */
export class ClassifierUnavailable extends Error {
  override readonly name = "ClassifierUnavailable";
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
