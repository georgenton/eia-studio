import {
  claimNextExtraction,
  processDocumentExtraction,
  releaseStaleExtractions,
} from "@eia/application";
import type { Database } from "@eia/db";
import type { StoragePort } from "@eia/domain";

import type { WorkerLogger } from "./process";

/**
 * The loop that turns uploaded files into passages (ADR-033).
 *
 * The same shape as the classification consumer, and for the same reasons: the queue is the
 * `document_version` table claimed with `FOR UPDATE SKIP LOCKED`, so there is no broker and no
 * second store that can disagree with the database about what work exists, and two workers against
 * one database never claim the same version.
 *
 * Everything after the claim runs under the **uploader's** RLS context, so this process needs no
 * privilege beyond `eia_app`. If their project access was revoked between the upload and now, that
 * transaction sees nothing and the job fails safely rather than reading a file they may no longer
 * reach.
 *
 * **A worker with no usable storage never claims.** Claiming and then failing at the first fetch
 * would consume the queue, mark every version `FAILED`, and leave a consultant looking at errors
 * whose cause is a missing environment variable (the rule IG4-001 set for the classifier).
 */
export interface ExtractionConsumerOptions {
  readonly db: Database;
  readonly storage: StoragePort;
  readonly logger: WorkerLogger;
  readonly idleDelayMs?: number;
  /** A claim older than this belongs to a crashed worker and returns to the queue. */
  readonly staleAfter?: string;
  /** How many times one version may be claimed before it is left alone. */
  readonly maxAttempts?: number;
}

export class ExtractionConsumer {
  private running = false;
  private stopped: Promise<void> | null = null;
  private inFlight = 0;

  constructor(private readonly options: ExtractionConsumerOptions) {}

  /** Claim and process at most `max` versions; returns how many were handled. */
  async drainOnce(max = 10): Promise<number> {
    let handled = 0;
    while (handled < max) {
      const claim = await claimNextExtraction(this.options.db, this.options.maxAttempts ?? 3);
      if (!claim) break;
      this.inFlight += 1;
      try {
        // The claim carries the uploader's identity, and the use-case opens its transaction as
        // them. The worker holds no identity of its own.
        const outcome = await processDocumentExtraction(
          this.options.db,
          claim,
          this.options.storage,
        );
        // Identifiers, a state and counts. A document's text never reaches a log line.
        this.options.logger.info(
          {
            version: outcome.versionId,
            state: outcome.state,
            pages: outcome.pageCount,
            chunks: outcome.chunkCount,
            ...(outcome.note ? { note: outcome.note.slice(0, 200) } : {}),
          },
          "document extraction processed",
        );
      } catch (error) {
        // The version stays in PROCESSING and the stale-release returns it to the queue. Losing a
        // process must not strand a document, and must not silently mark it FAILED either — the
        // attempt counter is what eventually stops a crash loop.
        this.options.logger.error(
          {
            version: claim.versionId,
            error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
          },
          "document extraction failed outside the job transaction",
        );
      } finally {
        this.inFlight -= 1;
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
        const released = await releaseStaleExtractions(
          this.options.db,
          this.options.staleAfter ?? "15 minutes",
        );
        if (released > 0) {
          this.options.logger.warn(
            { released },
            "stale document extractions returned to the queue",
          );
        }
        const handled = await this.drainOnce();
        if (handled === 0) await delay(idle);
      } catch (error) {
        this.options.logger.error(
          { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
          "extraction consumer loop error",
        );
        await delay(idle);
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
