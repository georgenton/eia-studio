import { fieldSchema } from "@eia/db";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attempt,
  createAssignment,
  createCampaign,
  createParcelWithGeometry,
  createProjectMembership,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  createVisitWithInstance,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type SeededQuestionnaire,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * A submitted answer means what the question asked when it was asked.
 *
 * That is the whole reason `SurveyVersion` exists. If v2 renamed a question, dropped an option or
 * changed a scale, every response captured under v1 would silently acquire a different meaning —
 * and nobody reading a chapter of the study would know. So a published version, its questions and
 * its options are immutable, and an instance keeps pointing at the version it was answered under.
 *
 * This suite proves it in the database, on the migrator connection, which bypasses RLS. A rule
 * that only application code enforces is a rule a future seeder, migration or worker can walk
 * around; these are triggers, and they refuse everyone.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let prov: string;
let v1: SeededQuestionnaire;
let v2: SeededQuestionnaire;
let instanceOnV1: string;
let technicianId: string;
let draftDatasetVersionId: string;
let technicianMembershipId: string;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
    })
  ).id;

  const technician = await createUser(db.migrator, "tech-versioning");
  technicianId = technician.id;
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

  // v1: one single-choice question with options X and Y.
  v1 = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    versionLabel: "v1",
    optionCodes: ["option_x", "option_y"],
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
    parcelCode: "PRED-VER-001",
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: v1.versionId,
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

  // S1: a response captured and SUBMITTED under v1, answering option X.
  instanceOnV1 = (
    await createVisitWithInstance(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      assignmentId: assignment.id,
      technicianUserId: technician.id,
      surveyVersionId: v1.versionId,
    })
  ).instanceId;
  await db.migrator.insert(fieldSchema.surveyAnswer).values({
    id: randomUUID(),
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    instanceId: instanceOnV1,
    questionId: v1.questionIds.tenure_category!,
    optionId: v1.optionIds.option_x!,
  });
  await db.migrator.insert(fieldSchema.surveyAnswer).values({
    id: randomUUID(),
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    instanceId: instanceOnV1,
    questionId: v1.questionIds.has_concern!,
    booleanValue: true,
  });
  await db.migrator
    .update(fieldSchema.surveyInstance)
    .set({ status: "SUBMITTED", submittedAt: new Date() })
    .where(eq(fieldSchema.surveyInstance.id, instanceOnV1));

  // v2 of the SAME template: the questionnaire's semantics change. `option_y` is gone, replaced
  // by `option_z`, and the question code differs — exactly the kind of edit that would corrupt
  // S1's meaning if it were applied in place.
  draftDatasetVersionId = datasetVersion.id;
  technicianMembershipId = projectMembership.id;

  v2 = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    templateId: v1.templateId,
    versionLabel: "v2",
    questionCode: "tenure_category_revised",
    optionCodes: ["option_x", "option_z"],
  });
});
afterAll(() => db.close());

