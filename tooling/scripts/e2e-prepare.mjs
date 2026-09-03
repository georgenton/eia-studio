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

// The demo project must exist before identities can be given a membership in it…
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
// Field technicians. Two of them, so "another technician's work is invisible" is something the
// suite can actually assert rather than assume.
run([
  "provision:identity",
  "--email",
  "tecnico@demo.invalid",
  "--name",
  "Técnico de campo 1",
  "--tenant",
  "demo-consultancy",
  "--tenant-role",
  "MEMBER",
  "--project",
  "puente-del-amor",
  "--project-role",
  "FIELD_TECHNICIAN",
]);
run([
  "provision:identity",
  "--email",
  "tecnico2@demo.invalid",
  "--name",
  "Técnico de campo 2",
  "--tenant",
  "demo-consultancy",
  "--tenant-role",
  "MEMBER",
  "--project",
  "puente-del-amor",
  "--project-role",
  "FIELD_TECHNICIAN",
]);
// The Social specialist: the only role that may start a model run and settle a coding.
run([
  "provision:identity",
  "--email",
  "especialista@demo.invalid",
  "--name",
  "Especialista social",
  "--tenant",
  "demo-consultancy",
  "--tenant-role",
  "MEMBER",
  "--project",
  "puente-del-amor",
  "--project-role",
  "SOCIAL_SPECIALIST",
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

// …and the field campaign assigns work to the synthetic technicians, so it can only be filled in
// once they are project members. The seeder is idempotent — it replaces what it owns — so running
// it at both ends of the identity step costs a second pass and breaks the circular dependency
// without a partial-seed mode nobody else would use.
run(["db:seed:demo-project"]);
console.log("e2e environment ready");
