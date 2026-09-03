#!/usr/bin/env node
// Re-seeding the demo project must change nothing that already exists.
//
// This is a regression, not a nicety. The seeder used to delete and re-insert provenance records
// with fresh ids on every run, which was invisible while every provenance-bearing row was
// recreated alongside them — and produced a dangling reference the moment a row was legitimately
// *reused*: a published questionnaire that immutability triggers refuse to delete, or a campaign
// whose assignments carry submitted responses. The surface then failed with "provenance record
// missing", which is the right failure in the wrong place.
//
// So: snapshot, seed again, compare. Identity is what matters, not just counts — a seeder that
// deleted and recreated a survey version would keep the count identical while destroying every
// answer's meaning, so the ids of the rows answers depend on are compared one by one.
//
// Run against a database that has already been seeded once (`pnpm db:seed:demo-project`).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) {
  console.error("check-seeder-idempotency: DATABASE_MIGRATOR_URL is required");
  process.exit(1);
}
if (process.env.APP_ENV === "production") {
  console.error("check-seeder-idempotency: refuses to run against production");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

/** Counts of everything the demo seeder owns, plus the ids answers depend on. */
async function snapshot() {
  const counts = await client.query(`
    select
      (select count(*) from app.provenance_record)   as provenance,
      (select count(*) from app.parcel)              as parcels,
      (select count(*) from app.parcel_geometry)     as geometries,
      (select count(*) from app.spatial_dataset_version) as dataset_versions,
      (select count(*) from app.survey_template)     as templates,
      (select count(*) from app.survey_version)      as versions,
      (select count(*) from app.survey_question)     as questions,
      (select count(*) from app.survey_option)       as options,
      (select count(*) from app.survey_campaign)     as campaigns,
      (select count(*) from app.field_assignment)    as assignments,
      (select count(*) from app.field_visit)         as visits,
      (select count(*) from app.survey_instance)     as instances,
      (select count(*) from app.survey_answer)       as answers,
      (select count(*) from app.metric_snapshot)     as metrics
  `);

  const ids = {};
  for (const [key, query] of Object.entries({
    // A survey version whose id moved would orphan every answer given under it.
    versions: "select id from app.survey_version order by id",
    campaigns: "select id from app.survey_campaign order by id",
    // Parcel identity must survive a dataset replacement (IG2-002).
    parcels: "select id from app.parcel order by id",
    instances: "select id, status from app.survey_instance order by id",
    answers: "select id from app.survey_answer order by id",
    // Every provenance record a row points at: the determinism this regression is about.
    provenance: "select id from app.provenance_record order by id",
  })) {
    const result = await client.query(query);
    ids[key] = result.rows.map((row) => Object.values(row).join(":"));
  }

  return { counts: counts.rows[0], ids };
}

function compare(before, after) {
  const problems = [];

  for (const [key, value] of Object.entries(before.counts)) {
    if (String(after.counts[key]) !== String(value)) {
      problems.push(`${key}: ${value} before, ${after.counts[key]} after`);
    }
  }

  for (const [key, before_] of Object.entries(before.ids)) {
    const after_ = after.ids[key];
    const gone = before_.filter((id) => !after_.includes(id));
    const added = after_.filter((id) => !before_.includes(id));
    if (gone.length > 0) {
      problems.push(`${key}: ${gone.length} row(s) were deleted or replaced (e.g. ${gone[0]})`);
    }
    if (added.length > 0) {
      problems.push(`${key}: ${added.length} row(s) appeared (e.g. ${added[0]})`);
    }
  }

  return problems;
}

/** Nothing may point at a provenance record that no longer exists. */
async function danglingProvenance() {
  const tables = [
    "spatial_dataset_version",
    "alignment",
    "parcel",
    "parcel_geometry",
    "affectation",
    "survey_version",
    "survey_campaign",
    "field_assignment",
    "field_visit",
    "survey_instance",
  ];
  const dangling = [];
  for (const table of tables) {
    const result = await client.query(`
      select count(*)::int as n from app.${table} t
      where not exists (
        select 1 from app.provenance_record p
        where p.tenant_id = t.tenant_id and p.id = t.provenance_id
      )
    `);
    if (result.rows[0].n > 0) dangling.push(`${table}: ${result.rows[0].n}`);
  }
  return dangling;
}

await client.connect();
try {
  const before = await snapshot();
  if (Number(before.counts.parcels) === 0) {
    console.error(
      "check-seeder-idempotency: the database has no seeded parcels; run pnpm db:seed:demo-project first",
    );
    process.exit(1);
  }

  console.log("> pnpm db:seed:demo-project (second pass)");
  execFileSync("pnpm", ["db:seed:demo-project"], {
    stdio: "inherit",
    env: process.env,
    // From the repository root: the seeder is a root script, and this file runs inside @eia/db.
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
  });

  const after = await snapshot();
  const problems = compare(before, after);
  const dangling = await danglingProvenance();

  if (problems.length > 0 || dangling.length > 0) {
    console.error("\ncheck-seeder-idempotency: re-seeding changed the demo project.\n");
    for (const problem of problems) console.error(`  · ${problem}`);
    for (const table of dangling) console.error(`  · dangling provenance reference in ${table}`);
    process.exit(1);
  }

  console.log(
    `\ncheck-seeder-idempotency: stable across a second pass — ` +
      `${before.counts.parcels} parcels, ${before.counts.versions} survey version(s), ` +
      `${before.counts.campaigns} campaign(s), ${before.counts.assignments} assignments, ` +
      `${before.counts.instances} responses, ${before.counts.answers} answers, ` +
      `${before.counts.provenance} provenance records, none re-created.`,
  );
} finally {
  await client.end();
}
