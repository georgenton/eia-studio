#!/usr/bin/env node
// Snapshot the identifiers and counts a persistent environment must keep across a verification
// run (IG3-001, §7).
//
// The staging suite is supposed to be non-destructive. "Supposed to" is not evidence, so this
// prints a stable JSON document — ids and counts, no credentials, no personal data, no connection
// string — before and after a run, and the two are compared with `diff`:
//
//   EIA_STAGING_MIGRATOR_URL=… pnpm staging:baseline > before.json
//   EIA_STAGING_MIGRATOR_URL=… pnpm test:staging
//   EIA_STAGING_MIGRATOR_URL=… pnpm staging:baseline > after.json
//   diff before.json after.json && echo "environment unchanged"
//
// Identity is what matters, not just totals: a suite that deleted and recreated the campaign would
// leave every count identical while destroying the demo. So the ids of the rows a reviewer's login
// depends on — identities, memberships, campaign, survey version, assignments, responses — are
// listed one by one.
import pg from "pg";

const url = process.env.EIA_STAGING_MIGRATOR_URL;
if (!url) {
  console.error("staging:baseline: set EIA_STAGING_MIGRATOR_URL (read-only use)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

/** One list of ids per concept, ordered so the output is byte-stable between runs. */
const ID_QUERIES = {
  authIdentities: `select id || ':' || email as v from auth."user" order by email`,
  appUsers: `select id || ':' || email as v from app."user" order by email`,
  tenants: `select id || ':' || slug as v from app.tenant order by slug`,
  projects: `select id || ':' || slug as v from app.project order by slug`,
  tenantMemberships: `select id || ':' || role as v from app.tenant_membership order by id`,
  projectMemberships: `select id || ':' || role as v from app.project_membership order by id`,
  campaigns: `select id || ':' || status as v from app.survey_campaign order by id`,
  surveyVersions: `select id || ':' || version_label || ':' || status as v from app.survey_version order by id`,
  surveyQuestions: `select id || ':' || code as v from app.survey_question order by id`,
  surveyOptions: `select id || ':' || code as v from app.survey_option order by id`,
  assignments: `select id || ':' || status || ':' || assignee_user_id as v from app.field_assignment order by id`,
  visits: `select id || ':' || status as v from app.field_visit order by id`,
  instances: `select id || ':' || status as v from app.survey_instance order by id`,
  answers: `select id as v from app.survey_answer order by id`,
  provenance: `select id || ':' || regime as v from app.provenance_record order by id`,
  parcels: `select id || ':' || parcel_code as v from app.parcel order by parcel_code`,
  // Social (Slice 4): a taxonomy version whose id moved would orphan every coding made against it,
  // and a classification or review that vanished would take a decision with it.
  taxonomyVersions: `select id || ':' || version_label || ':' || status as v from app.taxonomy_version order by id`,
  taxonomyCategories: `select id || ':' || code as v from app.taxonomy_category order by id`,
  classificationRuns: `select id || ':' || status || ':' || requested_model as v from app.classification_run order by id`,
  aiClassifications: `select id || ':' || status as v from app.ai_classification order by id`,
  humanReviews: `select id || ':' || decision as v from app.human_review order by id`,
};

const COUNT_QUERY = `
  select
    (select count(*) from auth."user")            as auth_identities,
    (select count(*) from app."user")             as app_users,
    (select count(*) from app.tenant)             as tenants,
    (select count(*) from app.project)            as projects,
    (select count(*) from app.tenant_membership)  as tenant_memberships,
    (select count(*) from app.project_membership) as project_memberships,
    (select count(*) from app.parcel)             as parcels,
    (select count(*) from app.survey_template)    as survey_templates,
    (select count(*) from app.survey_version)     as survey_versions,
    (select count(*) from app.survey_question)    as survey_questions,
    (select count(*) from app.survey_option)      as survey_options,
    (select count(*) from app.survey_campaign)    as campaigns,
    (select count(*) from app.field_assignment)   as assignments,
    (select count(*) from app.field_visit)        as visits,
    (select count(*) from app.survey_instance)    as instances,
    (select count(*) from app.survey_answer)      as answers,
    (select count(*) from app.survey_answer_option) as answer_options,
    (select count(*) from app.project_configuration) as project_configuration,
    (select count(*) from app.taxonomy)           as taxonomies,
    (select count(*) from app.taxonomy_version)   as taxonomy_versions,
    (select count(*) from app.taxonomy_category)  as taxonomy_categories,
    (select count(*) from app.classification_run) as classification_runs,
    (select count(*) from app.ai_classification)  as ai_classifications,
    (select count(*) from app.human_review)       as human_reviews,
    (select count(*) from app.provenance_record)  as provenance,
    (select count(*) from app.metric_snapshot)    as metrics
`;

/** Nothing may reference a provenance record that is gone (the Slice 3 regression). */
const DANGLING_TABLES = [
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
  "taxonomy_version",
  "classification_run",
  "ai_classification",
  "human_review",
];

try {
  const counts = (await client.query(COUNT_QUERY)).rows[0];
  for (const key of Object.keys(counts)) counts[key] = Number(counts[key]);

  const ids = {};
  for (const [key, query] of Object.entries(ID_QUERIES)) {
    ids[key] = (await client.query(query)).rows.map((row) => row.v);
  }

  const dangling = {};
  for (const table of DANGLING_TABLES) {
    const result = await client.query(`
      select count(*)::int as n from app.${table} t
      where not exists (select 1 from app.provenance_record p
                        where p.tenant_id = t.tenant_id and p.id = t.provenance_id)
    `);
    if (result.rows[0].n > 0) dangling[table] = result.rows[0].n;
  }

  const migrations = (
    await client.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)
  ).rows[0].n;

  console.log(JSON.stringify({ migrations, counts, dangling, ids }, null, 2));
} finally {
  await client.end();
}
