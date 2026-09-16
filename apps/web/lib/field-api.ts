import "server-only";

import { PermissionDenied, type RequestContext, type SessionUser } from "@eia/domain";
import { resolveAccessContext } from "@eia/application";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getDb } from "./db";
import { getAuth } from "./identity";
import { logger } from "./logger";

/**
 * The server half of EIA Field, and the one place its requests are authorised.
 *
 * ## Why these routes exist at all
 *
 * Everything else in this product is a server action or a page, because everything else has a
 * browser in front of it. A native application cannot call a server action, so the mobile channel
 * gets a small, explicit HTTP surface — three routes — and each one resolves its caller through
 * **the same** `resolveAccessContext` the web app uses. There is no service token, no device
 * secret and no path that skips a membership check.
 *
 * ## What is never trusted from the device
 *
 * The user. A request body may name a tenant and a project, and those are *looked up inside the
 * caller's memberships* exactly as a URL segment is; it may not name a user, and nothing here
 * reads one. The session is the only source of identity, and the session's own expiry is what
 * bounds how long the device may work offline.
 */
export type MobileAuth =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "denied" }
  | {
      readonly kind: "ok";
      readonly ctx: RequestContext;
      readonly user: SessionUser;
      /** The instant this session stops being valid; the offline window is derived from it. */
      readonly sessionExpiresAt: Date;
    };

export const UNAUTHENTICATED = NextResponse.json(
  { error: "unauthenticated", message: "Inicia sesión otra vez." },
  { status: 401 },
);

/**
 * Denied and not-found are one answer on this surface.
 *
 * A technician probing tenant or project slugs must not be able to tell "this project exists and
 * you are not on it" from "this project does not exist" — the same non-enumeration rule the
 * workspace routes follow (ADR-016).
 */
export const DENIED = NextResponse.json(
  { error: "not_found", message: "No tienes trabajo asignado en este proyecto." },
  { status: 404 },
);

export async function authorizeMobileRequest(
  request: Request,
  tenantSlug: string,
  projectSlug: string,
): Promise<MobileAuth> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return { kind: "unauthenticated" };

  const user: SessionUser = {
    subject: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    emailVerified: session.user.emailVerified,
  };
  const requestId = randomUUID();

  try {
    const access = await resolveAccessContext(getDb(), {
      sessionUser: user,
      tenantSlug,
      projectSlug,
      requestId,
    });
    return {
      kind: "ok",
      ctx: access.ctx,
      user,
      sessionExpiresAt: new Date(session.session.expiresAt),
    };
  } catch (error) {
    if (error instanceof PermissionDenied) {
      logger.info({ requestId, tenantSlug, surface: "field-mobile" }, "mobile access denied");
      return { kind: "denied" };
    }
    throw error;
  }
}
