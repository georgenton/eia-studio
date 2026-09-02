import { loadEnv, runtimeRoleProvisioningEnvSchema } from "@eia/contracts";

import { provisionRuntimeRole } from "../src/provision";
import { loadDotenv } from "./env";

loadDotenv();
const env = loadEnv("runtime-role", runtimeRoleProvisioningEnvSchema);
await provisionRuntimeRole(env.DATABASE_MIGRATOR_URL, {
  name: env.DATABASE_APP_ROLE_NAME,
  password: env.DATABASE_APP_ROLE_PASSWORD,
});
console.log(`runtime role ${env.DATABASE_APP_ROLE_NAME} provisioned (member of eia_app)`);
