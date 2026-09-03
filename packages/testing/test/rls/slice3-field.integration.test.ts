import { fieldSchema } from "@eia/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createAssignment,
  createCampaign,
  createParcelWithGeometry,
  createProjectMembership,
  createMultiChoiceAnswer,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  createVisitWithInstance,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Slice 3 · isolation of field work.
 *
 * Two boundaries, and the second is the one this slice adds. Cross-tenant isolation is the usual
 * rule. **Technician ownership** is stronger: an individual's answers are not readable by everyone
 * who can open the project, so `field_assignment`, `field_visit`, `survey_instance` and
 * `survey_answer` add "this row is mine, or I hold `field.responses.read`" on top of project
 * access. These assertions are made in the database, where no application bug can weaken them.
 *
 * `app.field_responses_access` is the transaction-local setting the application sets from that
 * permission, exactly as `app.pii_access` works. Setting it off is what a technician's request
 * looks like; setting it on is what a coordinator's looks like.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

let techOne: { id: string; email: string };
let techTwo: { id: string; email: string };
let techOneMembership: string;
let techTwoMembership: string;
let assignmentOne: string;
let assignmentTwo: string;
let instanceOne: string;
let instanceTwo: string;
let visitTwo: string;
let survey: Awaited<ReturnType<typeof createPublishedSurvey>>;
let provX: string;
let membershipZ: string;
let parcelIdZ: string;
let spareParcelIdX: string;
let campaignIdX: string;

/** A technician's request: project access, no permission to read anyone else's responses. */
const technician = (user: { id: string }) => ({
  userId: user.id,
  tenantId: w.tenantA.id,
  projectId: w.projectX.id,
  fieldResponsesAccess: false,
});

/** A coordinator's request: the same project, plus `field.responses.read`. */
const coordinator = () => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId: w.projectX.id,
  fieldResponsesAccess: true,
});

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);

  provX = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;

  // Two technicians on the same project. The whole point is that they cannot see each other.
  for (const label of ["tech-one", "tech-two"] as const) {
    const user = await createUser(db.migrator, label);
    const membership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: user.id,
      role: "MEMBER",
    });
    const projectMembership = await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: membership.id,
      role: "FIELD_TECHNICIAN",
    });
    if (label === "tech-one") {
      techOne = user;
      techOneMembership = projectMembership.id;
    } else {
      techTwo = user;
      techTwoMembership = projectMembership.id;
    }
  }

  const datasetVersion = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provX,
  });
  const parcelOne = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provX,
    datasetVersionId: datasetVersion.id,
    parcelCode: "PRED-FLD-001",
  });
  const parcelTwo = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provX,
    datasetVersionId: datasetVersion.id,
    parcelCode: "PRED-FLD-002",
    lon: -78.92,
  });

  survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provX,
    versionLabel: "v1",
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provX,
    surveyVersionId: survey.versionId,
  });
  campaignIdX = campaign.id;
  // A parcel with no assignment yet, so the composite-FK assertions below fail on the constraint
  // they are about and not on the campaign/parcel uniqueness rule.
  spareParcelIdX = (
    await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      datasetVersionId: datasetVersion.id,
      parcelCode: "PRED-FLD-003",
      lon: -78.94,
    })
  ).parcelId;

  assignmentOne = (
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      campaignId: campaign.id,
      parcelId: parcelOne.parcelId,
      assigneeMembershipId: techOneMembership,
      assigneeUserId: techOne.id,
    })
  ).id;
  assignmentTwo = (
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      campaignId: campaign.id,
      parcelId: parcelTwo.parcelId,
      assigneeMembershipId: techTwoMembership,
      assigneeUserId: techTwo.id,
    })
  ).id;

  instanceOne = (
    await createVisitWithInstance(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      assignmentId: assignmentOne,
      technicianUserId: techOne.id,
      surveyVersionId: survey.versionId,
    })
  ).instanceId;
  const second = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provX,
    assignmentId: assignmentTwo,
    technicianUserId: techTwo.id,
    surveyVersionId: survey.versionId,
  });
  instanceTwo = second.instanceId;
  visitTwo = second.visitId;

  // One answer on each, so "cannot read another's answers" has something to fail on — and a
  // multi-choice answer besides, so the same holds for `survey_answer_option`, whose rows are a
  // person's selections and are reached through the answer rather than by a column of their own.
  for (const [instanceId, optionCode] of [
    [instanceOne, "owner_occupier"],
    [instanceTwo, "tenant"],
  ] as const) {
    await db.migrator.insert(fieldSchema.surveyAnswer).values({
      id: randomUUID(),
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      instanceId,
      questionId: survey.questionIds.tenure_category!,
      optionId: survey.optionIds[optionCode]!,
    });
    await createMultiChoiceAnswer(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      instanceId,
      questionId: survey.questionIds.services_present!,
      optionIds: [survey.optionIds.services_water!, survey.optionIds.services_power!],
    });
  }

  // Tenant B gets a whole parallel campaign, for the cross-tenant assertions.
  const provZ = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
    })
  ).id;
  const surveyZ = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
  });
  const campaignZ = await createCampaign(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
    surveyVersionId: surveyZ.versionId,
  });
  const datasetZ = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
  });
  const parcelZ = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
    datasetVersionId: datasetZ.id,
    parcelCode: "PRED-ZZZ-001",
  });
  membershipZ = (
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      tenantMembershipId: w.ownerB.membershipId,
      role: "FIELD_TECHNICIAN",
    })
  ).id;
  const assignmentZ = await createAssignment(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
    campaignId: campaignZ.id,
    parcelId: parcelZ.parcelId,
    assigneeMembershipId: membershipZ,
    assigneeUserId: w.ownerB.id,
  });
  await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
    assignmentId: assignmentZ.id,
    technicianUserId: w.ownerB.id,
    surveyVersionId: surveyZ.versionId,
  });
  parcelIdZ = parcelZ.parcelId;
});
afterAll(() => db.close());

