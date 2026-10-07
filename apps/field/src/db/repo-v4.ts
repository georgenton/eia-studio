import type { LocalDeliveryState, PackInvitation, WorkPack } from "@eia/field-sync-contract";
import type * as SQLite from "expo-sqlite";

import { deliveryStateAfter, mayDeleteEvidenceFile } from "../core/delivery";
import { workPackFromFieldPack, type WorkPackOrigin } from "../core/pack-upgrade";
import type { PendingWorkSummary } from "../core/project-switch";
import { readPack } from "./repo";

/**
 * The v4 half of the capture journal: the active project, its invitations, and what a technician
 * reported at each gate.
 *
 * It is a second file rather than more of `repo.ts` for the reason the protocol is a second
 * module: the v3 half must keep working unchanged while this is added, and a reader asking
 * "what did v4 bring?" should be able to see it in one place.
 *
 * Everything here follows the same two rules the original journal was built on. It holds **one
 * technician's current work and nothing else** — no other technician's invitation, no respondent,
 * no answer. And **local ids and server ids are different columns**: an attempt has a `local_id`
 * from the moment the technician saves it, offline, and gains a `server_attempt_id` when the
 * command is acknowledged.
 */

const nowIso = () => new Date().toISOString();

/* ---------------------------------------------------------------------------------------------
 * the active project
 * ------------------------------------------------------------------------------------------ */

export async function saveWorkPack(
  db: SQLite.SQLiteDatabase,
  pack: WorkPack,
  origin: WorkPackOrigin = "download",
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `insert into work_pack (id, tenant_slug, project_slug, project_name, locality,
         technician_user_id, technician_email, campaign_id, survey_version_id,
         issued_at, expires_at, validity_basis, cursor, origin, payload)
       values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         tenant_slug = excluded.tenant_slug, project_slug = excluded.project_slug,
         project_name = excluded.project_name, locality = excluded.locality,
         technician_user_id = excluded.technician_user_id,
         technician_email = excluded.technician_email,
         campaign_id = excluded.campaign_id, survey_version_id = excluded.survey_version_id,
         issued_at = excluded.issued_at, expires_at = excluded.expires_at,
         validity_basis = excluded.validity_basis, cursor = excluded.cursor,
         origin = excluded.origin, payload = excluded.payload`,
      pack.project.tenantSlug,
      pack.project.projectSlug,
      pack.project.projectName,
      pack.project.locality,
      pack.technician.userId,
      pack.technician.email,
      pack.surveyWork?.campaign.id ?? null,
      pack.surveyWork?.campaign.surveyVersion.id ?? null,
      pack.validity.issuedAt,
      pack.validity.expiresAt,
      pack.validity.basis,
      pack.cursor,
      origin,
      JSON.stringify(pack),
    );
    await applyInvitations(db, pack.socializationWork.invitations, []);
  });
}

export async function readWorkPack(db: SQLite.SQLiteDatabase): Promise<WorkPack | null> {
  const row = await db.getFirstAsync<{ payload: string }>(
    "select payload from work_pack where id = 1",
  );
  if (!row) return null;
  return JSON.parse(row.payload) as WorkPack;
}

/**
 * The active project, converting a v3 pack if that is all this device has.
 *
 * Called on open. A handset that was in the field when the application was updated holds a v3
 * `field_pack` and no `work_pack`; converting it means the technician keeps working with what
 * they have instead of being told to find a signal (`pack-upgrade.ts`). The conversion is
 * written back and marked, so the next download replaces it with a real one.
 */
export async function ensureWorkPack(db: SQLite.SQLiteDatabase): Promise<WorkPack | null> {
  const existing = await readWorkPack(db);
  if (existing) return existing;
  const legacy = await readPack(db);
  if (!legacy) return null;
  const converted = workPackFromFieldPack(legacy);
  await saveWorkPack(db, converted, "converted");
  return converted;
}

export async function readWorkPackOrigin(
  db: SQLite.SQLiteDatabase,
): Promise<WorkPackOrigin | null> {
  const row = await db.getFirstAsync<{ origin: string }>(
    "select origin from work_pack where id = 1",
  );
  return (row?.origin as WorkPackOrigin | undefined) ?? null;
}

/* ---------------------------------------------------------------------------------------------
 * invitations
 * ------------------------------------------------------------------------------------------ */

/**
 * The server's view of this technician's invitations, and the ones it no longer sends.
 *
 * Revoked rather than deleted, exactly as `applyAssignments` does: a technician may have saved a
 * delivery against an invitation that has since changed hands, and the row has to stay so the
 * screen can say *requires review* beside their photograph.
 */
