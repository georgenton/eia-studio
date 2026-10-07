import {
  FIELD_PACK_SCHEMA_VERSION_V4,
  FIELD_SYNC_PROTOCOL_VERSION_V4,
  type SocializationDeliveryCommand,
} from "@eia/field-sync-contract";
import type * as SQLite from "expo-sqlite";

import { deliveriesReadyToQueue, setDeliveryCommandId, settleDelivery } from "../db/repo-v4";

/**
 * Forming a delivery command, and settling it.
 *
 * Its own module, beside `deliveries.ts`, because it depends on **nothing that needs a device**:
 * the local database, the contract, and two values the caller passes in. That is what lets the
 * rules below be exercised against a real SQLite in an ordinary test run, rather than only on a
 * handset — and those rules are where a duplicate attempt or a lost photograph would come from.
 *
 * `appVersion` and `newId` are arguments for the same reason, and the first follows the shape
 * `uploadPendingMedia` already uses. A build must report its own version, and `randomUUID` is
 * `expo-crypto`'s on the device because `globalThis.crypto` is not available on every React
 * Native runtime this application targets.
 */
/**
 * Form the command for every attempt that has everything it needs.
 *
 * `commandId` is minted here, once, and stored on the row: a retry of the push re-sends the same
 * id, and the server replays its own answer rather than recording a second attempt. The second,
 * independent guarantee is `localAttemptId`, which the server keys on — so even a device that
 * lost its outbox and re-queued cannot produce two rows.
 */
export async function queueReadyDeliveries(
  db: SQLite.SQLiteDatabase,
  enqueueCommand: (command: SocializationDeliveryCommand, localId: string) => Promise<void>,
  /**
   * Injected rather than imported, for the reason every other id in this application is:
   * `globalThis.crypto.randomUUID` is not available on every React Native runtime this build
   * targets, and the rest of the app already reaches for `expo-crypto`. The engine passes
   * `Crypto.randomUUID`; a test passes a counter.
   */
  newId: () => string,
  /** This build's own version, passed in rather than read: see the note above. */
  appVersion: string,
): Promise<number> {
  const ready = await deliveriesReadyToQueue(db);
  let queued = 0;
  for (const attempt of ready) {
    const commandId = newId();
    const command: SocializationDeliveryCommand = {
      commandId,
      protocolVersion: FIELD_SYNC_PROTOCOL_VERSION_V4,
      deviceRevision: 1,
      occurredAt: attempt.occurredAt,
      appVersion,
      packSchemaVersion: FIELD_PACK_SCHEMA_VERSION_V4,
      type: "socialization.delivery.record",
      payload: {
        invitationId: attempt.invitationId,
        // The revision the device read when the technician saved, not the one it holds now: that
        // is what makes a reassignment in between a conflict rather than a silent overwrite.
        invitationRevision: attempt.invitationRevision,
        localAttemptId: attempt.localId,
        outcome: attempt.outcome,
        note: attempt.note,
        location:
          attempt.latitude === null || attempt.longitude === null
            ? null
            : {
                latitude: attempt.latitude,
                longitude: attempt.longitude,
                accuracyM: attempt.accuracyM,
                capturedAt: attempt.occurredAt,
              },
        storedObjectId: attempt.evidenceStoredObjectId,
      },
    };
    await setDeliveryCommandId(db, attempt.localId, commandId);
    await enqueueCommand(command, attempt.localId);
    queued += 1;
  }
  return queued;
}

/**
 * Apply what the server said about one delivery command.
 *
 * Looked up by `command_id` rather than passed in, because the outbox settles commands and does
 * not know what a delivery is. The state transition is `deliveryStateAfter`'s, in one place.
 */
export async function settleDeliveryForCommand(
  db: SQLite.SQLiteDatabase,
  commandId: string,
  result: {
    outcome: "applied" | "duplicate" | "superseded" | "conflict" | "rejected";
    attemptId: string | null;
    conflictReason: string | null;
    message: string | null;
  },
): Promise<void> {
  const row = await db.getFirstAsync<{ local_id: string }>(
    "select local_id from local_delivery_attempt where command_id = ?",
    commandId,
  );
  if (!row) return;
  await settleDelivery(db, row.local_id, result);
}
