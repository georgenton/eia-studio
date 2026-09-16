import { type CommandOutcome, type LocalSurveyState } from "@eia/field-sync-contract";

/**
 * What a survey is doing on this device, and the one distinction the whole application exists to
 * keep honest: **`READY_TO_SYNC` is not `SYNCED`.**
 *
 * A technician who has pressed *Enviar* has finished their part; the server has not necessarily
 * heard about it, and may not for hours. Blurring those two is how field data quietly disappears —
 * somebody sees "enviada", closes the app, wipes the phone, and nobody knows until the tabulation
 * is short. So the vocabulary keeps them apart, the list screen shows which one a row is in, and
 * only a server acknowledgement moves a survey to `SYNCED`.
 *
 * Every transition is a pure function of the current state and one event, so the rules can be
 * tested on a laptop with no device, no database and no network.
 */
export type SurveyEvent =
  | { readonly kind: "edited" }
  | { readonly kind: "submitted_locally" }
  | { readonly kind: "sync_started" }
  | { readonly kind: "sync_acknowledged" }
  | { readonly kind: "sync_failed" }
  | { readonly kind: "conflict"; readonly reason: string };

const TRANSITIONS: Readonly<Record<LocalSurveyState, ReadonlyArray<SurveyEvent["kind"]>>> = {
  NOT_STARTED: ["edited"],
  DRAFT: ["edited", "submitted_locally", "sync_started", "sync_failed", "conflict"],
  // A locally submitted survey is **not** editable: `edited` is absent on purpose, and
  // `assertLocallyEditable` is what the screens ask before offering a field.
  READY_TO_SYNC: ["sync_started", "sync_acknowledged", "sync_failed", "conflict"],
  SYNCING: ["sync_acknowledged", "sync_failed", "conflict"],
  // Terminal for this wave. A correction is a reviewed workflow the domain does not have yet
  // (TD-060 territory), not a quiet reopen on a phone.
  SYNCED: [],
  SYNC_ERROR: ["sync_started", "sync_acknowledged", "conflict", "edited"],
  CONFLICT: [],
};

export class InvalidSurveyTransition extends Error {
  constructor(
    readonly from: LocalSurveyState,
    readonly event: SurveyEvent["kind"],
  ) {
    super(`a local survey cannot go from ${from} on ${event}`);
    this.name = "InvalidSurveyTransition";
  }
}

export function canApply(from: LocalSurveyState, event: SurveyEvent["kind"]): boolean {
  return TRANSITIONS[from].includes(event);
}

export function nextSurveyState(from: LocalSurveyState, event: SurveyEvent): LocalSurveyState {
  if (!canApply(from, event.kind)) throw new InvalidSurveyTransition(from, event.kind);
  switch (event.kind) {
    case "edited":
      return "DRAFT";
    case "submitted_locally":
      return "READY_TO_SYNC";
    case "sync_started":
      return "SYNCING";
    case "sync_acknowledged":
      // Only an acknowledgement produces SYNCED, and only from a state that was actually sent.
      return from === "SYNCING" || from === "READY_TO_SYNC" || from === "SYNC_ERROR"
        ? "SYNCED"
        : from;
    case "sync_failed":
      return "SYNC_ERROR";
    case "conflict":
      return "CONFLICT";
  }
}

/** Whether a screen may offer a field at all. The answer for a sent survey is no. */
export function isLocallyEditable(state: LocalSurveyState): boolean {
  return state === "NOT_STARTED" || state === "DRAFT" || state === "SYNC_ERROR";
}

/** Whether the outbox still owes the server something for this survey. */
export function isPendingSync(state: LocalSurveyState): boolean {
  return state === "READY_TO_SYNC" || state === "SYNCING" || state === "SYNC_ERROR";
}

/**
 * Map a server outcome onto the local state machine.
 *
 * `superseded` becomes `SYNCED`, which is the subtle one and deserves saying plainly: the server
 * is telling the device *this intent no longer applies, and the work it described is already
 * accounted for* — a draft that arrived behind its own submit, or a revision older than one
 * already stored. Treating that as an error would leave the queue retrying something that can
 * never succeed, which is how an outbox becomes permanently stuck.
 */
export function stateForOutcome(from: LocalSurveyState, outcome: CommandOutcome): LocalSurveyState {
  switch (outcome) {
    case "applied":
    case "duplicate":
    case "superseded":
      return canApply(from, "sync_acknowledged")
        ? nextSurveyState(from, { kind: "sync_acknowledged" })
        : from;
    case "conflict":
      return canApply(from, "conflict") ? "CONFLICT" : from;
    case "rejected":
      return canApply(from, "sync_failed") ? "SYNC_ERROR" : from;
  }
}
