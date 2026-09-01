import { loadEnv, migratorDatabaseEnvSchema } from "@eia/contracts";

import { runMigrations } from "../src/migrate";
import { loadDotenv } from "./env";

loadDotenv();
const env = loadEnv("migrator", migratorDatabaseEnvSchema);
await runMigrations(env.DATABASE_MIGRATOR_URL);
console.log("migrations applied");
