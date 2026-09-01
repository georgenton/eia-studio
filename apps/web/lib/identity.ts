import "server-only";

import { randomUUID } from "node:crypto";

import { authSchema } from "@eia/db";
import type { IdentityPort, SessionUser } from "@eia/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { toNextJsHandler } from "better-auth/next-js";

import { getDb } from "./db";
import { getEnv } from "./env";

/**
 * Better Auth instance (ADR-010): identity, authentication and sessions ONLY. Persistence is the
 * `auth` schema through the Drizzle adapter; ids are UUIDs so `auth.user.id` doubles as the
 * domain `app.user.id`. No organisation/role plugin is enabled and nothing here is consulted
 * for authorization.
 */
function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "EIA Studio",
    baseURL: env.auth.BETTER_AUTH_URL,
    secret: env.auth.BETTER_AUTH_SECRET,
    trustedOrigins: env.auth.AUTH_TRUSTED_ORIGINS,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      useSecureCookies: env.app.APP_ENV !== "local" && env.app.APP_ENV !== "test",
    },
    plugins: [nextCookies()],
  });
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