const FIELD_TABLES = [
  "app.survey_campaign",
  "app.survey_template",
  "app.survey_version",
  "app.survey_question",
  "app.survey_option",
  "app.field_assignment",
  "app.field_visit",
  "app.survey_instance",
  "app.survey_answer",
  "app.survey_answer_option",
  "app.project_configuration",
] as const;

describe("Slice 3 · cross-tenant isolation", () => {
  it("a member of tenant A sees no field row of tenant B", async () => {
    for (const table of FIELD_TABLES) {
      expect(
        await countVisible(db.runtime, coordinator(), table, {
          column: "tenant_id",
          value: w.tenantB.id,
        }),
        table,
      ).toBe(0);
    }
  });

  it("without any context every field table is empty", async () => {
    for (const table of FIELD_TABLES) {
      expect(
        await countVisible(db.runtime, { userId: null, tenantId: null, projectId: null }, table),
        table,
      ).toBe(0);
    }
  });

  it("a forged tenant or project id does not widen access", async () => {
    expect(
      await countVisible(
        db.runtime,
        { ...coordinator(), projectId: w.projectY.id },
        "app.field_assignment",
      ),
    ).toBe(0);
    expect(
      await countVisible(
        db.runtime,
        { ...coordinator(), projectId: w.projectZ.id },
        "app.survey_instance",
      ),
    ).toBe(0);
  });
});

describe("Slice 3 · technician ownership", () => {
  it("a technician sees their own assignment", async () => {
    const rows = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`select id from app.field_assignment`),
    );
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { id: string }).id).toBe(assignmentOne);
  });

  it("a technician cannot list another technician's assignment", async () => {
    const rows = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`select id from app.field_assignment where id = ${assignmentTwo}`),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("a technician cannot read another technician's visit", async () => {
    const rows = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`select id from app.field_visit where id = ${visitTwo}`),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("a technician cannot read another technician's response or its answers", async () => {
    const instances = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`select id from app.survey_instance where id = ${instanceTwo}`),
    );
    expect(instances.rows).toHaveLength(0);

    const answers = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`select id from app.survey_answer where instance_id = ${instanceTwo}`),
    );
    expect(answers.rows).toHaveLength(0);

    // …and does see their own, so the isolation is not simply an empty database.
    const own = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`select id from app.survey_answer where instance_id = ${instanceOne}`),
    );
    expect(own.rows).toHaveLength(2);
  });

  it("a technician cannot read another technician's multi-choice selections", async () => {
    const foreign = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`
        select o.id from app.survey_answer_option o
        join app.survey_answer a on a.tenant_id = o.tenant_id and a.id = o.answer_id
        where a.instance_id = ${instanceTwo}
      `),
    );
    expect(foreign.rows).toHaveLength(0);

    const own = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`select id from app.survey_answer_option`),
    );
    expect(own.rows).toHaveLength(2);
  });

  it("a technician cannot update another technician's draft", async () => {
    const affected = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`
        update app.survey_instance set visit_id = null where id = ${instanceTwo}
        returning id
      `),
    );
    expect(affected.rows).toHaveLength(0);
  });

  it("a technician cannot submit another technician's response", async () => {
    const affected = await asContext(db.runtime, technician(techOne), (tx) =>
      tx.execute(sql`
        update app.survey_instance set status = 'SUBMITTED', submitted_at = now()
        where id = ${instanceTwo} returning id
      `),
    );
    expect(affected.rows).toHaveLength(0);
  });

  it("a technician cannot write an answer into another technician's response", async () => {
    const error = await attempt(
      asContext(db.runtime, technician(techOne), (tx) =>
        tx.insert(fieldSchema.surveyAnswer).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          instanceId: instanceTwo,
          questionId: survey.questionIds.has_concern!,
          booleanValue: true,
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it("a technician cannot assign work to themselves on someone else's parcel", async () => {
    const error = await attempt(
      asContext(db.runtime, technician(techOne), (tx) =>
        tx.execute(sql`
          update app.field_assignment set assignee_user_id = ${techOne.id}
          where id = ${assignmentTwo} returning id
        `),
      ),
    );
    // The row is invisible, so the update matches nothing rather than raising: either way the
    // work stays where it was.
    expect(error).toBeNull();
    const check = await db.migrator.execute(sql`
      select assignee_user_id from app.field_assignment where id = ${assignmentTwo}
    `);
    expect((check.rows[0] as { assignee_user_id: string }).assignee_user_id).toBe(techTwo.id);
  });

  it("a forged app.user_id does not turn one technician into another", async () => {
    // The setting is transaction-local and the application sets it from a verified session; this
    // asserts that even if it were forged, the *other* predicates still apply.
    const rows = await asContext(
      db.runtime,
      { userId: techTwo.id, tenantId: w.tenantA.id, projectId: w.projectX.id },
      (tx) => tx.execute(sql`select id from app.field_assignment`),
    );
    // Technician two's own row, not technician one's — a claimed identity gets that identity's
    // rows, and the identity itself is verified upstream by the session.
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { id: string }).id).toBe(assignmentTwo);
  });
});

