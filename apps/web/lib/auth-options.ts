import { randomUUID } from "node:crypto";

import { authSchema, type Database } from "@eia/db";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

export interface AuthOptionsInput {
  readonly database: Database;
  readonly baseURL: string;
  readonly secret: string;
  readonly trustedOrigins: readonly string[];
  readonly secureCookies: boolean;
}

/**
 * Better Auth configuration (ADR-010): identity, authentication and sessions ONLY. Persistence is
 * the `auth` schema through the Drizzle adapter; ids are UUIDs so `auth.user.id` doubles as the
 * domain `app.user.id`. No organisation or role plugin is enabled and nothing here is consulted
 * for authorization.
 *
 * IG0-H01: `disableSignUp` closes the public `/api/auth/sign-up/email` endpoint. Identities are
 * provisioned deliberately until the onboarding workflow makes identity, application user,
 * TenantMembership and optional ProjectMembership creation atomic or compensating. Disabling
 * sign-up is an availability decision about identity creation; it moves no authorization
 * responsibility into Better Auth, which still supplies only `userId`.
 *
 * Exported as a plain factory (no "server-only") so tests can build the same instance.
 */
export function createAuthOptions(input: AuthOptionsInput): BetterAuthOptions {
  return {
    appName: "EIA Studio",
    baseURL: input.baseURL,
    secret: input.secret,
    trustedOrigins: [...input.trustedOrigins],
    database: drizzleAdapter(input.database, {
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
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      useSecureCookies: input.secureCookies,
    },
    plugins: [nextCookies()],
  };
}
