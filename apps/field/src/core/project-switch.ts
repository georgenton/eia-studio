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

/**
 * Everything the device is still holding, across every kind.
 *
 * One function, because three places used to answer this question and two of them answered it
 * with `sync_outbox` alone: the sign-out guard (fixed by counting the full summary) and the
 * "Todo sincronizado" chip, which told a technician their day had been delivered while a
 * photograph was still on the phone. A number a technician trusts to decide whether they may walk
 * away from a parcel is not a number two screens may compute differently.
 */
export function countPendingWork(pending: PendingWorkSummary): number {
  return PENDING_KINDS.reduce((total, kind) => total + pending[kind], 0);
}

/**
 * The kinds an automatic attempt could actually move **right now**.
 *
 * ## Why this is not `countPendingWork`
 *
 * They answer different questions, and conflating them produced a device that synchronised
 * without stopping. `countPendingWork` answers *what is this phone still holding?* — the number a
 * technician reads and the number the sign-out refusal protects. It therefore counts work that is
 * on the device for ever until a **person** acts: an order the server refused, a delivery that
 * needs review, a draft nobody has submitted.
 *
 * The automatic trigger needs the other question: *is there anything a request would deliver?*
 * Asking the first one made the answer permanently yes — the attempt ran, changed nothing,
 * finished, and the effect fired again. Observed on the emulator on 19 November 2026: one saved
 * draft, an empty queue, and *Sincronizando…* on screen with the last-sync time advancing every
 * few seconds with nobody touching the phone.
 *
 * ## What is in, and what is deliberately out
 *
 * In: queued commands, photographs of visits and delivery photographs — bytes and intents the
 * next request can carry.
 *
 * Out: `outboxFailed`, because the server **answered and refused**, and a decision does not change
 * by being asked again (TD-128). Out: `unsyncedSurveys`, because a draft is either already in the
 * queue — and then `outboxPending` counts it — or it is a draft nobody submitted, which no number
 * of requests will send. Out: `unsettledDeliveries`, for the same reason the sync centre keeps
 * showing them: `REQUIRES_REVIEW` needs a person, not a retry.
 *
 * All four stay in `countPendingWork`. Nothing stops being shown, and nothing stops blocking
 * sign-out; they just stop starting requests that cannot help.
 */
export function retryableNow(pending: PendingWorkSummary): number {
  return pending.outboxPending + pending.pendingMedia + pending.pendingEvidence;
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
