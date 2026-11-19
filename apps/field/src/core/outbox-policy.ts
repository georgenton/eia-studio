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

/**
 * The two commands that close a visit on the server, after which nothing may be added to it.
 *
 * `survey.submit` closes the visit it names in the same transaction that writes the response
 * (`packages/application/src/field/use-cases.ts`), and `visit.finish` does so on its own. There is
 * no third, and this list is what the hold below is written against rather than a string compared
 * in two places.
 */
export const VISIT_CLOSING_COMMANDS: ReadonlyArray<SyncCommand["type"]> = [
  "survey.submit",
  "visit.finish",
];

/** The assignment a command would close a visit for, or `null` if it closes nothing. */
export function closesVisitFor(command: SyncCommand): string | null {
  if (!VISIT_CLOSING_COMMANDS.includes(command.type)) return null;
  const payload = command.payload as { assignmentId?: unknown };
  return typeof payload.assignmentId === "string" ? payload.assignmentId : null;
}

export interface WithheldQueue<T> {
  /** What this push may send, in the order it was queued. */
  readonly send: ReadonlyArray<T>;
  /** What is kept back, and the assignment each one is waiting for a photograph of. */
  readonly withheld: ReadonlyArray<{ readonly entry: T; readonly assignmentId: string }>;
}

/**
 * Hold back a command that would close a visit while this device still holds a photograph of it.
 *
 * ## The recorded failure
 *
 * On 19 November 2026 a photograph of predio 102 became undeliverable, and the queue's own
 * ordering is what made it so. The upload failed; `synchronise` recorded the error and **carried
 * on draining the outbox**; `survey.submit` went out and closed the visit four seconds later. The
 * next attempt asked for a new upload authorization — deliberately a new one, because reusing an
 * intent whose PUT may have half-succeeded costs a photograph (`core/media-upload.ts`) — and the
 * server refused it, because that authorization was issued after the visit closed.
 *
 * Two correct rules in conflict. The server is right that a finished visit must not grow new
 * evidence; the client was wrong to close the visit while it was still holding some.
 *
 * ## What is held, and what is not
 *
 * Only the two closing commands, and only for the assignment whose photograph is undelivered.
 * Everything else in the same push goes, **including the `media.declare` of that very
 * photograph** — which is what unblocks it, since a declaration against a visit that is still
 * open is admitted without reference to any upload time at all. Other parcels are untouched: a
 * technician with three visits does not lose two of them to one photograph.
 *
 * Nothing is reordered and no `commandId` changes. A withheld command keeps its row, its sequence
 * and its place; the next synchronisation finds it where it was.
 *
 * ## What this costs
 *
 * A ficha waits for its photograph. That is the trade, stated plainly: the response is held for
 * one parcel — visibly, on the parcel's own row — rather than delivered against a visit the
 * photograph could then never join. See TD-130 for the case this does not resolve.
 */
export function withholdClosuresForUndeliveredMedia<T extends { readonly command: SyncCommand }>(
  queue: ReadonlyArray<T>,
  assignmentsHoldingMedia: ReadonlySet<string>,
): WithheldQueue<T> {
  const send: T[] = [];
  const withheld: Array<{ entry: T; assignmentId: string }> = [];
  for (const entry of queue) {
    const assignmentId = closesVisitFor(entry.command);
    if (assignmentId !== null && assignmentsHoldingMedia.has(assignmentId)) {
      withheld.push({ entry, assignmentId });
      continue;
    }
    send.push(entry);
  }
  return { send, withheld };
}
