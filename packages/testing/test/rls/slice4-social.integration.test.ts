import { fieldSchema, socialSchema } from "@eia/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createAiClassification,
  createAssignment,
  createCampaign,
  createClassificationRun,
  createHumanReview,
  createParcelWithGeometry,
  createProjectMembership,
  createProvenanceRecord,
  createPublishedSurvey,
  createPublishedTaxonomy,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  createVisitWithInstance,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type SeededTaxonomy,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Isolation of the Social tables.
 *
 * Two boundaries again. Cross-tenant is the usual rule and applies to all eight tables. The second
 * is the one this slice inherits rather than invents: a **coding is a statement about what one
 * person said**, so classifications and reviews are reachable only by a caller who may read the
 * underlying response — the same `field.responses.read` boundary that governs the answer itself,
 * expressed as an EXISTS over `survey_answer` whose own policy has already applied.
 *
 * The coding scheme is the opposite case and is deliberately visible to the project: a taxonomy is
 * a definition, not anyone's words, and a coordinator has to be able to read what the categories
 * mean. What protects it is immutability, not secrecy.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let prov: string;
let taxonomy: SeededTaxonomy;
let technician: { id: string; email: string };
let classificationId: string;
let reviewId: string;
let answerId: string;

const SOCIAL_TABLES = [
  "taxonomy",
  "taxonomy_version",
  "taxonomy_category",
  "classification_run",
  "ai_classification",
  "ai_classification_category",
  "human_review",
  "human_review_category",
] as const;

/** Tables whose rows are a statement about an individual's response. */
const CODING_TABLES = [
  "ai_classification",
  "ai_classification_category",
  "human_review",
  "human_review_category",
] as const;

/** Tables that hold the scheme or the workflow, readable with ordinary project access. */
const DEFINITION_TABLES = [
  "taxonomy",
  "taxonomy_version",
  "taxonomy_category",
  "classification_run",
] as const;

const withResponses = () => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId: w.projectX.id,
  fieldResponsesAccess: true,
});
const withoutResponses = () => ({ ...withResponses(), fieldResponsesAccess: false });

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
    })
  ).id;

  technician = await createUser(db.migrator, "tech-social");
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: technician.id,
    role: "MEMBER",
  });
  const projectMembership = await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: tenantMembership.id,
    role: "FIELD_TECHNICIAN",
  });

  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  const datasetVersion = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    datasetVersionId: datasetVersion.id,
    parcelCode: "PRED-SOC-RLS",
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: survey.versionId,
  });
  const assignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    campaignId: campaign.id,
    parcelId: parcel.parcelId,
    assigneeMembershipId: projectMembership.id,
    assigneeUserId: technician.id,
  });
  const { instanceId } = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    assignmentId: assignment.id,
    technicianUserId: technician.id,
    surveyVersionId: survey.versionId,
  });
  answerId = randomUUID();
  await db.migrator.insert(fieldSchema.surveyAnswer).values({
    id: answerId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    instanceId,
    questionId: survey.questionIds.has_concern!,
    booleanValue: true,
  });

  taxonomy = await createPublishedTaxonomy(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    codes: ["TOPIC_A", "TOPIC_B"],
  });
  const run = await createClassificationRun(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    taxonomyVersionId: taxonomy.versionId,
    surveyVersionId: survey.versionId,
    questionId: survey.questionIds.has_concern!,
    initiatedByUserId: w.memberA.id,
  });
  classificationId = (
    await createAiClassification(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      runId: run.id,
      answerId,
      categoryIds: [taxonomy.categoryIds.TOPIC_A!],
    })
  ).id;
  reviewId = (
    await createHumanReview(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      classificationId,
      answerId,
      taxonomyVersionId: taxonomy.versionId,
      reviewerUserId: w.memberA.id,
      reviewerMembershipId: w.memberAProjectXMembershipId,
      categoryIds: [taxonomy.categoryIds.TOPIC_A!],
    })
  ).id;

  // A whole parallel world in tenant B, so cross-tenant assertions have something to fail on.
  const provZ = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
    })
  ).id;
  await createPublishedTaxonomy(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
  });
});
afterAll(() => db.close());

