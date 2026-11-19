import {
  countPendingWork,
  hasPendingWork,
  PENDING_KINDS,
  type PendingWorkSummary,
} from "./project-switch";

/**
 * Whether this device may sign out, which on this application means **delete the local database**.
 *
 * ## Why the rule is written down rather than left in the screen
 *
 * Signing out discards the session *and* everything captured on the device, because work left on a
 * phone that can no longer sync it is work nobody will ever receive. That makes it the one
 * destructive action here, and the guard in front of it is a safety property, not a nicety — so it
 * is a value that can be asserted, the same way `decideProjectSwitch` is.
 *
 * ## What the guard used to miss
 *
 * It asked whether the command queue held anything in state `PENDING`, and it asked the number the
 * screen happened to be holding. Both are too narrow:
 *
 *   - a command that **failed** is not `PENDING`;
 *   - a captured draft that never produced a command is not in the outbox at all;
 *   - a **photograph** waiting to upload lives in `local_media`, which the outbox knows nothing
 *     about;
 *   - and a count read earlier is not a count now — a capture can land between the refresh and
 *     the tap.
 *
 * Changing project already refused on the full summary. The *more* destructive action was behind
 * the *weaker* check, which is the wrong way round.
 *
 * ## What it still allows
 *
 * A device holding nothing signs out normally. The guard exists to protect unsent work, not to
 * trap a technician on a phone they have finished with.
 */
export type SignOutDecision =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "blocked";
      /** Which kinds are holding it up, so the refusal can name them rather than just refuse. */
      readonly blocking: ReadonlyArray<(typeof PENDING_KINDS)[number]>;
      /** Everything unsent, across kinds — what a technician is actually about to lose. */
      readonly total: number;
    };

export function decideSignOut(pending: PendingWorkSummary): SignOutDecision {
  if (!hasPendingWork(pending)) return { kind: "allowed" };
  return {
    kind: "blocked",
    blocking: PENDING_KINDS.filter((kind) => pending[kind] > 0),
    total: countPendingWork(pending),
  };
}
