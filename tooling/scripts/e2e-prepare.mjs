#!/usr/bin/env node
// Prepare a database for the end-to-end suite: migrate, provision the runtime role, load the
// synthetic demo tenant and project fixture, and provision the two synthetic identities the
// journey signs in with. Passwords come from DEMO_USER_PASSWORD and are never written anywhere.
//
// It refuses to run without DEMO_FIXTURES_ENABLED, and the provisioning script itself refuses
// any address outside the reserved synthetic domains and any APP_ENV of production.
import { execFileSync } from "node:child_process";

const password = process.env.DEMO_USER_PASSWORD;
if (!password || password.length < 12) {
  console.error("e2e:prepare: set DEMO_USER_PASSWORD (at least 12 characters)");
  process.exit(1);
}

const run = (args) => {
  console.log(`> pnpm ${args.join(" ")}`);
  execFileSync("pnpm", args, { stdio: "inherit", env: process.env });
};

run(["db:migrate"]);
run(["db:provision-runtime-role"]);
run(["db:seed:dev"]);
run(["db:seed:demo-project"]);
run([
  "provision:identity",
  "--email",
  "coordinadora@demo.invalid",
  "--name",
  "Coordinadora de proyecto",
  "--tenant",
  "demo-consultancy",
  "--tenant-role",
  "MEMBER",
  "--project",
  "puente-del-amor",
  "--project-role",
  "COORDINATOR",
]);
run([
  "provision:identity",
  "--email",
  "admin@demo.invalid",
  "--name",
  "Administradora del tenant",
  "--tenant",
  "demo-consultancy",
  "--tenant-role",
  "ADMIN",
]);
console.log("e2e environment ready");
