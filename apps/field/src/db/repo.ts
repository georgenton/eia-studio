import type {
  CommandResult,
  FieldPack,
  LocalSurveyState,
  SyncCommand,
  WireAnswer,
} from "@eia/field-sync-contract";
import type * as SQLite from "expo-sqlite";

import { stateForOutcome } from "../core/survey-state";

/**
 * Every read and write the application makes against the local journal.
 *
 * Plain SQL against `expo-sqlite`, deliberately: there is no ORM here and no repository
 * abstraction over one. The schema is eleven small tables that only this file touches, and a
 * second query builder in the bundle would be more code than the queries.
 */
export interface LocalAssignmentRow {
  readonly id: string;
  readonly parcelCode: string;
  readonly sectorLabel: string | null;
  readonly chainageLabel: string | null;
  readonly side: string | null;
  readonly serverStatus: string;
  readonly openVisitId: string | null;
  readonly instanceId: string | null;
  readonly instanceStatus: string | null;
  readonly revokedAt: string | null;
  readonly conflictReason: string | null;
  /** Set when this assignment is a correction revisit (ADR-038). Never a previous answer. */
  readonly correctsAssignmentId: string | null;
  readonly correctionReason: string | null;
  readonly correctionRequestedAt: string | null;
  /** Local survey state, joined; `NOT_STARTED` when no local survey row exists yet. */
  readonly surveyState: LocalSurveyState;
  readonly localSurveyId: string | null;
  readonly localVisitId: string | null;
}

const nowIso = () => new Date().toISOString();

/**
 * Replace the pack, keeping every local row the technician has touched.
 *
 * This is the function that has to be careful. A pack refresh must update *server* facts — which
 * assignments are mine, what their status is, which ids the server holds — and must never remove a
 * local draft, a queued command or a submitted-on-device survey. So assignments are upserted, and
 * an assignment the server no longer sends is **marked revoked**, never deleted (Phase 14).
 */
export async function saveFieldPack(db: SQLite.SQLiteDatabase, pack: FieldPack): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `insert into field_pack (id, tenant_slug, project_slug, project_name, locality, campaign_id,
         campaign_name, survey_version_id, survey_version_label, technician_user_id,
         technician_email, issued_at, expires_at, validity_basis, cursor, payload)
       values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         tenant_slug = excluded.tenant_slug, project_slug = excluded.project_slug,
         project_name = excluded.project_name, locality = excluded.locality,
         campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name,
         survey_version_id = excluded.survey_version_id,
         survey_version_label = excluded.survey_version_label,
         technician_user_id = excluded.technician_user_id,
         technician_email = excluded.technician_email, issued_at = excluded.issued_at,
         expires_at = excluded.expires_at, validity_basis = excluded.validity_basis,
         cursor = excluded.cursor, payload = excluded.payload`,
      pack.project.tenantSlug,
      pack.project.projectSlug,
      pack.project.projectName,
      pack.project.locality,
      pack.campaign.id,
      pack.campaign.name,
      pack.campaign.surveyVersion.id,
      pack.campaign.surveyVersion.versionLabel,
      pack.technician.userId,
      pack.technician.email,
      pack.validity.issuedAt,
      pack.validity.expiresAt,
      pack.validity.basis,
      pack.cursor,
      JSON.stringify(pack),
    );

    const version = pack.campaign.surveyVersion;
    for (const question of version.questions) {
      await db.runAsync(
        `insert into local_question
           (survey_version_id, code, ordinal, type, prompt, help_text, required, sensitivity)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(survey_version_id, code) do update set
           ordinal = excluded.ordinal, type = excluded.type, prompt = excluded.prompt,
           help_text = excluded.help_text, required = excluded.required,
           sensitivity = excluded.sensitivity`,
        version.id,
        question.code,
        question.ordinal,
        question.type,
        question.prompt,
        question.helpText,
        question.required ? 1 : 0,
        question.sensitivity,
      );
      for (const option of question.options) {
        await db.runAsync(
          `insert into local_option (survey_version_id, question_code, code, label, ordinal)
           values (?, ?, ?, ?, ?)
           on conflict(survey_version_id, question_code, code) do update set
             label = excluded.label, ordinal = excluded.ordinal`,
          version.id,
          question.code,
          option.code,
          option.label,
          option.ordinal,
        );
      }
    }

    await applyAssignments(db, pack.assignments, []);
  });
}