describe("Slice 3 · a published questionnaire is frozen", () => {
  it("v1's version row survives v2 unchanged", async () => {
    const rows = await db.migrator.execute(sql`
      select version_label, status from app.survey_version where id = ${v1.versionId}
    `);
    expect(rows.rows[0]).toMatchObject({ version_label: "v1", status: "PUBLISHED" });
  });

  it("v1's questions and options survive v2 unchanged", async () => {
    const questions = await db.migrator.execute(sql`
      select code from app.survey_question where version_id = ${v1.versionId} order by ordinal
    `);
    expect(questions.rows.map((r) => (r as { code: string }).code)).toEqual([
      "tenure_category",
      "has_concern",
      "services_present",
    ]);

    const options = await db.migrator.execute(sql`
      select code from app.survey_option where question_id = ${v1.questionIds.tenure_category!}
      order by ordinal
    `);
    expect(options.rows.map((r) => (r as { code: string }).code)).toEqual(["option_x", "option_y"]);
  });

  it("v2 is a separate version of the same template", async () => {
    expect(v2.templateId).toBe(v1.templateId);
    expect(v2.versionId).not.toBe(v1.versionId);
    const versions = await db.migrator.execute(sql`
      select version_label from app.survey_version where template_id = ${v1.templateId}
      order by version_label
    `);
    expect(versions.rows.map((r) => (r as { version_label: string }).version_label)).toEqual([
      "v1",
      "v2",
    ]);
  });

  it("editing a published version's definition is refused", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        update app.survey_version set version_label = 'v1-edited' where id = ${v1.versionId}
      `),
    );
    expect(error).toMatch(/survey_version_immutable/i);
  });

  it("deleting a published version is refused", async () => {
    const error = await attempt(
      db.migrator.execute(sql`delete from app.survey_version where id = ${v1.versionId}`),
    );
    expect(error).toMatch(/survey_version_immutable/i);
  });

  it("editing a question of a published version is refused", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        update app.survey_question set prompt = '¿Otra pregunta?'
        where id = ${v1.questionIds.tenure_category!}
      `),
    );
    expect(error).toMatch(/survey_definition_frozen/i);
  });

  it("deleting a question of a published version is refused", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        delete from app.survey_question where id = ${v1.questionIds.has_concern!}
      `),
    );
    expect(error).toMatch(/survey_definition_frozen/i);
  });

  it("editing or removing an option of a published version is refused", async () => {
    const update = await attempt(
      db.migrator.execute(sql`
        update app.survey_option set label = 'Otra etiqueta'
        where id = ${v1.optionIds.option_y!}
      `),
    );
    expect(update).toMatch(/survey_definition_frozen/i);

    const remove = await attempt(
      db.migrator.execute(sql`delete from app.survey_option where id = ${v1.optionIds.option_y!}`),
    );
    expect(remove).toMatch(/survey_definition_frozen/i);
  });

  it("adding a question to a published version is refused", async () => {
    const error = await attempt(
      db.migrator.insert(fieldSchema.surveyQuestion).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        versionId: v1.versionId,
        code: "smuggled_in",
        ordinal: 9,
        type: "SHORT_TEXT",
        prompt: "Pregunta añadida después de publicar",
        helpText: null,
        required: false,
        sensitivity: "NON_PERSONAL",
      }),
    );
    expect(error).toMatch(/survey_definition_frozen/i);
  });
});

describe("Slice 3 · a submitted response keeps its version", () => {
  it("S1 still points at v1", async () => {
    const rows = await db.migrator.execute(sql`
      select survey_version_id, status from app.survey_instance where id = ${instanceOnV1}
    `);
    expect(rows.rows[0]).toMatchObject({
      survey_version_id: v1.versionId,
      status: "SUBMITTED",
    });
  });

  it("rendering S1 reads v1's definition, not v2's", async () => {
    // The join a read model makes: instance → its version → that version's questions. v2's
    // renamed question must not appear, and v1's `option_y` must still be offered.
    const rows = await db.migrator.execute(sql`
      select q.code, q.ordinal
      from app.survey_instance i
      join app.survey_question q on q.version_id = i.survey_version_id
      where i.id = ${instanceOnV1}
      order by q.ordinal
    `);
    const codes = rows.rows.map((r) => (r as { code: string }).code);
    expect(codes).toEqual(["tenure_category", "has_concern", "services_present"]);
    expect(codes).not.toContain("tenure_category_revised");
  });

  it("S1's answers still resolve to v1's option labels", async () => {
    const rows = await db.migrator.execute(sql`
      select o.code
      from app.survey_answer a
      join app.survey_option o on o.id = a.option_id
      where a.instance_id = ${instanceOnV1}
    `);
    expect(rows.rows.map((r) => (r as { code: string }).code)).toEqual(["option_x"]);
  });

  it("v2 cannot reinterpret S1 by having the instance re-pointed at it", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        update app.survey_instance set survey_version_id = ${v2.versionId}
        where id = ${instanceOnV1}
      `),
    );
    expect(error).toMatch(/survey_instance_submitted|survey_instance_version_fixed/i);

    const check = await db.migrator.execute(sql`
      select survey_version_id from app.survey_instance where id = ${instanceOnV1}
    `);
    expect((check.rows[0] as { survey_version_id: string }).survey_version_id).toBe(v1.versionId);
  });

  it("a submitted answer cannot be edited, not even a spelling correction", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        update app.survey_answer set option_id = ${v1.optionIds.option_y!}
        where instance_id = ${instanceOnV1} and option_id is not null
      `),
    );
    expect(error).toMatch(/survey_answer_frozen/i);
  });

  it("an answer cannot be added to a submitted response", async () => {
    const error = await attempt(
      db.migrator.insert(fieldSchema.surveyAnswer).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        instanceId: instanceOnV1,
        questionId: v1.questionIds.tenure_category!,
        textValue: "añadida después",
      }),
    );
    expect(error).toMatch(/survey_answer_frozen/i);
  });

  it("the technician who answered is still recorded, and it is the one who did", async () => {
    const rows = await db.migrator.execute(sql`
      select respondent_user_id from app.survey_instance where id = ${instanceOnV1}
    `);
    expect((rows.rows[0] as { respondent_user_id: string }).respondent_user_id).toBe(technicianId);
  });
});

describe("Slice 3 · an answer's value matches its question's type", () => {
  it("a text value cannot be stored against a boolean question", async () => {
    // A fresh, still-open instance, because the submitted one refuses writes for another reason.
    const draft = await openDraft();
    const error = await attempt(
      db.migrator.insert(fieldSchema.surveyAnswer).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        instanceId: draft,
        questionId: v2.questionIds.has_concern!,
        textValue: "sí, más o menos",
      }),
    );
    expect(error).toMatch(/survey_answer_type_mismatch/i);
  });

  it("an option from another question cannot be chosen", async () => {
    const draft = await openDraft();
    const error = await attempt(
      db.migrator.insert(fieldSchema.surveyAnswer).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        instanceId: draft,
        questionId: v2.questionIds.tenure_category_revised!,
        optionId: v1.optionIds.option_y!,
      }),
    );
    expect(error).toMatch(/survey_answer_option_mismatch/i);
  });
});

/** A second assignment and an open instance on v2, for the type-consistency assertions. */
async function openDraft(): Promise<string> {
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    datasetVersionId: draftDatasetVersionId,
    parcelCode: `PRED-VER-${String(drafts + 2).padStart(3, "0")}`,
    lon: -78.93 - drafts / 100,
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: v2.versionId,
  });
  const assignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    campaignId: campaign.id,
    parcelId: parcel.parcelId,
    assigneeMembershipId: technicianMembershipId,
    assigneeUserId: technicianId,
  });
  drafts += 1;
  const { instanceId } = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    assignmentId: assignment.id,
    technicianUserId: technicianId,
    surveyVersionId: v2.versionId,
  });
  return instanceId;
}

let drafts = 0;