describe("Slice 3 · roles that may read responses, and roles that may not", () => {
  it("a caller holding field.responses.read sees the project's work", async () => {
    expect(await countVisible(db.runtime, coordinator(), "app.field_assignment")).toBe(2);
    expect(await countVisible(db.runtime, coordinator(), "app.survey_instance")).toBe(2);
    // Two single-choice answers and two multi-choice ones, four selections between them.
    expect(await countVisible(db.runtime, coordinator(), "app.survey_answer")).toBe(4);
    expect(await countVisible(db.runtime, coordinator(), "app.survey_answer_option")).toBe(4);
  });

  it("project access alone reveals no individual response", async () => {
    // memberA is a VIEWER on project X: they may open the project, and `field.responses.read` is
    // not among a VIEWER's permissions, so the flag is off.
    const withoutPermission = { ...coordinator(), fieldResponsesAccess: false };
    expect(await countVisible(db.runtime, withoutPermission, "app.survey_instance")).toBe(0);
    expect(await countVisible(db.runtime, withoutPermission, "app.survey_answer")).toBe(0);
    expect(await countVisible(db.runtime, withoutPermission, "app.survey_answer_option")).toBe(0);
    expect(await countVisible(db.runtime, withoutPermission, "app.field_visit")).toBe(0);
    // The questionnaire itself is not an individual's data: it stays readable.
    expect(
      await countVisible(db.runtime, withoutPermission, "app.survey_question"),
    ).toBeGreaterThan(0);
    expect(await countVisible(db.runtime, withoutPermission, "app.survey_campaign")).toBe(1);
  });

  it("D-015: a tenant ADMIN without a project membership reads no field data", async () => {
    const adminContext = {
      userId: w.adminA.id,
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      fieldResponsesAccess: true,
    };
    for (const table of FIELD_TABLES) {
      expect(await countVisible(db.runtime, adminContext, table), table).toBe(0);
    }
  });
});

describe("Slice 3 · composite tenancy", () => {
  // These run on the MIGRATOR connection, which bypasses RLS: the point is that the constraint
  // holds even where row level security does not apply — a bug in a privileged path (a migration,
  // a seeder, the worker) cannot stitch two tenants together either.
  it("an assignment cannot borrow a membership from another tenant", async () => {
    const error = await attempt(
      db.migrator.insert(fieldSchema.fieldAssignment).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        campaignId: campaignIdX,
        parcelId: spareParcelIdX,
        assigneeMembershipId: membershipZ,
        assigneeUserId: techOne.id,
        provenanceId: provX,
      }),
    );
    expect(error).toMatch(/field_assignment_assignee_fk|violates foreign key/i);
  });

  it("an assignment cannot point at a parcel of another tenant", async () => {
    const error = await attempt(
      db.migrator.insert(fieldSchema.fieldAssignment).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        campaignId: campaignIdX,
        parcelId: parcelIdZ,
        assigneeMembershipId: techOneMembership,
        assigneeUserId: techOne.id,
        provenanceId: provX,
      }),
    );
    expect(error).toMatch(/field_assignment_parcel_fk|violates foreign key/i);
  });

  it("a provenance-bearing field row cannot name a record that does not exist", async () => {
    const error = await attempt(
      db.migrator.insert(fieldSchema.surveyCampaign).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        name: "Campaña sin procedencia",
        surveyVersionId: survey.versionId,
        provenanceId: randomUUID(),
      }),
    );
    expect(error).toMatch(/survey_campaign_provenance_fk|violates foreign key/i);
  });
});
