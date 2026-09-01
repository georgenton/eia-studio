import "server-only";

import { randomUUID } from "node:crypto";

import {
  PermissionDenied,
  buildRequestContext,
  ensureUser,
  type RequestContext,
  type SessionUser,
} from "@eia/domain";
import { headers } from "next/headers";

import { getDb } from "./db";
import { identityPort } from "./identity";
import { logger } from "./logger";

export type ContextResult =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "denied"; readonly role: string | null; readonly restrictedData: string }
  | { readonly kind: "ok"; readonly ctx: RequestContext };

export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await identityPort.getSessionUser(await headers());
  if (user) await ensureUser(getDb(), user);
  return user;
}

/**
 * Server-side context for a route: verifies the URL's tenant/project against memberships.
 * Nothing from the client is trusted beyond the slugs used for lookup.
 */
export async function getRequestContext(
  tenantSlug: string,
  projectSlug?: string,
): Promise<ContextResult> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return { kind: "unauthenticated" };
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext(getDb(), {
      sessionUser,
      tenantSlug,
      projectSlug: projectSlug ?? null,
      requestId,
    });
    return { kind: "ok", ctx };
  } catch (error) {
    if (error instanceof PermissionDenied) {
      logger.info(
        {
          requestId,
          tenantSlug,
          hasProject: Boolean(projectSlug),
          restricted: error.restrictedData,
        },
        "access denied",
      );
      return { kind: "denied", role: error.role, restrictedData: error.restrictedData };
    }
    throw error;
  }
}
