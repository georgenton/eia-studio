import "server-only";

import { randomUUID } from "node:crypto";

import { PermissionDenied, type RequestContext, type SessionUser } from "@eia/domain";
import { buildRequestContext, ensureUser } from "@eia/application";
import { headers } from "next/headers";

import { getDb } from "./db";
import { identityPort } from "./identity";
import { logger } from "./logger";
import { logRouteTiming, measure } from "./timing";

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
 * The route being rendered, for the timing log.
 *
 * `x-matched-path` is what Vercel routed to and is already parameterised (`/t/[tenant]/p/[project]/gis`),
 * which is exactly the grouping a baseline wants. Locally it is absent, so the URL is reduced to the
 * same shape by hand — never the raw path, because a tenant or project slug in a log line is an
 * identifier nobody needs in order to read a duration.
 */
function routeLabel(requestHeaders: Headers, hasProject: boolean): string {
  // The baseline driver labels its own requests, which is the only reliable attribution locally:
  // Next does not surface the matched route to a server component, and the raw path carries slugs.
  const declared = requestHeaders.get("x-perf-route");
  if (declared) return declared.slice(0, 64);
  const matched = requestHeaders.get("x-matched-path");
  if (matched) return matched.split("?")[0] ?? matched;
  const url = requestHeaders.get("next-url") ?? requestHeaders.get("x-invoke-path");
  if (url) {
    return url
      .split("?")[0]!
      .replace(/^\/t\/[^/]+/, "/t/[tenant]")
      .replace(/^(\/t\/\[tenant\])\/p\/[^/]+/, "$1/p/[project]");
  }
  return hasProject ? "/t/[tenant]/p/[project]" : "/t/[tenant]";
}

/** The same resolution, split into the two phases the performance baseline reports separately. */
async function timedSessionUser(): Promise<{
  user: SessionUser | null;
  session: number;
  ensure: number;
  queries: number;
  ms: number;
  requestHeaders: Headers;
}> {
  const requestHeaders = await headers();
  const [user, session, sessionDb] = await measure(() =>
    identityPort.getSessionUser(requestHeaders),
  );
  if (!user) {
    return {
      user,
      session,
      ensure: 0,
      queries: sessionDb.queries,
      ms: sessionDb.ms,
      requestHeaders,
    };
  }
  const [, ensure, ensureDb] = await measure(() => ensureUser(getDb(), user));
  return {
    user,
    session,
    ensure,
    queries: sessionDb.queries + ensureDb.queries,
    ms: sessionDb.ms + ensureDb.ms,
    requestHeaders,
  };
}

/**
 * Server-side context for a route: verifies the URL's tenant/project against memberships.
 * Nothing from the client is trusted beyond the slugs used for lookup.
 */
export async function getRequestContext(
  tenantSlug: string,
  projectSlug?: string,
): Promise<ContextResult> {
  const startedAt = performance.now();
  const identity = await timedSessionUser();
  const sessionUser = identity.user;
  if (!sessionUser) return { kind: "unauthenticated" };
  const requestId = randomUUID();
  try {
    const [ctx, contextMs, contextDb] = await measure(() =>
      buildRequestContext(getDb(), {
        sessionUser,
        tenantSlug,
        projectSlug: projectSlug ?? null,
        requestId,
      }),
    );
    logRouteTiming({
      route: routeLabel(identity.requestHeaders, Boolean(projectSlug)),
      requestId,
      phases: { session: identity.session, ensureUser: identity.ensure, context: contextMs },
      contextDb: {
        queries: identity.queries + contextDb.queries,
        ms: identity.ms + contextDb.ms,
      },
      startedAt,
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