export async function applyInvitations(
  db: SQLite.SQLiteDatabase,
  invitations: ReadonlyArray<PackInvitation>,
  revokedIds: ReadonlyArray<string>,
): Promise<void> {
  for (const invitation of invitations) {
    await db.runAsync(
      `insert into local_invitation (id, revision, server_status, parcel_id, parcel_code,
         sector_label, chainage_label, recipient_label, event_id, event_title, starts_at,
         timezone, location_label, purpose, revoked_at, conflict_reason, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?)
       on conflict(id) do update set
         revision = excluded.revision, server_status = excluded.server_status,
         parcel_code = excluded.parcel_code, sector_label = excluded.sector_label,
         chainage_label = excluded.chainage_label, recipient_label = excluded.recipient_label,
         event_title = excluded.event_title, starts_at = excluded.starts_at,
         timezone = excluded.timezone, location_label = excluded.location_label,
         purpose = excluded.purpose,
         /* A row that comes back is ours again; the revocation is lifted rather than left. */
         revoked_at = null,
         updated_at = excluded.updated_at`,
      invitation.invitationId,
      invitation.revision,
      invitation.status,
      invitation.parcelId,
      invitation.parcelCode,
      invitation.sectorLabel,
      invitation.chainageLabel,
      invitation.recipientLabel,
      invitation.eventId,
      invitation.eventTitle,
      invitation.startsAt,
      invitation.timezone,
      invitation.locationLabel,
      invitation.purpose,
      nowIso(),
    );
  }
  for (const id of revokedIds) {
    await db.runAsync(
      `update local_invitation set revoked_at = ?, updated_at = ? where id = ? and revoked_at is null`,
      nowIso(),
      nowIso(),
      id,
    );
  }
}

export interface LocalInvitationRow {
  readonly id: string;
  readonly revision: number;
  readonly serverStatus: string;
  readonly parcelCode: string;
  readonly sectorLabel: string | null;
  readonly chainageLabel: string | null;
  readonly recipientLabel: string | null;
  readonly eventTitle: string;
  readonly startsAt: string;
  readonly timezone: string;
  readonly locationLabel: string;
  readonly purpose: string | null;
  readonly revoked: boolean;
  /** The local attempt, when this device has one. */
  readonly attemptState: LocalDeliveryState | null;
  readonly attemptOutcome: string | null;
}

export async function listInvitations(
  db: SQLite.SQLiteDatabase,
): Promise<ReadonlyArray<LocalInvitationRow>> {
  const rows = await db.getAllAsync<{
    id: string;
    revision: number;
    server_status: string;
    parcel_code: string;
    sector_label: string | null;
    chainage_label: string | null;
    recipient_label: string | null;
    event_title: string;
    starts_at: string;
    timezone: string;
    location_label: string;
    purpose: string | null;
    revoked_at: string | null;
    attempt_state: string | null;
    attempt_outcome: string | null;
  }>(
    `select i.*, a.state as attempt_state, a.outcome as attempt_outcome
       from local_invitation i
       left join local_delivery_attempt a
         on a.invitation_id = i.id
        and a.local_id = (select local_id from local_delivery_attempt
                           where invitation_id = i.id order by occurred_at desc limit 1)
      order by i.starts_at, i.parcel_code`,
  );
  return rows.map((row) => ({
    id: row.id,
    revision: row.revision,
    serverStatus: row.server_status,
    parcelCode: row.parcel_code,
    sectorLabel: row.sector_label,
    chainageLabel: row.chainage_label,
    recipientLabel: row.recipient_label,
    eventTitle: row.event_title,
    startsAt: row.starts_at,
    timezone: row.timezone,
    locationLabel: row.location_label,
    purpose: row.purpose,
    revoked: row.revoked_at !== null,
    attemptState: (row.attempt_state as LocalDeliveryState | null) ?? null,
    attemptOutcome: row.attempt_outcome,
  }));
}

