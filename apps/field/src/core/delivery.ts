import type {
  CommandOutcome,
  LocalDeliveryState,
  SocializationDeliveryPayload,
} from "@eia/field-sync-contract";

/**
 * What the device believes about one delivery, and what the server's answer does to it.
 *
 * ## The rule the whole file is for
 *
 * **Nothing here deletes a technician's work.** Not a conflict, not a rejection, not a
 * reassignment that happened while the phone was in a valley. The worst outcome is
 * `REQUIRES_REVIEW`, which keeps the attempt *and its photograph* and puts it in front of a
 * person. A technician who walked to a gate, took a picture and wrote a note must never open the
 * application to find it gone because the server said no.
 *
 * ## Why the file release is the last step
 *
 * The local photograph is deleted when the **command** is acknowledged — never when the upload
 * returns 200. Bytes being in a bucket is not the same fact as the row existing, and the gap
 * between them is exactly where a lost response would cost somebody their evidence. This mirrors
 * `mayDeleteLocalFile` for field media (ADR-032) and exists for the same reason.
 */

/** A delivered invitation needs a photograph. Everything else records that nothing was delivered. */
export function requiresEvidence(outcome: SocializationDeliveryPayload["outcome"]): boolean {
  return outcome === "DELIVERED";
}

export interface LocalDeliveryFacts {
  readonly outcome: SocializationDeliveryPayload["outcome"];
  readonly evidenceFileUri: string | null;
  readonly evidenceStoredObjectId: string | null;
}

/**
 * Can this attempt be saved at all?
 *
 * Checked on the device as well as on the server, because the server is hours away: a technician
 * standing at a gate must be told *now* that a delivered invitation needs a photograph, not when
 * the valley ends.
 */
export function canSaveDelivery(facts: LocalDeliveryFacts): boolean {
  if (!requiresEvidence(facts.outcome)) return true;
  return facts.evidenceFileUri !== null;
}

/** Where an attempt sits the moment it is saved, before anything has been sent. */
export function initialDeliveryState(facts: LocalDeliveryFacts): LocalDeliveryState {
  if (requiresEvidence(facts.outcome) && facts.evidenceStoredObjectId === null) {
    // There is a file and it has not reached the provider yet. The command cannot be formed.
    return "EVIDENCE_PENDING";
  }
  return "READY_TO_SYNC";
}

/**
 * What the server's answer means for the row.
 *
 * `applied` and `duplicate` are the same thing from the device's side — the server has it — and
 * that is the only state in which the local photograph may go. `conflict` and `rejected` are
 * terminal for the *queue* and not for the *record*: the outbox stops retrying, the row stays,
 * and the screen says it needs review. Anything else is a transport failure and is retried.
 */
export function deliveryStateAfter(outcome: CommandOutcome): LocalDeliveryState {
  switch (outcome) {
    case "applied":
    case "duplicate":
      return "SYNCED";
    case "conflict":
    case "rejected":
    case "superseded":
      return "REQUIRES_REVIEW";
  }
}

/**
 * The one predicate that may delete a photograph of a delivery.
 *
 * `SYNCED` and nothing else. Not "the PUT returned 200", not "finalize answered", not "the
 * outbox is empty" — the server acknowledged the command that created the row the photograph is
 * evidence for.
 */
export function mayDeleteEvidenceFile(attempt: {
  readonly state: LocalDeliveryState;
  readonly serverAttemptId: string | null;
}): boolean {
  return attempt.state === "SYNCED" && attempt.serverAttemptId !== null;
}

/** Work the device is still holding on somebody's behalf, by state. */
export const UNSETTLED_DELIVERY_STATES: ReadonlyArray<LocalDeliveryState> = [
  "SAVED",
  "EVIDENCE_PENDING",
  "READY_TO_SYNC",
  "SYNCING",
  "SYNC_ERROR",
  "REQUIRES_REVIEW",
];

export function isUnsettled(state: LocalDeliveryState): boolean {
  return state !== "SYNCED";
}
