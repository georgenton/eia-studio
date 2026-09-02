import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { authSchema } from "@eia/db";
import { getAuthTables } from "@better-auth/core/db";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

/**
 * IG0-M02: Better Auth schema drift guard.
 *
 * Better Auth 1.7 introduced `account.issuer`, which Slice 0 discovered only at runtime. This
 * test asks the installed version which fields it requires (`getAuthTables`, the same function
 * the library's own migrator uses) and compares them with our hand-written Drizzle `auth` schema.
 * A dependency upgrade that changes the contract therefore fails CI with the missing field named,
 * before it can fail in production. It runs offline and needs no database.
 *
 * Procedure on failure, documented in docs/DEPENDENCIES.md:
 *   1. read the reported field(s);
 *   2. add the columns to packages/db/src/schema/auth.ts;
 *   3. `pnpm db:generate` and review the SQL by hand;
 *   4. commit schema + migration together with the version bump.
 * Vendor migrations are never run automatically against any environment.
 */
const MODELS = ["user", "session", "account", "verification"] as const;

const drizzleColumns: Record<(typeof MODELS)[number], ReadonlySet<string>> = {
  user: new Set(Object.keys(getTableColumns(authSchema.user))),
  session: new Set(Object.keys(getTableColumns(authSchema.session))),
  account: new Set(Object.keys(getTableColumns(authSchema.account))),
  verification: new Set(Object.keys(getTableColumns(authSchema.verification))),
};

describe("Better Auth schema compatibility", () => {
  const tables = getAuthTables({ emailAndPassword: { enabled: true } });

  for (const model of MODELS) {
    it(`our auth.${model} table covers every field the installed Better Auth requires`, () => {
      const table = tables[model];
      expect(table, `Better Auth no longer defines a "${model}" model`).toBeDefined();
      const required = Object.keys(table!.fields);
      const missing = required.filter((field) => !drizzleColumns[model].has(field));
      expect(
        missing,
        `packages/db/src/schema/auth.ts is missing ${model} field(s): ${missing.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("the installed version matches the pinned version, so the guard reflects what ships", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const pinned = manifest.dependencies["better-auth"]!;
    expect(pinned, "better-auth must stay pinned to an exact version").toMatch(/^\d+\.\d+\.\d+$/);
    const installed = JSON.parse(
      readFileSync(resolve(here, "../node_modules/better-auth/package.json"), "utf8"),
    ) as { version: string };
    expect(installed.version).toBe(pinned);
  });
});
