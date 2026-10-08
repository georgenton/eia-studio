import type {
  CommandResult,
  FieldPack,
  SyncCommand,
  V4CommandResult,
} from "@eia/field-sync-contract";
import {
  CONFLICT_REASONS,
  SYNC_PUSH_LIMIT,
  workPackSchema,
  type FieldProjectWithWork,
  type WorkPack,
} from "@eia/field-sync-contract";
import * as Crypto from "expo-crypto";
import type * as SQLite from "expo-sqlite";

import { withResolvedVisitId } from "../core/commands";
import { dispositionFor, dispositionForTransportFailure } from "../core/outbox-policy";
import {
  applyAssignments,
  applyResult,
  countPending,
  countPendingMedia,
  pendingCommands,
  recordAttempt,
  recordSyncError,
  saveFieldPack,
  setCursor,
  settleCommand,
} from "../db/repo";
import { decideProjectSwitch, type PendingKind } from "../core/project-switch";
import {
  applyInvitations,
  ensureWorkPack,
  listInvitations,
  replaceActiveProject,
  saveWorkPack,
  summarisePendingWork,
} from "../db/repo-v4";
import {
  downloadFieldPack,
  downloadWorkPack,
  pullWork,
  pushWorkCommands,
  resolveFieldScope,
  resolveWorkScope,
  ServerError,
  TransportError,
} from "./api";
import {
  queueReadyDeliveries,
  settleDeliveryForCommand,
  sweepAcknowledgedEvidence,
  uploadPendingEvidence,
} from "./deliveries";
import { acknowledgeMedia, appVersion, sweepUploadedMedia, uploadPendingMedia } from "./media";

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
  /** Photographs whose bytes reached the provider and were verified in this run (ADR-032). */
  readonly mediaUploaded: number;
  /** Photographs still on the device, acknowledged or not. */
  readonly mediaPending: number;
  /** Delivery photographs whose bytes reached the provider in this run (ADR-041). */
  readonly evidenceUploaded: number;
  /** Delivery commands formed in this run, once their photograph was stored. */
  readonly deliveriesQueued: number;
  /** Local delivery photographs released, which only an acknowledgement permits. */
  readonly evidenceReleased: number;
}

