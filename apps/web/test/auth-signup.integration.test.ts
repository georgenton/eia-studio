import { randomUUID } from "node:crypto";

import { authSchema } from "@eia/db";
import { getTestDatabase, resetDatabase } from "@eia/testing";
import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthOptions } from "../lib/auth-options";

/**
 * IG0-H01: the public sign-up endpoint must be closed, while provisioned identities keep signing
 * in. The instance under test is built from the same factory the application uses, against the
 * real test database, so the assertion covers configuration and behaviour together.
 */
const db = getTestDatabase();

const auth = betterAuth(
  createAuthOptions({
    database: db.runtime,
    baseURL: "http://localhost:3000",
    secret: "test-secret-value-at-least-32-characters-long",
    trustedOrigins: ["http://localhost:3000"],
    secureCookies: false,
  }),
);

const PROVISIONED = { email: "provisioned@factory.test", password: "provisioned-password-123" };

beforeAll(async () => {
  await resetDatabase(db.migrator);
  // Provisioning path: what an operator (or the future onboarding workflow) does deliberately.
  // `signUpEmail` is closed, so the identity row and its credential account are created directly.
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(PROVISIONED.password);
  const userId = randomUUID();
  const now = new Date();
  await db.migrator.insert(authSchema.user).values({
    id: userId,
    name: "Provisioned Operator",
    email: PROVISIONED.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.migrator.insert(authSchema.account).values({
    id: randomUUID(),
    issuer: "local:credential",
    accountId: userId,
    providerId: "credential",
    userId,
    password: hash,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => db.close());

describe("public sign-up is disabled (IG0-H01)", () => {
  it("an anonymous caller cannot create an identity through the sign-up endpoint", async () => {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Intruder",
          email: "intruder@factory.test",
          password: "intruder-password-123",
        }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    const created = await db.migrator
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, "intruder@factory.test"));
    expect(created).toHaveLength(0);
  });

  it("a provisioned identity can still authenticate", async () => {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: PROVISIONED.email, password: PROVISIONED.password }),
      }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie!.split(";")[0]! }),
    });
    expect(session?.user.email).toBe(PROVISIONED.email);
  });

  it("the option is set on the instance, not only observed through the endpoint", () => {
    const options = createAuthOptions({
      database: db.runtime,
      baseURL: "http://localhost:3000",
      secret: "test-secret-value-at-least-32-characters-long",
      trustedOrigins: [],
      secureCookies: true,
    });
    expect(options.emailAndPassword?.disableSignUp).toBe(true);
    expect(options.emailAndPassword?.enabled).toBe(true);
    // authorization stays out of the identity layer: no organisation/role plugin is configured
    const pluginIds = (options.plugins ?? []).map((p) => p.id);
    expect(pluginIds).not.toContain("organization");
    expect(pluginIds).not.toContain("admin");
  });
});
