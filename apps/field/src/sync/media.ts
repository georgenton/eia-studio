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
  settleAbandonedMediaLocations,
  pendingCommandExists,
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
  /**
   * Whether the caller is going to ask the platform where the device is.
   *
   * The location is **not** an input any more. It arrives afterwards through
   * `attachMediaLocation`, because the file has to be out of the camera's cache before anything
   * that can block is attempted — see the ordering note on `capture` in
   * `screens/assignment.tsx`.
   */
  readonly locationIntent: "will_ask" | "will_not_ask";
}

const MEDIA_DIRECTORY_NAME = "media";

/**
 * This run of the application, for the one question a synchronisation has to be able to answer:
 * *is somebody still waiting for this photograph's position?*
 *
 * Minted once at module load and never regenerated, so every capture in this process shares it and
 * every row left by a previous process is distinguishable from them. A device that is force-stopped
 * mid-request gets a new one on relaunch, which is exactly the signal that the old request is gone.
 *
 * It is not an identifier of anything outside the device and never leaves it.
 */
export const LOCATION_SESSION = randomUUID();

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
    locationOutcome: input.locationIntent === "will_ask" ? "pending" : "not_attempted",
    locationSession: LOCATION_SESSION,
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
  /*
   * Settle the photographs **nobody is waiting for any more**, before reading the list.
   *
   * Scoped to other runs of the application. The first version of this settled every `pending`
   * row, which took the position out from under a capture whose request was still in flight: the
   * answer arrived a second later and updated nothing. A photograph still waiting in *this*
   * process is left alone and skipped by the loop below; its own bounded request settles it.
   */
  await settleAbandonedMediaLocations(db, LOCATION_SESSION);

  const rows = await listAllMedia(db);
  let uploaded = 0;
  let queued = 0;
  let error: string | null = null;

  for (const record of rows) {
    if (record.serverMediaId !== null) continue;
    /*
     * A capture happening *right now*, elsewhere in the application, between its insert and its
     * location. Delivering it here would declare the photograph without the coordinates the device
     * is about to write, and those coordinates would then exist only on the phone. The next
     * synchronisation, seconds later, picks it up.
     */
    if (record.locationOutcome === "pending") continue;
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
      /*
       * **Keep going.** This used to `break`, on the reasoning that one failure is the whole
       * network being gone and the rest would fail the same way. That is true of a lost signal and
       * false of a single bad file — and in the second case the first photograph permanently
       * blocked every one behind it, including the ones that would have uploaded. Since a
       * visit-closing command is now held while *any* photograph of that visit is undelivered
       * (`core/outbox-policy.ts`), one unuploadable file would have held a ficha for ever.
       *
       * The cost is bounded: a device holds a day's photographs, not a backlog, and the sync
       * button is disabled while offline, so the no-signal case is rare rather than routine.
       */
      continue;
    }

    uploaded += 1;
    await setMediaState(db, record.localId, {
      state: "UPLOADING",
      storedObjectId: step.storedObjectId,
      lastError: null,
    });

    /*
     * One order per photograph in the queue at a time. This loop runs on every synchronisation,
     * so a declaration still waiting used to gain an identical twin each time — harmless to the
     * data, because `localId` is unique, and ruinous to a count a technician is asked to trust.
     *
     * A `FAILED` order does not block a new one: that is how a refusal the server has since
     * stopped giving gets a second chance.
     */
    if (await pendingCommandExists(db, "media", record.localId)) continue;

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
        /*
         * The provenance of the attempt, straight from the row.
         *
         * `pending` cannot reach here — the loop above skips those rows, and the compiler has
         * narrowed the type accordingly — so there is no case to map. The three travel as
         * **optional** fields, which is why an installed build that predates them keeps working
         * unchanged: a `.strict()` payload refuses unknown fields, not absent ones. They are
         * omitted rather than sent as `undefined` because `exactOptionalPropertyTypes` draws that
         * distinction, and so does the server: absent means unknown.
         */
        locationOutcome: record.locationOutcome,
        ...(record.locationMocked === null ? {} : { locationMocked: record.locationMocked }),
        ...(record.locationSource === null ? {} : { locationSource: record.locationSource }),
        /*
         * `wireLocationSchema.capturedAt` is the moment the **position** was obtained, which is
         * not the moment the shutter fired. It used to be sent as `record.capturedAt` — the
         * photograph's own timestamp — which quietly asserted the fix was simultaneous with the
         * photograph. It is not: the device persists the file first and asks the platform
         * afterwards, so the two are seconds apart by design. `locatedAt` is the measured one.
         */
        location:
          record.latitude === null || record.longitude === null
            ? null
            : {
                latitude: record.latitude,
                longitude: record.longitude,
                accuracyM: record.accuracyM,
                capturedAt: record.locatedAt ?? record.capturedAt,
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