export async function readInvitation(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<LocalInvitationRow | null> {
  const all = await listInvitations(db);
  return all.find((row) => row.id === id) ?? null;
}

/* ---------------------------------------------------------------------------------------------
 * delivery attempts
 * ------------------------------------------------------------------------------------------ */

export interface SaveDeliveryInput {
  readonly localId: string;
  readonly invitationId: string;
  readonly invitationRevision: number;
  readonly outcome: "DELIVERED" | "ABSENT" | "REFUSED" | "OTHER";
  readonly occurredAt: string;
  readonly note: string | null;
  readonly location: { latitude: number; longitude: number; accuracyM: number | null } | null;
  readonly evidence: { fileUri: string; mimeType: string; sizeBytes: number } | null;
  readonly state: LocalDeliveryState;
}

/**
 * Save what happened at a gate.
 *
 * Written before anything is sent and before the photograph is uploaded, because the technician
 * is standing in a road and the next thing that happens may be the application being killed by
 * the operating system. `local_id` is the caller's — minted once, at the moment of saving — and
 * `insert or ignore` makes saving twice one row.
 */
export async function saveDeliveryAttempt(
  db: SQLite.SQLiteDatabase,
  input: SaveDeliveryInput,
): Promise<void> {
  await db.runAsync(
    `insert or ignore into local_delivery_attempt
       (local_id, invitation_id, invitation_revision, outcome, occurred_at, note,
        latitude, longitude, accuracy_m, evidence_file_uri, evidence_mime_type,
        evidence_size_bytes, state, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.localId,
    input.invitationId,
    input.invitationRevision,
    input.outcome,
    input.occurredAt,
    input.note,
    input.location?.latitude ?? null,
    input.location?.longitude ?? null,
    input.location?.accuracyM ?? null,
    input.evidence?.fileUri ?? null,
    input.evidence?.mimeType ?? null,
    input.evidence?.sizeBytes ?? null,
    input.state,
    nowIso(),
  );
}

export interface LocalDeliveryRow {
  readonly localId: string;
  readonly invitationId: string;
  readonly invitationRevision: number;
  readonly outcome: "DELIVERED" | "ABSENT" | "REFUSED" | "OTHER";
  readonly occurredAt: string;
  readonly note: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyM: number | null;
  readonly evidenceFileUri: string | null;
  readonly evidenceMimeType: string | null;
  readonly evidenceSizeBytes: number | null;
  readonly evidenceStoredObjectId: string | null;
  readonly state: LocalDeliveryState;
  readonly commandId: string | null;
  readonly serverAttemptId: string | null;
  readonly conflictReason: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
}

function toDelivery(row: Record<string, unknown>): LocalDeliveryRow {
  return {
    localId: row.local_id as string,
    invitationId: row.invitation_id as string,
    invitationRevision: row.invitation_revision as number,
    outcome: row.outcome as LocalDeliveryRow["outcome"],
    occurredAt: row.occurred_at as string,
    note: (row.note as string | null) ?? null,
    latitude: (row.latitude as number | null) ?? null,
    longitude: (row.longitude as number | null) ?? null,
    accuracyM: (row.accuracy_m as number | null) ?? null,
    evidenceFileUri: (row.evidence_file_uri as string | null) ?? null,
    evidenceMimeType: (row.evidence_mime_type as string | null) ?? null,
    evidenceSizeBytes: (row.evidence_size_bytes as number | null) ?? null,
    evidenceStoredObjectId: (row.evidence_stored_object_id as string | null) ?? null,
    state: row.state as LocalDeliveryState,
    commandId: (row.command_id as string | null) ?? null,
    serverAttemptId: (row.server_attempt_id as string | null) ?? null,
    conflictReason: (row.conflict_reason as string | null) ?? null,
    attempts: (row.attempts as number | null) ?? 0,
    lastError: (row.last_error as string | null) ?? null,
  };
}

export async function listDeliveryAttempts(
  db: SQLite.SQLiteDatabase,
  invitationId?: string,
): Promise<ReadonlyArray<LocalDeliveryRow>> {
  const rows = invitationId
    ? await db.getAllAsync<Record<string, unknown>>(
        "select * from local_delivery_attempt where invitation_id = ? order by occurred_at",
        invitationId,
      )
    : await db.getAllAsync<Record<string, unknown>>(
        "select * from local_delivery_attempt order by occurred_at",
      );
  return rows.map(toDelivery);
}

/** Attempts whose photograph has not reached the provider yet. */
export async function deliveriesAwaitingEvidence(
  db: SQLite.SQLiteDatabase,
): Promise<ReadonlyArray<LocalDeliveryRow>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `select * from local_delivery_attempt
      where state = 'EVIDENCE_PENDING' and evidence_file_uri is not null
        and evidence_stored_object_id is null
      order by occurred_at`,
  );
  return rows.map(toDelivery);
}

/** Attempts that have everything they need and have not been queued yet. */
export async function deliveriesReadyToQueue(
  db: SQLite.SQLiteDatabase,
): Promise<ReadonlyArray<LocalDeliveryRow>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `select * from local_delivery_attempt
      where state = 'READY_TO_SYNC' and command_id is null order by occurred_at`,
  );
  return rows.map(toDelivery);
}

export async function attachEvidenceObject(
  db: SQLite.SQLiteDatabase,
  localId: string,
  storedObjectId: string,
): Promise<void> {
  await db.runAsync(
    `update local_delivery_attempt
        set evidence_stored_object_id = ?, state = 'READY_TO_SYNC', last_error = null,
            updated_at = ?
      where local_id = ?`,
    storedObjectId,
    nowIso(),
    localId,
  );
}

export async function setDeliveryCommandId(
  db: SQLite.SQLiteDatabase,
  localId: string,
  commandId: string,
): Promise<void> {
  await db.runAsync(
    "update local_delivery_attempt set command_id = ?, updated_at = ? where local_id = ?",
    commandId,
    nowIso(),
    localId,
  );
}

export async function recordDeliveryFailure(
  db: SQLite.SQLiteDatabase,
  localId: string,
  message: string,
): Promise<void> {
  await db.runAsync(
    `update local_delivery_attempt
        set attempts = attempts + 1, last_error = ?, state = 'SYNC_ERROR', updated_at = ?
      where local_id = ?`,
    message.slice(0, 300),
    nowIso(),
    localId,
  );
}

/**
 * Settle an attempt from the server's answer.
 *
 * The state comes from `deliveryStateAfter`, which is where the rule lives: an acknowledgement
 * settles it, and every refusal becomes `REQUIRES_REVIEW` with the row and its photograph
 * intact. Nothing in this function deletes anything.
 */
export async function settleDelivery(
  db: SQLite.SQLiteDatabase,
  localId: string,
  result: {
    outcome: "applied" | "duplicate" | "superseded" | "conflict" | "rejected";
    attemptId: string | null;
    conflictReason: string | null;
    message: string | null;
  },
): Promise<void> {
  await db.runAsync(
    `update local_delivery_attempt
        set state = ?, server_attempt_id = coalesce(?, server_attempt_id),
            conflict_reason = ?, last_error = ?, updated_at = ?
      where local_id = ?`,
    deliveryStateAfter(result.outcome),
    result.attemptId,
    result.conflictReason,
    result.message === null ? null : result.message.slice(0, 300),
    nowIso(),
    localId,
  );
}

/**
 * Forget the local photograph of an attempt the server has acknowledged.
 *
 * The caller deletes the file; this clears the row's pointer. `mayDeleteEvidenceFile` is the
 * predicate, and it is consulted here as well as by the caller so that a future caller cannot
 * skip it.
 */
export async function releaseEvidenceFile(
  db: SQLite.SQLiteDatabase,
  attempt: LocalDeliveryRow,
): Promise<boolean> {
  if (!mayDeleteEvidenceFile(attempt)) return false;
  await db.runAsync(
    "update local_delivery_attempt set evidence_file_uri = null, updated_at = ? where local_id = ?",
    nowIso(),
    attempt.localId,
  );
  return true;
}

/* ---------------------------------------------------------------------------------------------
 * what this device is still holding
 * ------------------------------------------------------------------------------------------ */

/**
 * Everything unsynced, counted by kind.
 *
 * It is what `decideProjectSwitch` reads, and it is deliberately a count per kind rather than a
 * boolean: a technician told "you have unsynced work" and nothing else has to go looking.
 */
export async function summarisePendingWork(db: SQLite.SQLiteDatabase): Promise<PendingWorkSummary> {
  const one = async (sql: string): Promise<number> => {
    const row = await db.getFirstAsync<{ n: number }>(sql);
    return row?.n ?? 0;
  };
  return {
    outboxPending: await one("select count(*) as n from sync_outbox where state = 'PENDING'"),
    outboxFailed: await one("select count(*) as n from sync_outbox where state = 'FAILED'"),
    unsyncedSurveys: await one(
      "select count(*) as n from local_survey where state not in ('SYNCED', 'NOT_STARTED')",
    ),
    pendingMedia: await one("select count(*) as n from local_media where state <> 'UPLOADED'"),
    unsettledDeliveries: await one(
      "select count(*) as n from local_delivery_attempt where state <> 'SYNCED'",
    ),
    pendingEvidence: await one(
      `select count(*) as n from local_delivery_attempt
        where evidence_file_uri is not null and server_attempt_id is null`,
    ),
  };
}

/**
 * Replace the active project, after a new pack has been downloaded **and parsed**.
 *
 * The order is `project-switch.ts`'s and the transaction is what makes it atomic: a device that
 * loses power here comes back holding one project, not half of two. The previous project's
 * snapshots go because they are the server's and can be downloaded again; `mobile_meta` stays
 * because it is the device's own.
 */
export async function replaceActiveProject(
  db: SQLite.SQLiteDatabase,
  pack: WorkPack,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    // Snapshots of the server's state. Everything the technician captured has already been
    // confirmed synced by `decideProjectSwitch`, which refuses otherwise.
    await db.runAsync("delete from local_invitation");
    await db.runAsync("delete from local_delivery_attempt");
    await db.runAsync("delete from local_assignment");
    await db.runAsync("delete from field_pack");
    await db.runAsync("delete from work_pack");
  });
  await saveWorkPack(db, pack, "download");
}
