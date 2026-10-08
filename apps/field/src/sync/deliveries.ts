import type * as SQLite from "expo-sqlite";

import { evidenceFailureKind, mayDeleteEvidenceFile } from "../core/delivery";
import {
  attachEvidenceObject,
  deliveriesAwaitingEvidence,
  listDeliveryAttempts,
  recordEvidenceFailure,
  releaseEvidenceFile,
  type LocalDeliveryRow,
} from "../db/repo-v4";
import {
  finalizeEvidenceUpload,
  putFileToProvider,
  requestEvidenceIntent,
  ServerError,
  TransportError,
} from "./api";

/**
 * Getting a delivery, and its photograph, from a phone to the server.
 *
 * ## The order, and why every step of it is load-bearing
 *
 * 1. the file is already in the application's own documents directory, written at the shutter;
 * 2. with a signal: **intent → PUT → finalize**, which yields a `storedObjectId`;
 * 3. the id is stored locally, so a lost response does not cost a second upload;
 * 4. the command is queued, naming that id;
 * 5. the outbox pushes it;
 * 6. the server acknowledges;
 * 7. **only then** the local photograph is deleted.
 *
 * Step 7 is the one that is easy to get wrong. Releasing the file at step 2 — the upload
 * succeeded, after all — would mean that a device which then failed at step 5 or 6 has a row
 * nobody accepted and no picture to try again with. Bytes being in a bucket is not the same
 * fact as the row existing, and the gap between them is exactly where somebody's evidence would
 * go. `mayDeleteEvidenceFile` is the predicate, and it names only `SYNCED` with a server id.
 *
 * A conflict never releases the file either: the attempt stays, marked *requires review*, with
 * the photograph a person will need in order to decide what happened.
 */

/**
 * Upload the photographs of attempts that are waiting for one.
 *
 * Each is independent: one failure does not stop the rest, because a technician with six
 * deliveries and one corrupt file should get five of them sent.
 */
export async function uploadPendingEvidence(
  db: SQLite.SQLiteDatabase,
  scope: { tenantSlug: string; projectSlug: string },
): Promise<{ uploaded: number; errors: number }> {
  const waiting = await deliveriesAwaitingEvidence(db);
  let uploaded = 0;
  let errors = 0;

  for (const attempt of waiting) {
    if (attempt.evidenceFileUri === null) continue;
    try {
      const intent = await requestEvidenceIntent({
        ...scope,
        // A name the server never stores in the key (ADR-031 §1); it is kept on the row where
        // reading it is authorized.
        filename: `entrega-${attempt.localId}.jpg`,
        mimeType: attempt.evidenceMimeType ?? "image/jpeg",
        sizeBytes: attempt.evidenceSizeBytes ?? 0,
      });
      await putFileToProvider({
        url: intent.url,
        headers: intent.headers,
        fileUri: attempt.evidenceFileUri,
      });
      const finalized = await finalizeEvidenceUpload({
        ...scope,
        intentId: intent.intentId,
        objectKey: intent.objectKey,
      });
      // Written before the command is formed: a device that dies here comes back with the id and
      // uploads nothing twice.
      await attachEvidenceObject(db, attempt.localId, finalized.storedObjectId);
      uploaded += 1;
    } catch (error) {
      errors += 1;
      /*
       * The file stays, always. What the failure decides is whether the **next sync** picks this
       * attempt up by itself: a transport failure or a 5xx does, a refusal does not and a person
       * looks instead. Retrying a refusal for ever is how a queue becomes permanently stuck on
       * something that can never succeed.
       */
      const kind = evidenceFailureKind({
        transport: error instanceof TransportError,
        status: error instanceof ServerError ? error.status : null,
      });
      await recordEvidenceFailure(db, attempt.localId, {
        kind,
        message:
          error instanceof TransportError || error instanceof ServerError
            ? error.message
            : "no se pudo subir la evidencia",
      });
    }
  }
  return { uploaded, errors };
}

/**
 * Delete the photographs of attempts the server has acknowledged, and nothing else.
 *
 * The sweep asks `mayDeleteEvidenceFile` for each one — the same predicate the repository
 * consults — so there is no path through this file that releases a file on any other grounds.
 */
export async function sweepAcknowledgedEvidence(
  db: SQLite.SQLiteDatabase,
): Promise<{ released: number }> {
  const all = await listDeliveryAttempts(db);
  let released = 0;
  for (const attempt of all) {
    if (attempt.evidenceFileUri === null) continue;
    if (!mayDeleteEvidenceFile(attempt)) continue;
    await deleteFile(attempt);
    if (await releaseEvidenceFile(db, attempt)) released += 1;
  }
  return { released };
}

/**
 * Remove the file itself. A failure is survivable: the row's pointer is cleared either way, and
 * an orphan file in the application's own directory costs disk and nothing else — whereas
 * keeping the pointer would make the device report pending evidence for ever.
 */
async function deleteFile(attempt: LocalDeliveryRow): Promise<void> {
  if (attempt.evidenceFileUri === null) return;
  try {
    const { deleteAsync } = await import("expo-file-system/legacy");
    await deleteAsync(attempt.evidenceFileUri, { idempotent: true });
  } catch {
    // Nothing to do and nothing to tell the technician: the server has the evidence.
  }
}

export { queueReadyDeliveries, settleDeliveryForCommand } from "./delivery-queue";
