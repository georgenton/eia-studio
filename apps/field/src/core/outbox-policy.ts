import {
  type CommandOutcome,
  type CommandResult,
  type SyncCommand,
} from "@eia/field-sync-contract";

/**
 * What the queue does with each answer the server gives, and — more importantly — what it stops
 * doing.
 *
 * An outbox that retries everything forever is not resilient, it is stuck: one command the server
 * will never accept blocks every command behind it, and the technician sees *"3 elementos por
 * sincronizar"* that never becomes zero. So every outcome is classified once, here, and only
 * transport failures are retried.
 */
export type OutboxDisposition =
  /** Remove from the queue; the server has it. */
  | { readonly kind: "done" }
  /** Remove from the queue and flag the work for a person. Local data is kept, always. */
  | { readonly kind: "conflict"; readonly reason: string; readonly message: string }
  /** Keep, and try again later: the network failed, not the command. */
  | { readonly kind: "retry"; readonly message: string }
  /** Keep, but stop trying automatically: the command is wrong and a person must look. */
  | { readonly kind: "failed"; readonly message: string };

/** Outcomes that mean the server is done with this command, whatever it decided. */
const SETTLED: ReadonlyArray<CommandOutcome> = ["applied", "duplicate", "superseded"];

export function dispositionFor(result: CommandResult): OutboxDisposition {
  if (SETTLED.includes(result.outcome)) return { kind: "done" };
  if (result.outcome === "conflict") {
    return {
      kind: "conflict",
      reason: result.conflictReason ?? "unknown",
      message: result.message ?? "Requiere revisión de la coordinación.",
    };
  }
  return {
    kind: "failed",
    message: result.message ?? "El servidor rechazó esta orden.",
  };
}

/**
 * A command that never reached the server at all.
 *
 * Always a retry, and deliberately so: an unanswered request is the one case where the device
 * genuinely does not know what happened, and re-sending it is safe precisely because the server
 * recognises the `commandId` it already processed.
 */
export function dispositionForTransportFailure(detail: string): OutboxDisposition {
  return { kind: "retry", message: detail };
}

/**
 * How long to wait before the next automatic attempt.
 *
 * Exponential with a ceiling, and jittered by the caller if it wants: the failure mode this avoids
 * is twenty devices coming out of the same valley and retrying in lockstep against one server.
 */
export const RETRY_BACKOFF_MS = [0, 5_000, 30_000, 120_000, 600_000] as const;

export function backoffFor(attempts: number): number {
  const index = Math.min(attempts, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[index] ?? 600_000;
}

/**
 * Commands for one entity must reach the server in the order the technician did them: a draft
 * before its submit, a visit before the survey that names it. The queue is therefore drained
 * strictly in insertion order and **stops at the first command that is not settled**, rather than
 * skipping ahead — a submit that overtook its own visit would arrive with a `visitId` the server
 * has never seen.
 */
export function drainableBatch<T extends { readonly command: SyncCommand }>(
  queue: ReadonlyArray<T>,
  limit: number,
): ReadonlyArray<T> {
  return queue.slice(0, Math.max(0, limit));
}
