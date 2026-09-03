import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Database } from "@eia/db";
import { sql } from "drizzle-orm";

/** The eleven tables Slice 3 added, by name in the `app` schema. */
export const FIELD_TABLES = [
  "project_configuration",
  "survey_template",
  "survey_version",
  "survey_question",
  "survey_option",
  "survey_campaign",
  "field_assignment",
  "field_visit",
  "survey_instance",
  "survey_answer",
  "survey_answer_option",
] as const;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

interface ProjectManifest {
  readonly tenantSlug: string;
  readonly project: { readonly slug: string };
  readonly field: {
    readonly campaign: { readonly assignmentCount: number; readonly completedCount: number };
    readonly technician: { readonly email: string; readonly name: string };
    readonly secondTechnician: { readonly email: string; readonly name: string };
  };
}

/**
 * Read the demo fixture's manifest without naming the pilot.
 *
 * The project's name, province and customer belong in `fixtures/`, never in a package (CLAUDE.md
 * rule 3), so the manifest is *discovered* rather than addressed: one project fixture, one
 * manifest, and it names its own tenant. When a second fixture exists,
 * `EIA_STAGING_PROJECT_SLUG` says which environment is being verified.
 */
function readProjectManifest(): ProjectManifest {
  const base = resolve(ROOT, "fixtures", "projects");
  const manifests = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(base, entry.name, "manifest.json"))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, "utf8")) as ProjectManifest);

  const wanted = process.env.EIA_STAGING_PROJECT_SLUG;
  const chosen = wanted
    ? manifests.find((m) => m.project?.slug === wanted)
    : manifests.length === 1
      ? manifests[0]
      : undefined;

  if (!chosen) {
    throw new Error(
      wanted
        ? `no project fixture with slug ${wanted} under fixtures/projects`
        : `expected exactly one project fixture, found ${manifests.length}; ` +
            `set EIA_STAGING_PROJECT_SLUG to say which environment is being verified`,
    );
  }
  // Fail here, with the field that is missing, rather than three queries later with a SQL syntax
  // error from an undefined parameter.
  for (const [path, value] of [
    ["tenantSlug", chosen.tenantSlug],
    ["project.slug", chosen.project?.slug],
    ["field.technician.email", chosen.field?.technician?.email],
    ["field.secondTechnician.email", chosen.field?.secondTechnician?.email],
    ["field.campaign.assignmentCount", chosen.field?.campaign?.assignmentCount],
  ] as const) {
    if (value === undefined) throw new Error(`project fixture manifest has no ${path}`);
  }
  return chosen;
}

const manifest = readProjectManifest();

/**
 * The demo baseline, taken from the fixture rather than from a number typed here.
 *
 * `assignments` is the manifest's own `assignmentCount`. `submittedResponses` is derived the way
 * the seeder derives it — the first `completedCount` assignments that fall to the *primary*
 * technician, every third one going to the second — so this expectation follows the fixture if the
 * fixture changes, instead of pinning today's total and going stale.
 */
export const DEMO_BASELINE = {
  tenantSlug: manifest.tenantSlug,
  projectSlug: manifest.project.slug,
  coordinatorEmail: "coordinadora@demo.invalid",
  technicianEmail: manifest.field.technician.email,
  secondTechnicianEmail: manifest.field.secondTechnician.email,
  campaigns: 1,
  surveyVersions: 1,
  assignments: manifest.field.campaign.assignmentCount,
  submittedResponses: Array.from(
    { length: manifest.field.campaign.completedCount },
    (_unused, index) => index,
  ).filter((index) => index % 3 !== 2).length,
} as const;

export interface StagingFixtureIds {
  readonly tenantId: string;
  readonly projectId: string;
  readonly coordinatorUserId: string;
  readonly technicianUserId: string;
  readonly secondTechnicianUserId: string;
  readonly campaignId: string;
  readonly surveyVersionId: string;
  readonly technicianAssignmentId: string;
  readonly secondTechnicianAssignmentId: string;
  readonly technicianInstanceId: string;
}

class MissingStagingFixture extends Error {
  constructor(what: string) {
    super(
      `staging verification needs the demo fixture: ${what} is missing. Restore it with ` +
        `DEMO_USER_PASSWORD=… pnpm e2e:prepare against the staging environment, then re-run. ` +
        `This suite never creates fixture rows itself.`,
    );
  }
}

async function one<T>(db: Database, query: ReturnType<typeof sql>, what: string): Promise<T> {
  const result = await db.execute(query);
  const row = result.rows[0] as T | undefined;
  if (!row) throw new MissingStagingFixture(what);
  return row;
}

/**
 * Resolve the persistent demo fixture's identifiers, read through the migrator connection.
 *
 * Nothing here writes. If a piece is missing the suite fails with an instruction rather than
 * seeding it: a verification suite that repairs what it is verifying proves nothing, and creating
 * rows here is exactly the lifecycle mixing IG3-001 is about.
 */
export async function loadStagingFixture(db: Database): Promise<StagingFixtureIds> {
  const tenant = await one<{ id: string }>(
    db,
    sql`select id from app.tenant where slug = ${DEMO_BASELINE.tenantSlug}`,
    `tenant ${DEMO_BASELINE.tenantSlug}`,
  );
  const project = await one<{ id: string }>(
    db,
    sql`select id from app.project
        where tenant_id = ${tenant.id} and slug = ${DEMO_BASELINE.projectSlug}`,
    `project ${DEMO_BASELINE.projectSlug}`,
  );

  const userId = async (email: string) =>
    (
      await one<{ id: string }>(
        db,
        sql`select id from app."user" where email = ${email}`,
        `synthetic identity ${email}`,
      )
    ).id;
  const coordinatorUserId = await userId(DEMO_BASELINE.coordinatorEmail);
  const technicianUserId = await userId(DEMO_BASELINE.technicianEmail);
  const secondTechnicianUserId = await userId(DEMO_BASELINE.secondTechnicianEmail);

  const campaign = await one<{ id: string; survey_version_id: string }>(
    db,
    sql`select id, survey_version_id from app.survey_campaign
        where tenant_id = ${tenant.id} and project_id = ${project.id}
        order by created_at limit 1`,
    "the demo field campaign",
  );

  const assignmentOf = async (assignee: string, label: string) =>
    (
      await one<{ id: string }>(
        db,
        sql`select id from app.field_assignment
            where tenant_id = ${tenant.id} and project_id = ${project.id}
              and assignee_user_id = ${assignee}
            order by id limit 1`,
        `an assignment for ${label}`,
      )
    ).id;

  const technicianAssignmentId = await assignmentOf(technicianUserId, "the first technician");
  const secondTechnicianAssignmentId = await assignmentOf(
    secondTechnicianUserId,
    "the second technician",
  );

  const instance = await one<{ id: string }>(
    db,
    sql`select id from app.survey_instance
        where tenant_id = ${tenant.id} and project_id = ${project.id}
          and respondent_user_id = ${technicianUserId} and status = 'SUBMITTED'
        order by id limit 1`,
    "a submitted response by the first technician",
  );

  return {
    tenantId: tenant.id,
    projectId: project.id,
    coordinatorUserId,
    technicianUserId,
    secondTechnicianUserId,
    campaignId: campaign.id,
    surveyVersionId: campaign.survey_version_id,
    technicianAssignmentId,
    secondTechnicianAssignmentId,
    technicianInstanceId: instance.id,
  };
}
