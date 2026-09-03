import "server-only";

import type { IdentityPort, SessionUser } from "@eia/domain";
import { betterAuth } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";

import { createAuthOptions } from "./auth-options";
import { getDb } from "./db";
import { getEnv } from "./env";

function createAuth() {
  const env = getEnv();
  return betterAuth(
    createAuthOptions({
      database: getDb(),
      baseURL: env.auth.BETTER_AUTH_URL,
      secret: env.auth.BETTER_AUTH_SECRET,
      trustedOrigins: env.trustedOrigins,
      secureCookies: env.app.APP_ENV !== "local" && env.app.APP_ENV !== "test",
    }),
  );
}

const globalRef = globalThis as unknown as { __eiaAuth?: ReturnType<typeof createAuth> };

export function getAuth() {
  // In development, hot reloads can change the Drizzle schema; do not cache across reloads.
  if (process.env.NODE_ENV === "development") return createAuth();
  if (!globalRef.__eiaAuth) globalRef.__eiaAuth = createAuth();
  return globalRef.__eiaAuth;
}

/** Route handler for /api/auth/[...all]; kept here so routes never import better-auth. */
export function getAuthHandler() {
  return toNextJsHandler(getAuth());
}

/** The only bridge between the identity layer and the domain: subject + profile, nothing else. */
export const identityPort: IdentityPort = {
  async getSessionUser(headers: Headers): Promise<SessionUser | null> {
    const session = await getAuth().api.getSession({ headers });
    if (!session) return null;
    return {
      subject: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      emailVerified: session.user.emailVerified,
    };
  },
};