export async function synchronise(db: SQLite.SQLiteDatabase): Promise<SyncOutcome> {
  /*
   * The active project is the **v4** one, and `ensureWorkPack` is what makes that true on a
   * handset that was in the field when the application was updated: it converts the v3 pack it
   * is holding rather than asking it to find a signal (`pack-upgrade.ts`).
   */
  const pack = await ensureWorkPack(db);
  if (!pack) {
    return {
      pushed: 0,
      settled: 0,
      conflicts: 0,
      pendingAfter: 0,
      pulled: false,
      error: null,
      mediaUploaded: 0,
      mediaPending: 0,
      evidenceUploaded: 0,
      deliveriesQueued: 0,
      evidenceReleased: 0,
    };
  }
  const scope = {
    tenantSlug: pack.project.tenantSlug,
    projectSlug: pack.project.projectSlug,
  };

  let pushed = 0;
  let settled = 0;
  let conflicts = 0;
  let error: string | null = null;

  /*
   * Photographs first, and *then* the outbox — not the other way round.
   *
   * A `media.declare` formed here joins the queue this same run, so one window of signal moves a
   * photograph all the way rather than half of it. The upload itself never touches the outbox: it
   * is bytes to a provider, and only the declaration is a command.
   */
  const media = await uploadPendingMedia(db, scope, appVersion());
  if (media.error) await recordSyncError(db, "media", media.error);

  /*
   * Then the delivery half, in the same window and in the same order for the same reason: the
   * bytes go to the provider, the id comes back, and only then is a command formed. A delivery
   * whose photograph has not been stored has nothing to name, so it is not queued at all —
   * which is what keeps a `DELIVERED` with no `storedObjectId` from ever reaching the server.
   */
  const evidence = await uploadPendingEvidence(db, scope);
  if (evidence.errors > 0) {
    await recordSyncError(db, "evidence", `${evidence.errors} evidencia(s) sin subir`);
  }
  /*
   * The id and the outbox row are written together, inside the repository, in one transaction.
   * They used to be two calls with a window between them, and an application killed in that
   * window left a delivery with an id and no command — stuck, with no way out through the
   * product. `repaired` counts rows found in that state and put right with their own id.
   */
  const deliveries = await queueReadyDeliveries(db, Crypto.randomUUID, appVersion());
  if (deliveries.repaired > 0) {
    await recordSyncError(db, "evidence", `${deliveries.repaired} entrega(s) reencoladas`);
  }

  const queue = await pendingCommands(db, SYNC_PUSH_LIMIT);
  if (queue.length > 0) {
    // A command formed before its visit was acknowledged carries `visitId: null`; the server id is
    // known by now, so it is filled in here. The `commandId` is untouched, so patching cannot
    // create a duplicate.
    const resolved = await Promise.all(
      queue.map(async (row) => ({ row, command: await resolveVisit(db, row.command) })),
    );
    try {
      /*
       * The **v4** endpoint, which accepts all six commands: the five inherited ones are
       * rewritten to a v3 envelope server-side and run through v3's own engine, so a survey
       * command means exactly what it meant. `commandId` is never regenerated here — a retry
       * sends the same id and the server replays its own answer.
       */
      const response = await pushWorkCommands({
        ...scope,
        commands: resolved.map((entry) => entry.command),
      });
      pushed = resolved.length;
      const byId = new Map(response.results.map((result) => [result.commandId, result]));
      for (const entry of resolved) {
        const result = byId.get(entry.command.commandId);
        if (!result) continue;

        /*
         * A delivery settles through its own handler and **not** `applyResult`, which writes
         * visit and instance ids onto survey rows a delivery does not have. Both then share the
         * outbox disposition below, because what the queue does with an answer is one rule.
         */
        if (entry.row.entityKind === "delivery") {
          await settleDeliveryForCommand(db, entry.command.commandId, {
            outcome: result.outcome,
            attemptId: result.attemptId ?? null,
            conflictReason: result.conflictReason,
            message: result.message,
          });
        } else {
          await applyResult(db, entry.row, narrowToV3Result(result));
        }

        const disposition = dispositionFor(narrowToV3Result(result));
        if (disposition.kind === "done") {
          await settleCommand(db, entry.row.seq, "DONE", null);
          settled += 1;
          // The only thing that releases a local file. Not the PUT, not the finalize: the server
          // saying the row exists (ADR-032).
          if (entry.row.entityKind === "media") {
            await acknowledgeMedia(db, entry.row.entityLocalId);
          }
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
        mediaUploaded: media.uploaded,
        mediaPending: media.pendingAfter,
        evidenceUploaded: evidence.uploaded,
        deliveriesQueued: deliveries.queued,
        evidenceReleased: 0,
      };
    }
  }

  let pulled = false;
  try {
    /*
     * Current-set reconciliation, both halves at once: the device says what it holds and the
     * server answers with what is still its own plus what is not. No cursor — v4's pull is not
     * a change feed, and a value the server never reads would be a value a later reader
     * believed in.
     */
    const known = await listInvitations(db);
    const changes = await pullWork({
      ...scope,
      knownAssignmentIds: pack.surveyWork?.assignments.map((a) => a.id) ?? [],
      knownInvitationIds: known.map((invitation) => invitation.id),
    });

    await applyInvitations(db, changes.socializationWork.invitations, changes.revokedInvitationIds);
    if (changes.surveyChanges !== null) {
      await applyAssignments(db, changes.surveyChanges.assignments, changes.revokedAssignmentIds);
    }

    /*
     * The stored pack is rewritten from what the pull said, so the offline window is the
     * server's renewed one and — when `surveyChanges` is null — **no closed campaign is left
     * standing as current work**. `saveWorkPack` clears `field_pack` in that case; a device that
     * kept it would show a technician a campaign nobody is running.
     */
    await saveWorkPack(
      db,
      {
        ...pack,
        surveyWork:
          changes.surveyChanges === null
            ? null
            : pack.surveyWork === null
              ? null
              : {
                  campaign: pack.surveyWork.campaign,
                  assignments: changes.surveyChanges.assignments,
                },
        socializationWork: changes.socializationWork,
        validity: changes.validity,
        cursor: changes.cursor,
      },
      "download",
    );
    await setCursor(db, changes.cursor);
    pulled = true;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    error = error ?? detail;
    await recordSyncError(db, "pull", detail);
  }

  // Last, and only for files the server acknowledged in this run or an earlier one.
  await sweepUploadedMedia(db);
  const swept = await sweepAcknowledgedEvidence(db);

  return {
    pushed,
    settled,
    conflicts,
    pendingAfter: await countPending(db),
    pulled,
    error,
    mediaUploaded: media.uploaded,
    mediaPending: await countPendingMedia(db),
    evidenceUploaded: evidence.uploaded,
    deliveriesQueued: deliveries.queued,
    evidenceReleased: swept.released,
  };
}

/**
 * A v4 result, as the v3 handlers expect to receive it.
 *
 * v4 widened `conflictReason` to a string so a delivery could name its own five reasons. The
 * survey, visit and media handlers were written against v3's closed list and have no branch for
 * anything else, so an unrecognised reason is narrowed to `null` rather than cast through — the
 * outcome, which is what both the disposition and the local state turn on, is unchanged.
 *
 * Nothing is lost: a delivery's reason is stored on its own row by `settleDeliveryForCommand`,
 * and the message a technician reads travels in `message`.
 */
function narrowToV3Result(result: V4CommandResult): CommandResult {
  const known = (CONFLICT_REASONS as ReadonlyArray<string>).includes(result.conflictReason ?? "");
  return {
    commandId: result.commandId,
    outcome: result.outcome,
    visitId: result.visitId,
    instanceId: result.instanceId,
    instanceStatus: result.instanceStatus,
    assignmentStatus: result.assignmentStatus,
    conflictReason: known ? (result.conflictReason as CommandResult["conflictReason"]) : null,
    message: result.message,
  };
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

/**
 * What asking for a first pack can end in. Three shapes rather than one with optional fields, so a
 * caller that forgets a case does not compile.
 */
export type AcquireFirstPackResult =
  | { readonly ok: true; readonly pack: FieldPack }
  | { readonly ok: false; readonly reason: "no_field_project" }
  | { readonly ok: false; readonly reason: "multiple_field_projects"; readonly count: number }
  | { readonly ok: false; readonly reason: "error"; readonly message: string };

/**
 * The **first** pack, on a device that holds none.
 *
 * `refreshFieldPack` needs a scope, and every caller derived one from the pack already stored —
 * which a fresh installation does not have. So this asks the server the prior question, then hands
 * the answer to the ordinary download path. Two of the three answers are refusals the technician
 * can act on rather than a silent empty screen.
 *
 * Once a pack exists this is never called again: `acquireFieldPack` is reached only from the
 * `pack === null` branch, and refresh and sync behave exactly as they did.
 */
export async function acquireFirstFieldPack(
  db: SQLite.SQLiteDatabase,
): Promise<AcquireFirstPackResult> {
  let scope: Awaited<ReturnType<typeof resolveFieldScope>>;
  try {
    scope = await resolveFieldScope();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    await recordSyncError(db, "pack", detail);
    return { ok: false, reason: "error", message: detail };
  }

  if (scope.kind === "no_field_project") return { ok: false, reason: "no_field_project" };
  if (scope.kind === "multiple_field_projects") {
    return { ok: false, reason: "multiple_field_projects", count: scope.count };
  }

  const result = await refreshFieldPack(db, {
    tenantSlug: scope.tenantSlug,
    projectSlug: scope.projectSlug,
  });
  return result.ok
    ? { ok: true, pack: result.pack }
    : { ok: false, reason: "error", message: result.message };
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

/* ---------------------------------------------------------------------------------------------
 * Protocol v4: discovering roads, downloading one, and changing between them
 * ------------------------------------------------------------------------------------------ */

/**
 * Every project this technician has work in.
 *
 * Returned as a list even when it has one entry, so the caller decides by the same code path
 * for one and for five. What it must never do is **pick** when there are several: which study
 * somebody's morning belongs to is their decision, and v3's terminal `multiple_field_projects`
 * existed only because the application could not hold the answer.
 */
export async function discoverProjects(
  db: SQLite.SQLiteDatabase,
): Promise<
  | { readonly ok: true; readonly projects: ReadonlyArray<FieldProjectWithWork> }
  | { readonly ok: false; readonly message: string }
> {
  try {
    const scope = await resolveWorkScope();
    return { ok: true, projects: scope.projects };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    await recordSyncError(db, "pack", detail);
    return { ok: false, message: detail };
  }
}

/**
 * Download one project's work and make it the active one.
 *
 * Used for the **first** pack on a fresh installation, where there is nothing to lose. Changing
 * from one project to another goes through `switchProject`, which refuses while anything is
 * unsynced and replaces the old snapshot atomically.
 */
export async function downloadProject(
  db: SQLite.SQLiteDatabase,
  scope: { tenantSlug: string; projectSlug: string },
): Promise<{ ok: true; pack: WorkPack } | { ok: false; message: string }> {
  try {
    const response = await downloadWorkPack(scope);
    if (response.kind === "no_work") return { ok: false, message: response.message };
    await saveWorkPack(db, response.pack, "download");
    await setCursor(db, response.pack.cursor);
    return { ok: true, pack: response.pack };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    await recordSyncError(db, "pack", detail);
    return { ok: false, message: detail };
  }
}

export type SwitchProjectResult =
  | { readonly kind: "switched"; readonly pack: WorkPack }
  | { readonly kind: "blocked"; readonly blocking: ReadonlyArray<PendingKind> }
  | { readonly kind: "offline" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Change which road this phone is working on.
 *
 * The order is `PROJECT_SWITCH_STEPS` and every step of it matters:
 *
 * 1. **count what is pending** — by kind, so a refusal can say what;
 * 2. **decide**, which refuses while anything is unsynced and distinguishes that from no signal;
 * 3. **download** the new pack;
 * 4. **parse** it in full, before anything local is touched;
 * 5. **one transaction** that removes the old snapshot and writes the new one;
 * 6. commit.
 *
 * A failure at 3 or 4 leaves the device exactly as it was — still holding the project it was
 * working on, still able to work offline. A failure at 5 rolls back. The previous version
 * committed the deletion and *then* wrote the new pack, which left a phone with neither.
 */
export async function switchProject(
  db: SQLite.SQLiteDatabase,
  scope: { tenantSlug: string; projectSlug: string },
  options: { online: boolean },
): Promise<SwitchProjectResult> {
  const pending = await summarisePendingWork(db);
  const decision = decideProjectSwitch({ online: options.online, pending });
  if (decision.kind === "blocked") return { kind: "blocked", blocking: decision.blocking };
  if (decision.kind === "offline") return { kind: "offline" };

  let pack: WorkPack;
  try {
    const response = await downloadWorkPack(scope);
    if (response.kind === "no_work") return { kind: "failed", message: response.message };
    // Parsed in full before a single local row changes. A pack that does not satisfy its own
    // contract must not be the reason a technician loses the one they had.
    pack = workPackSchema.parse(response.pack);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    await recordSyncError(db, "pack", detail);
    return { kind: "failed", message: detail };
  }

  try {
    await replaceActiveProject(db, pack);
  } catch (cause) {
    // The transaction rolled back, so the previous project is still there and still readable.
    const detail = cause instanceof Error ? cause.message : "error desconocido";
    await recordSyncError(db, "pack", detail);
    return { kind: "failed", message: detail };
  }
  await setCursor(db, pack.cursor);
  return { kind: "switched", pack };
}
