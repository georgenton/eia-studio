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

/**
 * Whether this device may still record an attempt against an invitation.
 *
 * ## The distinction this draws, and why it is not the conflict path
 *
 * A technician captures offline, the invitation is reassigned while they are in a valley, and
 * the sync answers **conflict**: the attempt and its photograph are kept and a person looks.
 * That is correct and nothing here changes it — the device could not have known.
 *
 * This is the other case. The device has *already pulled* the revocation: it knows the
 * invitation is no longer this technician's, or that it is settled, and the screen is showing
 * that. Letting somebody walk to a gate, take a photograph and save an attempt that is
 * guaranteed to come back as a conflict is not resilience, it is wasting their morning.
 *
 * So a known revocation blocks a **new** capture. It never touches an existing one.
 */
export function mayRecordDelivery(invitation: {
  readonly revoked: boolean;
  readonly serverStatus: string;
}): boolean {
  if (invitation.revoked) return false;
  // `DELIVERED`, `REFUSED` and `CANCELLED` are settled; only `PENDING` is still work.
  return invitation.serverStatus === "PENDING";
}

export class InvitationNoLongerCapturable extends Error {
  constructor() {
    super("this invitation is no longer yours to deliver");
    this.name = "InvitationNoLongerCapturable";
  }
}

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

/**
 * Why an evidence upload failed, and therefore whether the next sync picks it up again.
 *
 * The distinction is the whole of offline behaviour, and it was missing: a network cut during
 * the first upload left the attempt in `SYNC_ERROR`, and the selector only looked at
 * `EVIDENCE_PENDING` — so a photograph taken in a valley would wait for somebody to notice.
 *
 * `retryable` means *the server was not there*: no connection, a timeout, a 5xx. The attempt
 * goes back to `EVIDENCE_PENDING` with its file, its counter raised, and the next sync takes it.
 * `permanent` means the server answered and refused — the bytes are not what was declared, the
 * authorisation expired, the format is not accepted. Retrying that forever is how a queue
 * becomes permanently stuck, so the attempt stops and a person sees it.
 *
 * Neither deletes the photograph. Nothing does, until the command is acknowledged.
 */
export type EvidenceFailureKind = "retryable" | "permanent";

export function evidenceFailureKind(input: {
  readonly transport: boolean;
  readonly status: number | null;
}): EvidenceFailureKind {
  // No response at all: DNS, TCP, TLS, timeout, aeroplane mode.
  if (input.transport) return "retryable";
  if (input.status === null) return "retryable";
  // 5xx is the server having a bad day, not a decision about this file. 429 likewise.
  if (input.status >= 500 || input.status === 408 || input.status === 429) return "retryable";
  // 503 from our own routes means storage is not configured in this deployment (ADR-031 §5) —
  // a state, not this technician's problem, and one that a later deployment fixes.
  return "permanent";
}

/** Where a failed upload leaves the row, so the next sync knows whether to look at it. */
export function stateAfterEvidenceFailure(kind: EvidenceFailureKind): LocalDeliveryState {
  return kind === "retryable" ? "EVIDENCE_PENDING" : "SYNC_ERROR";
}

/**
 * An upload the device will try again on its own.
 *
 * `SYNC_ERROR` is deliberately absent: it is the state a *permanent* refusal leaves, and a
 * technician has to look at it. That is what stops the loop.
 */
export const RETRYABLE_EVIDENCE_STATES: ReadonlyArray<LocalDeliveryState> = ["EVIDENCE_PENDING"];

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
