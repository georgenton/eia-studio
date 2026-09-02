/**
 * Identity provider boundary (ADR-010). The only thing the domain learns from the identity
 * layer is the authenticated subject and the profile fields needed to create `app.user`.
 * No tenant, role or permission claim is ever read from it.
 */
export interface SessionUser {
  /** Stable identity subject; equals `app.user.id` (UUID) by construction. */
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
  readonly emailVerified: boolean;
}

export interface IdentityPort {
  /** Resolve the current session from request headers; null when unauthenticated. */
  getSessionUser(headers: Headers): Promise<SessionUser | null>;
}