/**
 * Upsert the server's view of the caller's assignments, and revoke the ones it no longer sends.
 *
 * Shared by the pack download and by a pull, because they answer the same question.
 */
export async function applyAssignments(
  db: SQLite.SQLiteDatabase,
  assignments: FieldPack["assignments"],
  revokedIds: ReadonlyArray<string>,
): Promise<void> {
  for (const assignment of assignments) {
    await db.runAsync(
      `insert into local_assignment
         (id, parcel_code, sector_label, chainage_label, side, server_status, open_visit_id,
          instance_id, instance_status, revision, revoked_at, conflict_reason, updated_at,
          corrects_assignment_id, correction_reason, correction_requested_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?, ?)
       on conflict(id) do update set
         parcel_code = excluded.parcel_code, sector_label = excluded.sector_label,
         chainage_label = excluded.chainage_label, side = excluded.side,
         server_status = excluded.server_status, open_visit_id = excluded.open_visit_id,
         instance_id = excluded.instance_id, instance_status = excluded.instance_status,
         revision = excluded.revision, revoked_at = null, updated_at = excluded.updated_at,
         corrects_assignment_id = excluded.corrects_assignment_id,
         correction_reason = excluded.correction_reason,
         correction_requested_at = excluded.correction_requested_at`,
      assignment.id,
      assignment.parcel.parcelCode,
      assignment.parcel.sectorLabel,
      assignment.parcel.chainageLabel,
      assignment.parcel.side,
      assignment.status,
      assignment.openVisitId,
      assignment.instanceId,
      assignment.instanceStatus,
      assignment.revision,
      nowIso(),
      assignment.correction?.correctsAssignmentId ?? null,
      assignment.correction?.reason ?? null,
      assignment.correction?.requestedAt ?? null,
    );
  }
  for (const id of revokedIds) {
    // Marked, never deleted: if there is local work under it the technician still needs to see it.
    await db.runAsync(
      `update local_assignment
          set revoked_at = ?, conflict_reason = coalesce(conflict_reason, 'assignment_reassigned'),
              updated_at = ?
        where id = ?`,
      nowIso(),
      nowIso(),
      id,
    );
  }
}

export async function listAssignments(
  db: SQLite.SQLiteDatabase,
): Promise<ReadonlyArray<LocalAssignmentRow>> {
  const rows = await db.getAllAsync<{
    id: string;
    parcel_code: string;
    sector_label: string | null;
    chainage_label: string | null;
    side: string | null;
    server_status: string;
    open_visit_id: string | null;
    instance_id: string | null;
    instance_status: string | null;
    revoked_at: string | null;
    conflict_reason: string | null;
    corrects_assignment_id: string | null;
    correction_reason: string | null;
    correction_requested_at: string | null;
    survey_state: string | null;
    survey_id: string | null;
    visit_id: string | null;
  }>(
    `select a.id, a.parcel_code, a.sector_label, a.chainage_label, a.side, a.server_status,
            a.open_visit_id, a.instance_id, a.instance_status, a.revoked_at, a.conflict_reason,
            a.corrects_assignment_id, a.correction_reason, a.correction_requested_at,
            s.state as survey_state, s.id as survey_id, v.id as visit_id
       from local_assignment a
       left join local_survey s on s.assignment_id = a.id
       left join local_visit v on v.assignment_id = a.id and v.status = 'IN_PROGRESS'
      order by a.chainage_label nulls last, a.parcel_code`,
  );
  return rows.map((row) => ({
    id: row.id,
    parcelCode: row.parcel_code,
    sectorLabel: row.sector_label,
    chainageLabel: row.chainage_label,
    side: row.side,
    serverStatus: row.server_status,
    openVisitId: row.open_visit_id,
    instanceId: row.instance_id,
    instanceStatus: row.instance_status,
    revokedAt: row.revoked_at,
    conflictReason: row.conflict_reason,
    correctsAssignmentId: row.corrects_assignment_id,
    correctionReason: row.correction_reason,
    correctionRequestedAt: row.correction_requested_at,
    surveyState: (row.survey_state ?? "NOT_STARTED") as LocalSurveyState,
    localSurveyId: row.survey_id,
    localVisitId: row.visit_id,
  }));
}