describe("Slice 4 · cross-tenant isolation", () => {
  it("a member of tenant A sees no social row of tenant B", async () => {
    for (const table of SOCIAL_TABLES) {
      expect(
        await countVisible(db.runtime, withResponses(), `app.${table}`, {
          column: "tenant_id",
          value: w.tenantB.id,
        }),
        table,
      ).toBe(0);
    }
  });

  it("without any context every social table is empty", async () => {
    for (const table of SOCIAL_TABLES) {
      expect(
        await countVisible(
          db.runtime,
          { userId: null, tenantId: null, projectId: null },
          `app.${table}`,
        ),
        table,
      ).toBe(0);
    }
  });

  it("a forged project id widens nothing", async () => {
    for (const table of SOCIAL_TABLES) {
      expect(
        await countVisible(
          db.runtime,
          { ...withResponses(), projectId: w.projectY.id },
          `app.${table}`,
        ),
        table,
      ).toBe(0);
    }
  });

  it("a tenant ADMIN without a project membership reads nothing (D-015)", async () => {
    const admin = {
      userId: w.adminA.id,
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      fieldResponsesAccess: true,
    };
    for (const table of SOCIAL_TABLES) {
      expect(await countVisible(db.runtime, admin, `app.${table}`), table).toBe(0);
    }
  });
});

describe("Slice 4 · a coding is as private as the response it describes", () => {
  it("the scheme and the workflow are readable with ordinary project access", async () => {
    for (const table of DEFINITION_TABLES) {
      expect(
        await countVisible(db.runtime, withoutResponses(), `app.${table}`),
        table,
      ).toBeGreaterThan(0);
    }
  });

  it("classifications and reviews are not", async () => {
    for (const table of CODING_TABLES) {
      expect(await countVisible(db.runtime, withoutResponses(), `app.${table}`), table).toBe(0);
    }
  });

  it("…and are, for a caller who may read the responses", async () => {
    for (const table of CODING_TABLES) {
      expect(
        await countVisible(db.runtime, withResponses(), `app.${table}`),
        table,
      ).toBeGreaterThan(0);
    }
  });

  it("a technician sees the coding of their own response and no other", async () => {
    // Their own answer, so the EXISTS over `survey_answer` succeeds for this row.
    const own = await asContext(
      db.runtime,
      {
        userId: technician.id,
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        fieldResponsesAccess: false,
      },
      (tx) => tx.execute(sql`select id from app.ai_classification`),
    );
    expect(own.rows.map((r) => (r as { id: string }).id)).toEqual([classificationId]);
  });

  it("a caller without the permission cannot write a coding either", async () => {
    const error = await attempt(
      asContext(db.runtime, withoutResponses(), (tx) =>
        tx.insert(socialSchema.aiClassificationCategory).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          classificationId,
          categoryId: taxonomy.categoryIds.TOPIC_B!,
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });
});

describe("Slice 4 · constraints that keep the model honest", () => {
  it("one classification per answer per run", async () => {
    const run = await db.migrator.execute(sql`
      select run_id from app.ai_classification where id = ${classificationId}
    `);
    const error = await attempt(
      db.migrator.insert(socialSchema.aiClassification).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        runId: (run.rows[0] as { run_id: string }).run_id,
        answerId,
        status: "PENDING",
        provenanceId: prov,
      }),
    );
    expect(error).toMatch(/ai_classification_run_answer_key/i);
  });

  it("a category may not be attached to a coding twice", async () => {
    const error = await attempt(
      db.migrator.insert(socialSchema.aiClassificationCategory).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        classificationId,
        categoryId: taxonomy.categoryIds.TOPIC_A!,
      }),
    );
    expect(error).toMatch(/ai_classification_category_key/i);
  });

  it("a coding cannot borrow another tenant's taxonomy category", async () => {
    const foreign = await db.migrator.execute(sql`
      select id from app.taxonomy_category where tenant_id = ${w.tenantB.id} limit 1
    `);
    const error = await attempt(
      db.migrator.insert(socialSchema.aiClassificationCategory).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        classificationId,
        categoryId: (foreign.rows[0] as { id: string }).id,
      }),
    );
    expect(error).toMatch(/violates foreign key|ai_classification_category_category_fk/i);
  });

  it("every social table has RLS enabled, forced and policied", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r'
         and c.relname in (${sql.join(
           SOCIAL_TABLES.map((name) => sql`${name}`),
           sql`, `,
         )})
       order by 1
    `);
    const rows = result.rows as Array<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>;
    expect(rows).toHaveLength(SOCIAL_TABLES.length);
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
      expect(row.policies, row.table).toBeGreaterThanOrEqual(2);
    }
  });

  it("the review keeps its reviewer, and the reviewer is a member of this project", async () => {
    const rows = await db.migrator.execute(sql`
      select r.reviewer_user_id, pm.project_id
        from app.human_review r
        join app.project_membership pm on pm.tenant_id = r.tenant_id
                                      and pm.id = r.reviewer_membership_id
       where r.id = ${reviewId}
    `);
    expect(rows.rows[0]).toMatchObject({
      reviewer_user_id: w.memberA.id,
      project_id: w.projectX.id,
    });
  });
});
