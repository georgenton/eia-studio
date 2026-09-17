import type * as SQLite from "expo-sqlite";
import { randomUUID } from "expo-crypto";

import { mediaDeclareCommand } from "../core/commands";
import { deletableFiles, uploadOneMedia, type LocalMediaRow } from "../core/media-upload";
import {
  attachVisitToMedia,
  enqueue,
  forgetLocalMedia,
  insertLocalMedia,
  listAllMedia,
  setMediaState,
  type LocalMediaRecord,
} from "../db/repo";
import { fieldConfig } from "../config";
import { finalizeMediaUpload, putFileToProvider, requestMediaIntent } from "./api";

/**
 * The device's half of field media (ADR-032): capture it, get it off the phone, then — and only
 * then — let go of it.
 *
 * ## The order, and why it is this order
 *
 * 1. **Copy the file into the application's own directory, then write the row.** Before anything
 *    is attempted. A battery that dies between the shutter and the network leaves a file and a row
 *    the next launch picks up. Copying out of the picker's cache matters because that cache is the
 *    operating system's to clear.
 * 2. **Upload when there is a connection**: intent, PUT, finalize. Every failure keeps the file.
 * 3. **Queue `media.declare`** through the ordinary outbox, so it inherits the ordering, the
 *    backoff and the receipt machinery the other four commands already have.
 * 4. **Sweep** only files whose row the server acknowledged.
 *
 * ## What is not done, deliberately
 *
 * Nothing is re-encoded, resized or stripped. A photograph is evidence, and a device that silently
 * altered it would be producing something the technician did not take. EXIF handling belongs where
 * a file is *exported*, which is a surface this product does not have (SECURITY.md §7).
 */

export interface CaptureInput {
  readonly assignmentId: string;
  readonly visitServerId: string | null;
  /** Where the picker put it. Copied out of that directory before the row is written. */
  readonly sourceUri: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly kind: "parcel" | "affectation" | "access" | "other";
  readonly note: string | null;
  readonly location: { latitude: number; longitude: number; accuracyM: number | null } | null;
}

const MEDIA_DIRECTORY_NAME = "media";

/** Record a photograph. Returns its `localId`, which is what the server will key on for ever. */
export async function captureMedia(
  db: SQLite.SQLiteDatabase,
  input: CaptureInput,
): Promise<string> {
  const localId = randomUUID();
  const fileUri = await keepFile(input.sourceUri, localId, input.mimeType);
  await insertLocalMedia(db, {
    localId,
    assignmentLocalId: input.assignmentId,
    visitServerId: input.visitServerId,
    fileUri,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    kind: input.kind,
    note: input.note,
    latitude: input.location?.latitude ?? null,
    longitude: input.location?.longitude ?? null,
    accuracyM: input.location?.accuracyM ?? null,
  });
  return localId;
}

/**
 * Move the file out of whichever cache the picker used, into a directory this application owns.
 *
 * The picker's cache is cleared by the operating system on its own schedule, which for a
 * photograph waiting a week for signal is a deleted file and a row pointing at nothing.
 */