export async function readPack(db: SQLite.SQLiteDatabase): Promise<FieldPack | null> {
  const row = await db.getFirstAsync<{ payload: string }>(
    "select payload from field_pack where id = 1",
  );
  if (!row) return null;
  return JSON.parse(row.payload) as FieldPack;
}

/* ------------------------------------------------------------------ device preferences */

/**
 * `mobile_meta` is a two-column key/value table, and it holds the handful of things that are true
 * of the *installation* rather than of the work: the local schema version, and the language the
 * technician reads. Neither is project data, and neither needs a network to change.
 */
export async function readMeta(db: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "select value from mobile_meta where key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function writeMeta(
  db: SQLite.SQLiteDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    "insert into mobile_meta (key, value) values (?, ?) " +
      "on conflict(key) do update set value = excluded.value",
    key,
    value,
  );
}

/* ------------------------------------------------------------------ visits and surveys */

export async function insertVisit(
  db: SQLite.SQLiteDatabase,
  input: {
    id: string;
    assignmentId: string;
    latitude: number | null;
    longitude: number | null;
    accuracyM: number | null;
    locationCapturedAt: string | null;
    locationOutcome: string;
  },
): Promise<void> {
  await db.runAsync(
    `insert into local_visit
       (id, assignment_id, server_id, status, started_at, latitude, longitude, accuracy_m,
        location_captured_at, location_outcome)
     values (?, ?, null, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.assignmentId,
    nowIso(),
    input.latitude,
    input.longitude,
    input.accuracyM,
    input.locationCapturedAt,
    input.locationOutcome,
  );
}

export async function upsertSurvey(
  db: SQLite.SQLiteDatabase,
  input: {
    id: string;
    assignmentId: string;
    visitId: string | null;
    surveyVersionId: string;
    state: LocalSurveyState;
  },
): Promise<void> {
  await db.runAsync(
    `insert into local_survey
       (id, assignment_id, visit_id, server_id, survey_version_id, state, device_revision,
        updated_at)
     values (?, ?, ?, null, ?, ?, 0, ?)
     on conflict(id) do update set
       visit_id = excluded.visit_id, state = excluded.state, updated_at = excluded.updated_at`,
    input.id,
    input.assignmentId,
    input.visitId,
    input.surveyVersionId,
    input.state,
    nowIso(),
  );
}

export async function saveAnswer(
  db: SQLite.SQLiteDatabase,
  surveyId: string,
  questionCode: string,
  answer: WireAnswer,
): Promise<void> {
  await db.runAsync(
    `insert into local_answer (survey_id, question_code, answer_json, updated_at)
     values (?, ?, ?, ?)
     on conflict(survey_id, question_code) do update set
       answer_json = excluded.answer_json, updated_at = excluded.updated_at`,
    surveyId,
    questionCode,
    JSON.stringify(answer),
    nowIso(),
  );
}

export async function readAnswers(
  db: SQLite.SQLiteDatabase,
  surveyId: string,
): Promise<Record<string, WireAnswer>> {
  const rows = await db.getAllAsync<{ question_code: string; answer_json: string }>(
    "select question_code, answer_json from local_answer where survey_id = ?",
    surveyId,
  );
  const answers: Record<string, WireAnswer> = {};
  for (const row of rows) answers[row.question_code] = JSON.parse(row.answer_json) as WireAnswer;
  return answers;
}

export async function setSurveyState(
  db: SQLite.SQLiteDatabase,
  surveyId: string,
  state: LocalSurveyState,
  extra: { conflictReason?: string | null; syncedAt?: string | null } = {},
): Promise<void> {
  await db.runAsync(
    `update local_survey
        set state = ?,
            conflict_reason = coalesce(?, conflict_reason),
            synced_at = coalesce(?, synced_at),
            updated_at = ?
      where id = ?`,
    state,
    extra.conflictReason ?? null,
    extra.syncedAt ?? null,
    nowIso(),
    surveyId,
  );
}

export async function bumpDeviceRevision(
  db: SQLite.SQLiteDatabase,
  surveyId: string,
): Promise<number> {
  await db.runAsync(
    "update local_survey set device_revision = device_revision + 1, updated_at = ? where id = ?",
    nowIso(),
    surveyId,
  );
  const row = await db.getFirstAsync<{ device_revision: number }>(
    "select device_revision from local_survey where id = ?",
    surveyId,
  );
  return row?.device_revision ?? 0;
}

/* ------------------------------------------------------------------ the outbox */

export interface OutboxRow {
  readonly seq: number;
  readonly commandId: string;
  readonly commandType: string;
  readonly entityKind: string;
  readonly entityLocalId: string;
  readonly command: SyncCommand;
  readonly attempts: number;
  readonly state: string;
  readonly lastError: string | null;
}

export async function enqueue(
  db: SQLite.SQLiteDatabase,
  input: {
    command: SyncCommand;
    entityKind: "visit" | "survey" | "media";
    entityLocalId: string;
  },
): Promise<void> {
  await db.runAsync(
    `insert into sync_outbox
       (command_id, command_type, entity_kind, entity_local_id, command_json, created_at)
     values (?, ?, ?, ?, ?, ?)`,
    input.command.commandId,
    input.command.type,
    input.entityKind,
    input.entityLocalId,
    JSON.stringify(input.command),
    nowIso(),
  );
}

/** Pending commands, oldest first. Order is the protocol: a submit must not overtake its visit. */
export async function pendingCommands(
  db: SQLite.SQLiteDatabase,
  limit: number,
): Promise<ReadonlyArray<OutboxRow>> {
  const rows = await db.getAllAsync<{
    seq: number;
    command_id: string;
    command_type: string;
    entity_kind: string;
    entity_local_id: string;
    command_json: string;
    attempts: number;
    state: string;
    last_error: string | null;
  }>(
    `select seq, command_id, command_type, entity_kind, entity_local_id, command_json, attempts,
            state, last_error
       from sync_outbox
      where state in ('PENDING', 'FAILED')
      order by seq
      limit ?`,
    limit,
  );
  return rows.map((row) => ({
    seq: row.seq,
    commandId: row.command_id,
    commandType: row.command_type,
    entityKind: row.entity_kind,
    entityLocalId: row.entity_local_id,
    command: JSON.parse(row.command_json) as SyncCommand,
    attempts: row.attempts,
    state: row.state,
    lastError: row.last_error,
  }));
}

export async function countPending(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "select count(*) as n from sync_outbox where state in ('PENDING', 'FAILED')",
  );
  return row?.n ?? 0;
}

export async function settleCommand(
  db: SQLite.SQLiteDatabase,
  seq: number,
  state: "DONE" | "FAILED" | "CONFLICT",
  error: string | null,
): Promise<void> {
  if (state === "DONE") {
    await db.runAsync("delete from sync_outbox where seq = ?", seq);
    return;
  }
  await db.runAsync(
    "update sync_outbox set state = ?, last_error = ?, attempts = attempts + 1 where seq = ?",
    state,
    error,
    seq,
  );
}

export async function recordAttempt(
  db: SQLite.SQLiteDatabase,
  seq: number,
  error: string,
): Promise<void> {
  await db.runAsync(
    "update sync_outbox set attempts = attempts + 1, last_error = ?, state = 'PENDING' where seq = ?",
    error,
    seq,
  );
}

/**
 * Store the server ids a command came back with, so later commands can name them.
 *
 * This is what makes a second sync a no-op: once the device knows the server's visit and instance
 * ids, it stops proposing new ones, and the server recognises everything it is sent.
 */
export async function applyResult(
  db: SQLite.SQLiteDatabase,
  row: OutboxRow,
  result: CommandResult,
): Promise<void> {
  if (result.visitId) {
    await db.runAsync(
      "update local_visit set server_id = ? where id = ? or server_id = ?",
      result.visitId,
      row.entityKind === "visit" ? row.entityLocalId : "",
      result.visitId,
    );
    await db.runAsync(
      "update local_assignment set open_visit_id = ? where id = (select assignment_id from local_visit where id = ?)",
      result.visitId,
      row.entityKind === "visit" ? row.entityLocalId : "",
    );
    /*
     * Photographs taken before the visit was acknowledged have been waiting with no server visit
     * to belong to (ADR-032). This is the moment they can be declared, so the id reaches them in
     * the same transaction that reaches the assignment.
     */
    await db.runAsync(
      `update local_media set visit_server_id = ?
        where visit_server_id is null
          and assignment_local_id = (select assignment_id from local_visit where id = ?)`,
      result.visitId,
      row.entityKind === "visit" ? row.entityLocalId : "",
    );
  }
  if (row.entityKind === "survey") {
    const current = await db.getFirstAsync<{ state: string }>(
      "select state from local_survey where id = ?",
      row.entityLocalId,
    );
    if (current) {
      const next = stateForOutcome(current.state as LocalSurveyState, result.outcome);
      await db.runAsync(
        `update local_survey
            set server_id = coalesce(?, server_id),
                state = ?,
                conflict_reason = coalesce(?, conflict_reason),
                synced_at = case when ? = 'SYNCED' then ? else synced_at end,
                updated_at = ?
          where id = ?`,
        result.instanceId,
        next,
        result.conflictReason,
        next,
        nowIso(),
        nowIso(),
        row.entityLocalId,
      );
    }
  }
}

export async function setCursor(db: SQLite.SQLiteDatabase, cursor: string): Promise<void> {
  await db.runAsync(
    `insert into sync_cursor (id, cursor, last_sync_at) values (1, ?, ?)
     on conflict(id) do update set cursor = excluded.cursor, last_sync_at = excluded.last_sync_at`,
    cursor,
    nowIso(),
  );
}

export async function readCursor(
  db: SQLite.SQLiteDatabase,
): Promise<{ cursor: string; lastSyncAt: string } | null> {
  const row = await db.getFirstAsync<{ cursor: string; last_sync_at: string }>(
    "select cursor, last_sync_at from sync_cursor where id = 1",
  );
  return row ? { cursor: row.cursor, lastSyncAt: row.last_sync_at } : null;
}

export async function recordSyncError(
  db: SQLite.SQLiteDatabase,
  scope: string,
  detail: string,
): Promise<void> {
  // Bounded text, never a payload: a sync error must not become a second copy of an answer.
  await db.runAsync(
    "insert into sync_error (at, scope, detail) values (?, ?, ?)",
    nowIso(),
    scope,
    detail.slice(0, 400),
  );
}

/* ---------------------------------------------------------------------------------------------
 * Field media (ADR-032)
 * ------------------------------------------------------------------------------------------ */

interface MediaRow {
  local_id: string;
  assignment_local_id: string;
  visit_server_id: string | null;
  file_uri: string;
  mime_type: string;
  size_bytes: number;
  kind: string;
  note: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  state: string;
  stored_object_id: string | null;
  server_media_id: string | null;
  attempts: number;
  last_error: string | null;
}

/**
 * Record a photograph the moment it is taken.
 *
 * The row is written **before** anything is attempted, with the file already copied into the
 * application's own directory. That order is the guarantee: a battery that dies between the
 * shutter and the network leaves a row and a file, which the next launch picks up.
 */
export async function insertLocalMedia(
  db: SQLite.SQLiteDatabase,
  input: {
    localId: string;
    assignmentLocalId: string;
    visitServerId: string | null;
    fileUri: string;
    mimeType: string;
    sizeBytes: number;
    kind: string;
    note: string | null;
    latitude: number | null;
    longitude: number | null;
    accuracyM: number | null;
  },
): Promise<void> {
  await db.runAsync(
    `insert into local_media
       (local_id, assignment_local_id, visit_server_id, file_uri, mime_type, size_bytes, kind,
        note, captured_at, latitude, longitude, accuracy_m, state)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_UPLOAD')`,
    input.localId,
    input.assignmentLocalId,
    input.visitServerId,
    input.fileUri,
    input.mimeType,
    input.sizeBytes,
    input.kind,
    input.note,
    nowIso(),
    input.latitude,
    input.longitude,
    input.accuracyM,
  );
}

