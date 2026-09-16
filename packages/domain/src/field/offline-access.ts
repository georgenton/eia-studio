import { z } from "zod";

/**
 * How long a device may keep capturing with no server contact (Production V1, Wave 1).
 *
 * ## The limitation, stated first
 *
 * A device with no connectivity **cannot** learn that an account was suspended, that a technician
 * left the firm, or that an assignment was reassigned. Nothing in any design fixes that; it is a
 * property of being disconnected. Revocation therefore takes effect at the next server contact,
 * and the honest thing a product can do is make the disconnected window **short, explicit and
 * visible** rather than pretend it is enforcing something it is not.
 *
 * ## Why the window is derived and not invented
 *
 * A number chosen for comfort — "thirty days offline" — is a decision about how long a revoked
 * technician may keep collecting data in the firm's name. So the window is derived from the
 * session that produced the Field Pack: it can never outlive the authenticated session, and it is
 * additionally capped, because a session lifetime is a convenience decision made for a browser and
 * should not silently become a security decision for a device in a valley.
 *
 * The cap is **seven days**, which is a working week: the longest a technician on this pilot's
 * road campaigns is away from a signal, and short enough that a revocation is real within one.
 */
export const OFFLINE_WINDOW_CAP_MS = 7 * 24 * 60 * 60 * 1000;

/** A pack issued for less than this is not worth carrying into the field. */
export const OFFLINE_WINDOW_FLOOR_MS = 60 * 60 * 1000;

export interface OfflineWindow {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /** What the window was derived from, in the words the diagnostics screen shows. */
  readonly basis: string;
}

export class OfflineWindowUnavailable extends Error {
  constructor(reason: string) {
    super(`a field pack cannot be issued: ${reason}`);
    this.name = "OfflineWindowUnavailable";
  }
}

/**
 * Derive the window from the session behind the request.
 *
 * `min(session expiry, now + cap)`, and a floor beneath which issuing a pack is refused rather
 * than handed over: a technician who drives two hours to a corridor with a pack that expires in
 * ten minutes has been given nothing, and finding that out there is worse than finding it out now.
 */
export function deriveOfflineWindow(input: {
  readonly now: Date;
  readonly sessionExpiresAt: Date;
  readonly capMs?: number;
}): OfflineWindow {
  const cap = input.capMs ?? OFFLINE_WINDOW_CAP_MS;
  const cappedAt = new Date(input.now.getTime() + cap);
  const sessionBound = input.sessionExpiresAt.getTime() <= cappedAt.getTime();
  const expiresAt = sessionBound ? input.sessionExpiresAt : cappedAt;
  const remaining = expiresAt.getTime() - input.now.getTime();

  if (remaining < OFFLINE_WINDOW_FLOOR_MS) {
    throw new OfflineWindowUnavailable(
      "the session behind it expires too soon to be useful in the field. Sign in again before " +
        "going out, so the device carries a full window.",
    );
  }

  return {
    issuedAt: input.now,
    expiresAt,
    basis: sessionBound
      ? "Vence con la sesión que lo descargó."
      : `Vence ${Math.round(cap / (24 * 60 * 60 * 1000))} día(s) después de la descarga.`,
  };
}

/**
 * What the device does with a window it already holds.
 *
 * `valid` — capture normally.
 * `expiring` — still usable; the app says so, because the remedy (find a signal) takes planning.
 * `expired` — capture stops. **Nothing local is deleted**: the outbox, the drafts and the submitted
 *   work are all still there and still sync when the device next reaches the server. What lapses is
 *   permission to start *new* work, not the record of work already done.
 */
export const OFFLINE_ACCESS_STATES = ["valid", "expiring", "expired"] as const;
export const offlineAccessStateSchema = z.enum(OFFLINE_ACCESS_STATES);
export type OfflineAccessState = z.infer<typeof offlineAccessStateSchema>;

/** How long before expiry the app starts saying so. */
export const OFFLINE_EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

export function offlineAccessState(input: {
  readonly now: Date;
  readonly expiresAt: Date;
  readonly warningMs?: number;
}): OfflineAccessState {
  const remaining = input.expiresAt.getTime() - input.now.getTime();
  if (remaining <= 0) return "expired";
  if (remaining <= (input.warningMs ?? OFFLINE_EXPIRY_WARNING_MS)) return "expiring";
  return "valid";
}

export const OFFLINE_ACCESS_STATE_LABEL: Readonly<Record<OfflineAccessState, string>> = {
  valid: "Trabajo descargado vigente",
  expiring: "El trabajo descargado vence pronto · conéctate para renovarlo",
  expired: "El trabajo descargado venció · conéctate para seguir capturando",
};