async function keepFile(sourceUri: string, localId: string, mimeType: string): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  const directory = `${FileSystem.documentDirectory ?? ""}${MEDIA_DIRECTORY_NAME}/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}${localId}${mimeType === "image/png" ? ".png" : ".jpg"}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

export interface MediaSyncOutcome {
  readonly uploaded: number;
  readonly queued: number;
  readonly pendingAfter: number;
  readonly error: string | null;
}

/**
 * Advance every photograph that can move, then queue its declaration.
 *
 * Runs **before** the outbox is drained, so a declaration formed here goes out in the same
 * synchronisation rather than waiting for the next one. It stops at the first transport failure:
 * a phone that just lost signal should not spend the technician's battery failing forty times.
 */
export async function uploadPendingMedia(
  db: SQLite.SQLiteDatabase,
  scope: { tenantSlug: string; projectSlug: string },
  appVersion: string,
): Promise<MediaSyncOutcome> {
  const rows = await listAllMedia(db);
  let uploaded = 0;
  let queued = 0;
  let error: string | null = null;

  for (const record of rows) {
    if (record.serverMediaId !== null) continue;
    const row = toRow(record);

    const step = await uploadOneMedia(row, {
      requestIntent: (input) => requestMediaIntent({ ...scope, ...input }),
      putFile: (input) => putFileToProvider(input),
      finalize: (input) => finalizeMediaUpload({ ...scope, ...input }),
    });

    if (step.kind === "hold") continue;
    if (step.kind === "retry") {
      await setMediaState(db, record.localId, {
        state: "PENDING_UPLOAD",
        lastError: step.detail,
        bumpAttempt: true,
      });
      error = step.detail;
      // One failure is the whole network being gone; the rest would fail the same way.
      break;
    }

    uploaded += 1;
    await setMediaState(db, record.localId, {
      state: "UPLOADING",
      storedObjectId: step.storedObjectId,
      lastError: null,
    });

    // Through the ordinary outbox: the declaration inherits the ordering, the backoff and the
    // receipt replay the other commands already have, rather than getting its own retry loop.
    const command = mediaDeclareCommand(
      {
        appVersion,
        deviceRevision: 0,
        occurredAt: new Date(record.capturedAt),
        newId: randomUUID,
      },
      {
        assignmentId: record.assignmentId,
        visitId: record.visitId!,
        localId: record.localId,
        storedObjectId: step.storedObjectId,
        kind: record.kind as CaptureInput["kind"],
        note: record.note,
        location:
          record.latitude === null || record.longitude === null
            ? null
            : {
                latitude: record.latitude,
                longitude: record.longitude,
                accuracyM: record.accuracyM,
                capturedAt: record.capturedAt,
              },
      },
    );
    await enqueue(db, { command, entityKind: "media", entityLocalId: record.localId });
    queued += 1;
  }

  const pending = (await listAllMedia(db)).filter((row) => row.serverMediaId === null).length;
  return { uploaded, queued, pendingAfter: pending, error };
}

/**
 * The server acknowledged a declaration: the photograph is kept, and the local file is not needed.
 *
 * Called from the outbox's settlement path, which is the only place that knows a `media.declare`
 * came back settled.
 */
export async function acknowledgeMedia(db: SQLite.SQLiteDatabase, localId: string): Promise<void> {
  // `server_media_id` is not on the wire (adding a field to a strict response would break an older
  // device), so the local id stands for it: what it records is *the server said yes*, which is the
  // fact `mayDeleteLocalFile` asks about.
  await setMediaState(db, localId, {
    state: "UPLOADED",
    serverMediaId: localId,
    lastError: null,
  });
}

/** A visit id arrived: photographs taken before it can now be declared. */
export async function attachVisit(
  db: SQLite.SQLiteDatabase,
  assignmentId: string,
  visitServerId: string,
): Promise<void> {
  await attachVisitToMedia(db, assignmentId, visitServerId);
}

/**
 * Remove local files the server has acknowledged.
 *
 * The one irreversible thing this feature does, so it is short, it asks the domain's predicate
 * rather than its own, and it deletes the row only after the file is gone.
 */
export async function sweepUploadedMedia(db: SQLite.SQLiteDatabase): Promise<number> {
  const rows = await listAllMedia(db);
  const releasable = deletableFiles(rows.map(toRow));
  if (releasable.length === 0) return 0;

  const FileSystem = await import("expo-file-system/legacy");
  let removed = 0;
  for (const row of releasable) {
    try {
      await FileSystem.deleteAsync(row.fileUri, { idempotent: true });
      await forgetLocalMedia(db, row.localId);
      removed += 1;
    } catch {
      // A file the platform would not delete stays, with its row. Retried next sweep; never
      // forgotten while it is still on disk.
    }
  }
  return removed;
}

function toRow(record: LocalMediaRecord): LocalMediaRow {
  return {
    localId: record.localId,
    assignmentId: record.assignmentId,
    visitId: record.visitId,
    fileUri: record.fileUri,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    state: record.state,
    storedObjectId: record.storedObjectId,
    serverMediaId: record.serverMediaId,
    attempts: record.attempts,
  };
}

/** The version string the commands carry, read once from the build's own configuration. */
export function appVersion(): string {
  return fieldConfig().appVersion;
}
