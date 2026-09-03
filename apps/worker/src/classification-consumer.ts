import {
  claimNextClassification,
  processClassification,
  releaseStaleClaims,
} from "@eia/application";
import type { Database } from "@eia/db";
import type { OpenTextClassifier } from "@eia/domain";

import type { WorkerLogger } from "./process";

/**
 * The loop that turns queued classifications into proposals.
 *
 * It is a poll, not a subscription, and deliberately so: the queue is the `ai_classification`
 * table itself, claimed with `FOR UPDATE SKIP LOCKED`, which means no broker, no Redis, no second
 * store that can disagree with the database about what work exists. Two workers can run this loop
 * against the same database and neither will process the same row (Slice 4 §24–26).
 *
 * Everything a job does after claiming runs under the *initiating user's* RLS context, so this
 * process never needs privileges beyond `eia_app`. See `packages/application/src/social/worker.ts`.
 */
export interface ClassificationConsumerOptions {
  readonly db: Database;
  readonly classifier: OpenTextClassifier;
  readonly logger: WorkerLogger;
  /** How long to wait when there was nothing to do. */
  readonly idleDelayMs?: number;
  /** A claim older than this is assumed to belong to a crashed worker and returns to the queue. */
  readonly staleAfter?: string;
}

export class ClassificationConsumer {
  private running = false;
  private stopped: Promise<void> | null = null;
  private inFlight = 0;

  constructor(private readonly options: ClassificationConsumerOptions) {}

  /** Claim and process at most `max` classifications; returns how many were handled. */
  async drainOnce(max = 25): Promise<number> {
    let handled = 0;
    while (handled < max) {
      const claim = await claimNextClassification(this.options.db);
      if (!claim) break;
      this.inFlight += 1;
      try {
        const outcome = await processClassification(
          this.options.db,
          claim,
          this.options.classifier,
        );
        // Identifiers and status only: an answer's text never reaches a log line.
        this.options.logger.info(
          {
            classification: outcome.classificationId,
            status: outcome.status,
            ...(outcome.reason ? { reason: outcome.reason.slice(0, 200) } : {}),
          },
          "classification processed",
        );
      } catch (error) {
        this.options.logger.error(
          {
            classification: claim.classificationId,
            error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
          },
          "classification failed outside the job transaction",
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

  /** Work in flight, so the health endpoint and the heartbeat can report it. */
  pending(): number {
    return this.inFlight;
  }

  private async loop(): Promise<void> {
    const idle = this.options.idleDelayMs ?? 2_000;
    while (this.running) {
      try {
        const released = await releaseStaleClaims(
          this.options.db,
          this.options.staleAfter ?? "10 minutes",
        );
        if (released > 0) {
          this.options.logger.warn({ released }, "returned stale classification claims to pending");
        }
        const handled = await this.drainOnce();
        if (handled === 0) await sleep(idle);
      } catch (error) {
        this.options.logger.error(
          { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
          "classification consumer loop error",
        );
        await sleep(idle);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}
