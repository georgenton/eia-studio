import type { FieldPack, SyncCommand } from "@eia/field-sync-contract";
import { SYNC_PUSH_LIMIT } from "@eia/field-sync-contract";
import type * as SQLite from "expo-sqlite";

import { withResolvedVisitId } from "../core/commands";
import { dispositionFor, dispositionForTransportFailure } from "../core/outbox-policy";
import {
  applyAssignments,
  applyResult,
  countPending,
  pendingCommands,
  readCursor,
  readPack,
  recordAttempt,
  recordSyncError,
  saveFieldPack,
  setCursor,
  settleCommand,
} from "../db/repo";
import { downloadFieldPack, pullChanges, pushCommands, ServerError, TransportError } from "./api";

/**
 * One synchronisation, start to finish.
 *
 * ## Push before pull, always
 *
 * What the technician captured is the thing that only exists on this device; what the server has
 * changed can be fetched again at any time. So the outbox is drained first, and only then does the
 * device ask what moved. Pulling first would also mean reconciling assignments against local work
 * that the server has not yet been told about, which is the situation most likely to look like a
 * conflict when it is simply a queue that has not run.
 *
 * ## Order inside the push
 *
 * Strictly by insertion sequence, and the batch **stops at the first command that does not
 * settle**. A submit that overtook its own `visit.start` would arrive naming a visit the server
 * has never issued; a draft that overtook a newer draft would be written backwards. Sequence is
 * the only ordering guarantee the protocol needs, because one assignment belongs to one
 * technician on one device.
 */
export interface SyncOutcome {
  readonly pushed: number;
  readonly settled: number;
  readonly conflicts: number;
  readonly pendingAfter: number;
  readonly pulled: boolean;
  readonly error: string | null;
}

export async function synchronise(db: SQLite.SQLiteDatabase): Promise<SyncOutcome> {
  const pack = await readPack(db);
  if (!pack) {
    return { pushed: 0, settled: 0, conflicts: 0, pendingAfter: 0, pulled: false, error: null };
  }
  const scope = {
    tenantSlug: pack.project.tenantSlug,
    projectSlug: pack.project.projectSlug,
  };

  let pushed = 0;
  let settled = 0;
  let conflicts = 0;
  let error: string | null = null;

  const queue = await pendingCommands(db, SYNC_PUSH_LIMIT);
  if (queue.length > 0) {
    // A command formed before its visit was acknowledged carries `visitId: null`; the server id is
    // known by now, so it is filled in here. The `commandId` is untouched, so patching cannot
    // create a duplicate.
    const resolved = await Promise.all(
      queue.map(async (row) => ({ row, command: await resolveVisit(db, row.command) })),
    );
    try {
      const response = await pushCommands({
        ...scope,
        commands: resolved.map((entry) => entry.command),
      });
      pushed = resolved.length;
      const byId = new Map(response.results.map((result) => [result.commandId, result]));
      for (const entry of resolved) {
        const result = byId.get(entry.command.commandId);
        if (!result) continue;
        await applyResult(db, entry.row, result);
        const disposition = dispositionFor(result);
        if (disposition.kind === "done") {
          await settleCommand(db, entry.row.seq, "DONE", null);
          settled += 1;
        } else if (disposition.kind === "conflict") {
          await settleCommand(db, entry.row.seq, "CONFLICT", disposition.message);
          await recordSyncError(db, "conflict", disposition.message);
          conflicts += 1;
        } else {
          await settleCommand(db, entry.row.seq, "FAILED", disposition.message);
          await recordSyncError(db, "rejected", disposition.message);
        }
      }
      await setCursor(db, response.cursor);
    } catch (cause) {
      // Transport: the commands stay queued, untouched, and are tried again. Anything the server
      // answered with a status is recorded but also left queued, because a 5xx is not a decision.
      const detail =
        cause instanceof TransportError || cause instanceof ServerError
          ? cause.message
          : "error desconocido";
      const retry = dispositionForTransportFailure(detail);
      error = retry.kind === "retry" ? retry.message : detail;
      for (const entry of queue) await recordAttempt(db, entry.seq, detail);
      await recordSyncError(db, "push", detail);
      return {
        pushed: 0,
        settled,
        conflicts,
        pendingAfter: await countPending(db),
        pulled: false,
        error,
      };
    }
  }

  let pulled = false;
  try {
    const cursor = await readCursor(db);
    const changes = await pullChanges({
      ...scope,
      cursor: cursor?.cursor ?? pack.cursor,
      knownAssignmentIds: pack.assignments.map((assignment) => assignment.id),
    });
    await applyAssignments(db, changes.assignments, changes.revokedAssignmentIds);
    await setCursor(db, changes.cursor);
    await refreshPackValidity(db, pack, changes.validity);
    pulled = true;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    error = error ?? detail;
    await recordSyncError(db, "pull", detail);
  }

  return { pushed, settled, conflicts, pendingAfter: await countPending(db), pulled, error };
}

async function resolveVisit(db: SQLite.SQLiteDatabase, command: SyncCommand): Promise<SyncCommand> {
  if (command.type !== "survey.upsert_draft" && command.type !== "survey.submit") return command;
  if (command.payload.visitId !== null) return command;
  const row = await db.getFirstAsync<{ server_id: string | null }>(
    `select v.server_id from local_visit v where v.assignment_id = ? and v.server_id is not null
      order by v.started_at desc limit 1`,
    command.payload.assignmentId,
  );
  return row?.server_id ? withResolvedVisitId(command, row.server_id) : command;
}

/** A successful pull renews the offline window; the stored pack keeps the new one. */
async function refreshPackValidity(
  db: SQLite.SQLiteDatabase,
  pack: FieldPack,
  validity: FieldPack["validity"],
): Promise<void> {
  await saveFieldPack(db, { ...pack, validity });
}

/**
 * Download the technician's work. Replaces the pack and reconciles assignments; never touches a
 * draft, a queued command or a locally submitted survey.
 */
export async function refreshFieldPack(
  db: SQLite.SQLiteDatabase,
  scope: { tenantSlug: string; projectSlug: string },
): Promise<{ ok: true; pack: FieldPack } | { ok: false; message: string }> {
  try {
    const response = await downloadFieldPack(scope);
    if (response.kind === "no_work") return { ok: false, message: response.message };
    await saveFieldPack(db, response.pack);
    await setCursor(db, response.pack.cursor);
    return { ok: true, pack: response.pack };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    await recordSyncError(db, "pack", detail);
    return { ok: false, message: detail };
  }
}
