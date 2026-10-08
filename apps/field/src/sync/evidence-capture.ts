import type * as SQLite from "expo-sqlite";

import { offlineAccessState } from "@eia/domain/mobile";

import {
  canSaveDelivery,
  initialDeliveryState,
  InvitationNoLongerCapturable,
  mayRecordDelivery,
  OfflineWorkExpired,
} from "../core/delivery";
import { readInvitation, readWorkPack, saveDeliveryAttempt } from "../db/repo-v4";

/**
 * Saving what happened at a gate, with its photograph, before any network is involved.
 *
 * The order is the one `media.ts` established for a visit's photograph (ADR-032) and it is the
 * same order for the same reason: **the file is copied into the application's own directory
 * before the row is written**. The picker's cache belongs to the operating system, which clears
 * it on its own schedule — for a photograph waiting a week for signal that is a deleted file and
 * a row pointing at nothing.
 *
 * It is a separate directory and a separate table from field media, and the separation is not
 * tidiness: a delivery photograph is evidence of a **convocation**, lives in the
 * `socialization-evidence` namespace, and must not be reachable by a query written for a visit's
 * photographs or by anything public (ADR-041). Pretending it is a `field_media` row would undo
 * that in one line.
 *
 * Nothing is re-encoded, resized or stripped. A device that silently altered evidence would be
 * producing something the technician did not take.
 */

const EVIDENCE_DIRECTORY_NAME = "socialization-evidence";

export interface SaveDeliveryAttemptInput {
  /**
   * Injected, like every other id in this application: `expo-crypto` is a native module, and a
   * module that imports it at the top level cannot be loaded by anything but a device — which
   * would put the guard below out of reach of the test suite. The screen passes
   * `Crypto.randomUUID`.
   */
  readonly newId: () => string;
  readonly invitationId: string;
  /** Read from the pack at the moment of saving; a later reassignment is then a conflict. */
  readonly invitationRevision: number;
  readonly outcome: "DELIVERED" | "ABSENT" | "REFUSED" | "OTHER";
  readonly note: string | null;
  readonly location: { latitude: number; longitude: number; accuracyM: number | null } | null;
  /** Where the camera put it. Copied out before the row exists. */
  readonly photo: { sourceUri: string; mimeType: string; sizeBytes: number } | null;
  /** Injected so the expiry guard below is testable at a chosen instant. */
  readonly now?: Date;
}

export class DeliveryNeedsPhotograph extends Error {
  constructor() {
    super("a delivered invitation needs a photograph");
    this.name = "DeliveryNeedsPhotograph";
  }
}

/**
 * Record the attempt locally. Needs no connection, and starts no upload.
 *
 * Returns the `localAttemptId`, which is minted here, once, and is what the server keys on for
 * ever — so a retry after a reinstalled outbox is still one attempt.
 */
export async function saveDelivery(
  db: SQLite.SQLiteDatabase,
  input: SaveDeliveryAttemptInput,
): Promise<string> {
  /*
   * Under the UI, not only in it. The screen hides the controls for an invitation this device
   * knows is revoked; this is the check that holds when the screen is wrong — a stale props
   * read, a race with a pull that finished mid-form, a future caller.
   *
   * It blocks only a **new** capture. An attempt made before the revocation arrived keeps its
   * row and its photograph and goes to the server, which answers conflict.
   */
  /*
   * The window the server stamped governs **all** of this pack's offline work, invitations
   * included. Read here rather than taken from the caller: a screen's idea of the expiry is a
   * value rendered minutes ago, and this is the last moment before a row exists.
   *
   * No pack at all is the same answer — there is nothing standing behind a capture.
   */
  const workPack = await readWorkPack(db);
  const now = input.now ?? new Date();
  if (
    workPack === null ||
    offlineAccessState({ now, expiresAt: new Date(workPack.validity.expiresAt) }) === "expired"
  ) {
    throw new OfflineWorkExpired();
  }

  const invitation = await readInvitation(db, input.invitationId);
  if (invitation === null || !mayRecordDelivery(invitation)) {
    throw new InvitationNoLongerCapturable();
  }

  const facts = {
    outcome: input.outcome,
    evidenceFileUri: input.photo === null ? null : input.photo.sourceUri,
    evidenceStoredObjectId: null,
  };
  // Refused here as well as on the server, because the technician is standing at a gate and the
  // valley will not end for hours.
  if (!canSaveDelivery(facts)) throw new DeliveryNeedsPhotograph();

  const localId = input.newId();
  const evidence =
    input.photo === null
      ? null
      : {
          fileUri: await keepEvidenceFile(input.photo.sourceUri, localId, input.photo.mimeType),
          mimeType: input.photo.mimeType,
          sizeBytes: input.photo.sizeBytes,
        };

  await saveDeliveryAttempt(db, {
    localId,
    invitationId: input.invitationId,
    invitationRevision: input.invitationRevision,
    outcome: input.outcome,
    occurredAt: new Date().toISOString(),
    note: input.note,
    location: input.location,
    evidence,
    state: initialDeliveryState({ ...facts, evidenceFileUri: evidence?.fileUri ?? null }),
  });
  return localId;
}

async function keepEvidenceFile(
  sourceUri: string,
  localId: string,
  mimeType: string,
): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  const directory = `${FileSystem.documentDirectory ?? ""}${EVIDENCE_DIRECTORY_NAME}/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}${localId}${mimeType === "image/png" ? ".png" : ".jpg"}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}
