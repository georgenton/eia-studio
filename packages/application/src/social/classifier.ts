/**
 * Adapters for the one classification port, and the rule about which one runs.
 *
 * Selection is explicit configuration (`SOCIAL_CLASSIFIER=fake|ai-gateway`), never a fallback. A
 * production-like environment whose provider is misconfigured must **fail**, not quietly produce
 * fabricated codings that look exactly like real ones in the database. That is why there is no
 * "try live, fall back to fake" path anywhere in this file.
 */

import {
  ClassifierUnavailable,
  requireAvailableClassifier,
  validateClassifierOutput,
  type ClassificationInput,
  type ClassifierAvailability,
  type ClassifierCallOptions,
  type ClassifierResult,
  type OpenTextClassifier,
} from "@eia/domain";

import { PROMPT_VERSION, renderSystemPrompt, renderUserPrompt } from "./prompt";

/**
 * The deterministic classifier used by every test and by CI, which makes zero network calls.
 *
 * It is a keyword matcher over the taxonomy's own labels plus a small scenario table, so a test
 * can ask for a low-confidence proposal, a multi-label proposal, a provider failure or a malformed
 * output without a model and without flakiness.
 */
export interface FakeScenario {
  readonly categories?: ReadonlyArray<string>;
  readonly confidence?: number | null;
  readonly needsReview?: boolean;
  /** Fail the call: `retryable` decides whether the worker will try again. */
  readonly failWith?: { readonly message: string; readonly retryable: boolean };
  /** Return something the output schema must reject, to exercise validation. */
  readonly malformed?: unknown;
}

export class FakeClassifier implements OpenTextClassifier {
  readonly kind = "fake";
  /** Scenario keyed by a substring of the response text; the first match wins. */
  constructor(private readonly scenarios: ReadonlyArray<[string, FakeScenario]> = []) {}

  async classify(
    input: ClassificationInput,
    options: ClassifierCallOptions,
  ): Promise<ClassifierResult> {
    const started = Date.now();
    const scenario = this.scenarios.find(([needle]) =>
      input.text.toLowerCase().includes(needle.toLowerCase()),
    )?.[1];

    if (scenario?.failWith) {
      throw new ClassifierUnavailable(scenario.failWith.message, scenario.failWith.retryable);
    }

    const raw =
      scenario?.malformed !== undefined
        ? scenario.malformed
        : {
            categories: scenario?.categories ?? this.match(input),
            confidence: scenario?.confidence ?? 0.82,
            needsReview: scenario?.needsReview ?? false,
          };

    // The fake validates through the same function the live adapter uses, so a test that asserts a
    // malformed output is rejected is asserting the real validation path.
    const output = validateClassifierOutput(input.taxonomy, raw);
    return {
      output,
      modelId: `fake:${options.model}`,
      provider: "fake",
      inputTokens: Math.ceil(input.text.length / 4),
      outputTokens: output.categories.length * 4,
      totalTokens: Math.ceil(input.text.length / 4) + output.categories.length * 4,
      latencyMs: Math.max(1, Date.now() - started),
    };
  }

  /** Deterministic keyword match against the categories' own labels, else the residual one. */
  private match(input: ClassificationInput): ReadonlyArray<string> {
    const text = input.text.toLowerCase();
    const hits = input.taxonomy.categories
      .filter((category) =>
        category.label
          .toLowerCase()
          .split(/[\s,/·]+/)
          .filter((word) => word.length > 4)
          .some((word) => text.includes(word)),
      )
      .map((category) => category.code);
    return hits.length > 0 ? hits.slice(0, 3) : ["OTHER"];
  }
}

/**
 * The live adapter: AI SDK v7 through the Vercel AI Gateway.
 *
 * Verified against the installed package's own documentation (`node_modules/ai/docs`, ai@7.0.91),
 * not from memory:
 *
 * - the gateway is the SDK's default global provider, so a plain `"provider/model"` string
 *   resolves through it, authenticated by `AI_GATEWAY_API_KEY`
 *   (`docs/02-getting-started/00-choosing-a-provider.mdx`);
 * - structured output is `generateText` with `output: Output.object({ schema })`, and the result
 *   carries `output` (`docs/03-ai-sdk-core/10-generating-structured-data.mdx`);
 * - `result.usage` exposes `inputTokens`/`outputTokens`/`totalTokens`, and `result.response.modelId`
 *   is the model the provider says answered (`dist/index.d.ts`).
 *
 * The import is dynamic so that `@eia/application` can be loaded — by tests, by the web app, by
 * the seeder — without the AI SDK being initialised or a key being required.
 */
export class AiGatewayClassifier implements OpenTextClassifier {
  readonly kind = "ai-gateway";

  async classify(
    input: ClassificationInput,
    options: ClassifierCallOptions,
  ): Promise<ClassifierResult> {
    const { generateText, Output } = await import("ai");
    const { z } = await import("zod");

    // The schema the model must satisfy. Category codes are constrained to this taxonomy version,
    // so an invented code cannot survive even before `validateClassifierOutput` re-checks it.
    const codes = input.taxonomy.categories.map((c) => c.code);
    const schema = z.object({
      categories: z
        .array(z.enum(codes as [string, ...string[]]))
        .min(1)
        .max(8),
      confidence: z.number().min(0).max(1).nullable(),
      needsReview: z.boolean(),
    });

    const started = Date.now();
    try {
      const result = await generateText({
        model: options.model,
        system: renderSystemPrompt(input.taxonomy),
        prompt: renderUserPrompt(input.text),
        output: Output.object({ schema }),
        // Bounded at the port; the worker owns the retry policy across attempts.
        maxRetries: 1,
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      });

      const output = validateClassifierOutput(input.taxonomy, result.output);
      return {
        output,
        modelId: result.response?.modelId ?? null,
        provider: "vercel-ai-gateway",
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        totalTokens: result.usage?.totalTokens ?? null,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof ClassifierUnavailable) throw error;
      throw new ClassifierUnavailable(
        `the classification provider failed: ${(error as Error).message}`,
        isRetryable(error),
      );
    }
  }
}

/**
 * Which failures are worth another attempt. A rate limit, a timeout or a 5xx is transient; a bad
 * key or an unknown model is a configuration error that retrying only repeats.
 */
function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error);
  if (/unauthor|forbidden|api key|no such model|not found|invalid model/.test(message))
    return false;
  return /timeout|timed out|rate limit|429|5\d\d|econnreset|network|overloaded|unavailable/.test(
    message,
  );
}

/**
 * Build the classifier an already-resolved availability names.
 *
 * Availability is decided once, in the domain, from `APP_ENV` and the two variables
 * (`resolveClassifierAvailability`). This function only obeys it — which is why there is no
 * fallback path here to read: an unavailable classifier throws `AiUnavailable` before any adapter
 * is constructed, because inventing codings is worse than stopping.
 */
export function createClassifier(availability: ClassifierAvailability): OpenTextClassifier {
  const usable = requireAvailableClassifier(availability);
  return usable.kind === "fake" ? new FakeClassifier() : new AiGatewayClassifier();
}

export { PROMPT_VERSION };
