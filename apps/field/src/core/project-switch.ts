/**
 * Changing which road this phone is working on.
 *
 * ## One project offline at a time, and why
 *
 * A second downloaded pack is a second answer to "which study am I in?", and a technician who
 * opens the application in a valley must not have to choose between two. Holding one is also the
 * only arrangement in which *everything local belongs to the project on screen* — which is what
 * makes "you have unsynced work" a sentence the application can say truthfully.
 *
 * So: the switch happens **online**, it is refused while anything is unsynced, and the new pack
 * is downloaded and validated in full **before** the old one is touched. A failed download leaves
 * the device exactly as it was.
 *
 * ## Why it blocks rather than merges
 *
 * The alternative is uploading the pending work first, automatically, on the technician's behalf.
 * That is a sync a person did not ask for, at a moment they are thinking about something else,
 * and if it conflicts they are reading a conflict about yesterday's road while standing on
 * today's. Blocking with a list of what is pending is slower and leaves the decision where it
 * belongs.
 */

export interface PendingWorkSummary {
  /** Commands the outbox has not settled. */
  readonly outboxPending: number;
  /** Commands the outbox gave up on; they need a person, not a retry. */
  readonly outboxFailed: number;
  /** Surveys captured locally and not yet on the server. */
  readonly unsyncedSurveys: number;
  /** Photographs of visits whose local file has not been released. */
  readonly pendingMedia: number;
  /** Delivery attempts in any state but `SYNCED`. */
  readonly unsettledDeliveries: number;
  /** Delivery photographs the server has not acknowledged a command for. */
  readonly pendingEvidence: number;
}

export const EMPTY_PENDING: PendingWorkSummary = {
  outboxPending: 0,
  outboxFailed: 0,
  unsyncedSurveys: 0,
  pendingMedia: 0,
  unsettledDeliveries: 0,
  pendingEvidence: 0,
};

/** Every kind of pending work, in the order a person would want to read it. */
export const PENDING_KINDS = [
  "outboxPending",
  "outboxFailed",
  "unsyncedSurveys",
  "pendingMedia",
  "unsettledDeliveries",
  "pendingEvidence",
] as const;
export type PendingKind = (typeof PENDING_KINDS)[number];

export type ProjectSwitchDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "blocked"; readonly blocking: ReadonlyArray<PendingKind> }
  | { readonly kind: "offline" };

/**
 * May this device change project right now?
 *
 * Three answers and no fourth. `offline` is separate from `blocked` because they ask different
 * things of the technician: one is "find a signal", the other is "sync what you have". Telling
 * somebody with a clean device that they have pending work, or somebody with pending work that
 * they need a signal, sends them to solve the wrong problem.
 */
export function decideProjectSwitch(input: {
  readonly online: boolean;
  readonly pending: PendingWorkSummary;
}): ProjectSwitchDecision {
  const blocking = PENDING_KINDS.filter((kind) => input.pending[kind] > 0);
  // Pending work first: a technician with unsynced captures needs a signal *and* a sync, and the
  // more specific instruction is the useful one.
  if (blocking.length > 0) return { kind: "blocked", blocking };
  if (!input.online) return { kind: "offline" };
  return { kind: "allowed" };
}

export function hasPendingWork(pending: PendingWorkSummary): boolean {
  return PENDING_KINDS.some((kind) => pending[kind] > 0);
}

/**
 * The order the switch itself must happen in.
 *
 * Written down as a value rather than left implicit in a function body, because the ordering
 * *is* the safety property: the old pack is replaced only after the new one exists and parses.
 * A download that fails at step 2 leaves a device that still knows which road it is on.
 */
export const PROJECT_SWITCH_STEPS = [
  "verify-nothing-pending",
  "download-new-pack",
  "validate-new-pack",
  "replace-active-project",
  "clear-previous-project-snapshots",
] as const;
export type ProjectSwitchStep = (typeof PROJECT_SWITCH_STEPS)[number];

/** What survives a switch: the device's own preferences, never another project's work. */
export const PRESERVED_META_KEYS: ReadonlyArray<string> = ["locale", "last_sync_at", "app_version"];