export interface LocalMediaRecord {
  readonly localId: string;
  readonly assignmentId: string;
  readonly visitId: string | null;
  readonly fileUri: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly kind: string;
  readonly note: string | null;
  readonly capturedAt: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyM: number | null;
  readonly state: "PENDING_UPLOAD" | "UPLOADING" | "UPLOADED" | "FAILED";
  readonly storedObjectId: string | null;
  readonly serverMediaId: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
}

function toMediaRecord(row: MediaRow): LocalMediaRecord {
  return {
    localId: row.local_id,
    assignmentId: row.assignment_local_id,
    visitId: row.visit_server_id,
    fileUri: row.file_uri,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    kind: row.kind,
    note: row.note,
    capturedAt: row.captured_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyM: row.accuracy_m,
    state: row.state as LocalMediaRecord["state"],
    storedObjectId: row.stored_object_id,
    serverMediaId: row.server_media_id,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

export async function listMediaForAssignment(
  db: SQLite.SQLiteDatabase,
  assignmentId: string,
): Promise<ReadonlyArray<LocalMediaRecord>> {
  const rows = await db.getAllAsync<MediaRow>(
    `select * from local_media where assignment_local_id = ? order by captured_at`,
    assignmentId,
  );
  return rows.map(toMediaRecord);
}

/** Everything the sweep and the uploader work through: oldest first, acknowledged ones included. */
export async function listAllMedia(
  db: SQLite.SQLiteDatabase,
): Promise<ReadonlyArray<LocalMediaRecord>> {
  const rows = await db.getAllAsync<MediaRow>(`select * from local_media order by captured_at`);
  return rows.map(toMediaRecord);
}

export async function countPendingMedia(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `select count(*) as n from local_media where server_media_id is null`,
  );
  return row?.n ?? 0;
}

/**
 * The visit id a photograph belongs to, once `visit.start` has been acknowledged.
 *
 * Photographs taken before the acknowledgement wait with `visit_server_id` null; this is what
 * releases them, and it is called from the same place that patches queued commands with the id.
 */
export async function attachVisitToMedia(
  db: SQLite.SQLiteDatabase,
  assignmentId: string,
  visitServerId: string,
): Promise<void> {
  await db.runAsync(
    `update local_media set visit_server_id = ?
      where assignment_local_id = ? and visit_server_id is null`,
    visitServerId,
    assignmentId,
  );
}

export async function setMediaState(
  db: SQLite.SQLiteDatabase,
  localId: string,
  patch: {
    state?: LocalMediaRecord["state"];
    storedObjectId?: string | null;
    serverMediaId?: string | null;
    lastError?: string | null;
    bumpAttempt?: boolean;
  },
): Promise<void> {
  await db.runAsync(
    `update local_media set
       state = coalesce(?, state),
       stored_object_id = coalesce(?, stored_object_id),
       server_media_id = coalesce(?, server_media_id),
       last_error = ?,
       attempts = attempts + ?
     where local_id = ?`,
    patch.state ?? null,
    patch.storedObjectId ?? null,
    patch.serverMediaId ?? null,
    patch.lastError ?? null,
    patch.bumpAttempt ? 1 : 0,
    localId,
  );
}

/**
 * Forget a photograph whose file the sweep has already removed.
 *
 * Called only after the file is gone and only for a row `mayDeleteLocalFile` released, so the row
 * and the file disappear together rather than leaving one pointing at nothing.
 */
export async function forgetLocalMedia(db: SQLite.SQLiteDatabase, localId: string): Promise<void> {
  await db.runAsync(`delete from local_media where local_id = ?`, localId);
}
