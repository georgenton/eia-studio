#!/usr/bin/env node
// Empty the local development database, deliberately and by name (IG3-001, §9).
//
// A full reset is occasionally the right thing — a half-applied migration, a fixture that has
// drifted, a demo password nobody remembers. What it must never be is a *side effect* of preparing
// for a test run: `pnpm e2e:prepare` reconciles, it does not wipe, and if a developer wants the
// database emptied they have to type this.
//
// Three guards, all of which must pass:
//   1. APP_ENV must be `local` — never test, preview, staging or production;
//   2. the database host must be loopback — a tunnel to a hosted database is not a local database;
//   3. EIA_CONFIRM_RESET=yes-delete-my-local-data must be set, per invocation.
//
// It truncates the application and identity tables. It does not drop the schema, the roles or the
// extensions, so `pnpm db:migrate` is not needed afterwards — only a re-seed.
import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

const CONFIRMATION = "yes-delete-my-local-data";
const appEnv = process.env.APP_ENV ?? "";
const url = process.env.DATABASE_MIGRATOR_URL;

const refuse = (why) => {
  console.error(`db:reset:local refused: ${why}`);
  process.exit(1);
};

if (appEnv !== "local") refuse(`APP_ENV is "${appEnv}"; this command only runs with APP_ENV=local`);
if (!url) refuse("DATABASE_MIGRATOR_URL is not set");

const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  refuse(
    `the database host is "${host}", which is not loopback. A hosted database is never reset by this command.`,
  );
}
if (process.env.EIA_CONFIRM_RESET !== CONFIRMATION) {
  refuse(
    `set EIA_CONFIRM_RESET=${CONFIRMATION} to confirm. This deletes every tenant, project, ` +
      `identity and demo record in the local database.`,
  );
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`
    truncate table
      audit.log,
      app.project_capability_setting,
      app.project_membership,
      app.project,
      app.tenant_capability,
      app.tenant_membership,
      app.tenant,
      app."user",
      auth.verification,
      auth.account,
      auth.session,
      auth."user"
    restart identity cascade
  `);
  console.log(
    `db:reset:local: emptied ${host}. Re-seed with DEMO_USER_PASSWORD=… pnpm e2e:prepare.`,
  );
} finally {
  await client.end();
}
