import {
  claimNextDocumentReview,
  processDocumentReview,
  releaseStaleDocumentReviews,
} from "@eia/application";
import type { Database } from "@eia/db";
import type { DocumentReviewer } from "@eia/domain";

import type { WorkerLogger } from "./process";

/**
 * The loop that turns a review request into candidates a specialist reads (ADR-035).
 *
 * Third consumer, same shape as the other two, and the same three properties:
 *
 * - the queue is the `document_review_run` table claimed with `FOR UPDATE SKIP LOCKED`, so there is
 *   no broker and two workers against one database never claim the same run;
 * - everything after the claim runs under the **initiator's** RLS context, so this process needs no
 *   privilege beyond `eia_app`, and a revoked membership makes the job fail safely;
 * - **a worker with no usable reviewer never claims.** Claiming and then failing at the model call
 *   would drain the queue and mark every request `FAILED` over a missing environment variable.
 *
 * What it logs is identifiers and counts. A passage never reaches a log line, and neither does a
 * candidate's text: the words live in one table with one retention rule, and a copy in a log
 * aggregator is a second one nobody governs.
 */
export interface ReviewConsumerOptions {
  readonly db: Database;
  readonly reviewer: DocumentReviewer;
  /** Recorded on the run at enqueue; passed through so the call asks for what the row claims. */
  readonly model: string;
  readonly logger: WorkerLogger;
  readonly idleDelayMs?: number;
  readonly staleAfter?: string;
  readonly maxAttempts?: number;
}

export class ReviewConsumer {
  private running = false;
  private stopped: Promise<void> | null = null;

  constructor(private readonly options: ReviewConsumerOptions) {}

  /** Claim and process at most `max` runs; returns how many were handled. */
  async drainOnce(max = 5): Promise<number> {
    let handled = 0;
    while (handled < max) {
      const claim = await claimNextDocumentReview(this.options.db, this.options.maxAttempts ?? 3);
      if (!claim) break;
      try {
        const outcome = await processDocumentReview(
          this.options.db,
          claim,
          this.options.reviewer,
          this.options.model,
        );
        this.options.logger.info(
          {
            run: outcome.runId,
            status: outcome.status,
            passages: outcome.passageCount,
            candidates: outcome.candidatesCreated,
            refused: outcome.candidatesRefused,
            ...(outcome.emptyReason ? { empty: outcome.emptyReason } : {}),
          },
          "document review processed",
        );
      } catch (error) {
        // The run stays in PROCESSING and the stale-release returns it to the queue. The attempt
        // counter is what eventually stops a crash loop.
        this.options.logger.error(
          {
            run: claim.runId,
            error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
          },
          "document review failed outside the job transaction",
        );
      }
      handled += 1;
    }
    return handled;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stopped;
  }

  private async loop(): Promise<void> {
    const idle = this.options.idleDelayMs ?? 5_000;
    while (this.running) {
      try {
        const released = await releaseStaleDocumentReviews(
          this.options.db,
          this.options.staleAfter ?? "15 minutes",
        );
        if (released > 0) {
          this.options.logger.warn({ released }, "stale document reviews returned to the queue");
        }
        const handled = await this.drainOnce();
        if (handled === 0) await delay(idle);
      } catch (error) {
        this.options.logger.error(
          { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
          "review consumer loop error",
        );
        await delay(idle);
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
