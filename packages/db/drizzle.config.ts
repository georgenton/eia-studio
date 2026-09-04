import { defineConfig } from "drizzle-kit";

// Schema diff → migrations/ (table migrations are generated; roles, RLS, extensions and grants
// are hand-written custom migrations in the same ordered folder — ADR-013).
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/schema/app.ts",
    "./src/schema/auth.ts",
    "./src/schema/audit.ts",
    "./src/schema/gis.ts",
    "./src/schema/field.ts",
    "./src/schema/social.ts",
    "./src/schema/quality.ts",
    "./src/schema/documents.ts",
    "./src/schema/reports.ts",
  ],
  out: "./migrations",
  schemaFilter: ["app", "auth", "audit"],
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  strict: true,
  verbose: true,
});
