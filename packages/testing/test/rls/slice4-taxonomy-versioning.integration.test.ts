import { socialSchema } from "@eia/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attempt,
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
  seedTwoTenantWorld,
  type SeededTaxonomy,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * A coding means what the scheme said when the coding was made.
 *
 * This is the taxonomy's version of the survey-versioning regression, and it exists for the same
 * reason: a coding scheme is refined over the life of a study, and if the refinement edits the old
 * definition then every historic coding silently acquires a new meaning. So v2 is a new version
 * with its own category rows, v1 keeps its own, and the classification and the review made against
 * v1 still resolve to v1 afterwards.
 *
 * Asserted on the migrator connection, which bypasses RLS: these are database triggers, and they
 * refuse a privileged path too — a future seeder, migration or worker included.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let prov: string;
let v1: SeededTaxonomy;
let v2: SeededTaxonomy;
let classificationId: string;
let reviewId: string;
let runId: string;
let answerId: string;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
    })
  ).id;

  // A specialist, a technician's response, and an answer to code.
  const specialist = await createUser(db.migrator, "social-specialist");
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: specialist.id,
    role: "MEMBER",
  });
  const projectMembership = await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: tenantMembership.id,
    role: "SOCIAL_SPECIALIST",
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
    parcelCode: "PRED-SOC-001",
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
    assigneeUserId: specialist.id,
  });
  const { instanceId } = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    assignmentId: assignment.id,
    technicianUserId: specialist.id,
    surveyVersionId: survey.versionId,
  });

  answerId = randomUUID();
  await db.migrator.insert((await import("@eia/db")).fieldSchema.surveyAnswer).values({
    id: answerId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    instanceId,
    questionId: survey.questionIds.has_concern!,
    booleanValue: true,
  });

  // v1: TOPIC_A, TOPIC_B, OTHER.
  v1 = await createPublishedTaxonomy(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    versionLabel: "v1",
    codes: ["TOPIC_A", "TOPIC_B"],
  });

  runId = (
    await createClassificationRun(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      taxonomyVersionId: v1.versionId,
      surveyVersionId: survey.versionId,
      questionId: survey.questionIds.has_concern!,
      initiatedByUserId: specialist.id,
    })
  ).id;

  // C1: a proposal on v1, labelled TOPIC_A.
  classificationId = (
    await createAiClassification(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      runId,
      answerId,
      categoryIds: [v1.categoryIds.TOPIC_A!],
    })
  ).id;

  // H1: the specialist keeps TOPIC_A and adds TOPIC_B — a correction, on v1.
  reviewId = (
    await createHumanReview(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      classificationId,
      answerId,
      taxonomyVersionId: v1.versionId,
      reviewerUserId: specialist.id,
      reviewerMembershipId: projectMembership.id,
      decision: "CORRECTED",
      categoryIds: [v1.categoryIds.TOPIC_A!, v1.categoryIds.TOPIC_B!],
    })
  ).id;

  // v2 of the same taxonomy: TOPIC_B is gone, TOPIC_C arrives, and TOPIC_A's *definition* changes.
  v2 = await createPublishedTaxonomy(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    taxonomyId: v1.taxonomyId,
    versionLabel: "v2",
    codes: ["TOPIC_A", "TOPIC_C"],
  });
});
afterAll(() => db.close());

describe("Slice 4 · v1 survives v2 unchanged", () => {
  it("v1's version row is untouched", async () => {
    const rows = await db.migrator.execute(sql`
      select version_label, status::text as status from app.taxonomy_version
       where id = ${v1.versionId}
    `);
    expect(rows.rows[0]).toMatchObject({ version_label: "v1", status: "PUBLISHED" });
  });

  it("v1's categories are untouched, and v2 has its own rows", async () => {
    const one = await db.migrator.execute(sql`
      select code from app.taxonomy_category where version_id = ${v1.versionId} order by ordinal
    `);
    expect(one.rows.map((r) => (r as { code: string }).code)).toEqual([
      "TOPIC_A",
      "TOPIC_B",
      "OTHER",
    ]);

    const two = await db.migrator.execute(sql`
      select code from app.taxonomy_category where version_id = ${v2.versionId} order by ordinal
    `);
    expect(two.rows.map((r) => (r as { code: string }).code)).toEqual([
      "TOPIC_A",
      "TOPIC_C",
      "OTHER",
    ]);

    // The same code in both versions is two different rows. That is what stops a historic coding
    // from being re-pointed at a redefined category.
    expect(v2.categoryIds.TOPIC_A).not.toBe(v1.categoryIds.TOPIC_A);
  });

  it("both versions belong to one taxonomy", async () => {
    const rows = await db.migrator.execute(sql`
      select version_label from app.taxonomy_version where taxonomy_id = ${v1.taxonomyId}
       order by version_label
    `);
    expect(rows.rows.map((r) => (r as { version_label: string }).version_label)).toEqual([
      "v1",
      "v2",
    ]);
  });

  it("editing or deleting a published version is refused", async () => {
    expect(
      await attempt(
        db.migrator.execute(sql`
          update app.taxonomy_version set version_label = 'v1-edited' where id = ${v1.versionId}
        `),
      ),
    ).toMatch(/taxonomy_version_immutable/i);

    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.taxonomy_version where id = ${v1.versionId}`),
      ),
    ).toMatch(/taxonomy_version_immutable/i);
  });

  it("editing, deleting or adding a category of a published version is refused", async () => {
    expect(
      await attempt(
        db.migrator.execute(sql`
          update app.taxonomy_category set description = 'una definición más amplia'
           where id = ${v1.categoryIds.TOPIC_A!}
        `),
      ),
    ).toMatch(/taxonomy_categories_frozen/i);

    expect(
      await attempt(
        db.migrator.execute(sql`
          delete from app.taxonomy_category where id = ${v1.categoryIds.TOPIC_B!}
        `),
      ),
    ).toMatch(/taxonomy_categories_frozen/i);

    expect(
      await attempt(
        db.migrator.insert(socialSchema.taxonomyCategory).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          versionId: v1.versionId,
          code: "SMUGGLED_IN",
          label: "añadida después",
          description: "Una categoría añadida después de publicar la versión.",
          ordinal: 9,
        }),
      ),
    ).toMatch(/taxonomy_categories_frozen/i);
  });
});

describe("Slice 4 · C1 and H1 still resolve to v1", () => {
  it("the run still names v1", async () => {
    const rows = await db.migrator.execute(sql`
      select taxonomy_version_id from app.classification_run where id = ${runId}
    `);
    expect((rows.rows[0] as { taxonomy_version_id: string }).taxonomy_version_id).toBe(
      v1.versionId,
    );
  });

  it("the proposal's categories are v1's rows", async () => {
    const rows = await db.migrator.execute(sql`
      select cat.code, cat.version_id
        from app.ai_classification_category link
        join app.taxonomy_category cat on cat.id = link.category_id
       where link.classification_id = ${classificationId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ code: "TOPIC_A", version_id: v1.versionId });
  });

  it("the review still names v1, and its labels are v1's rows", async () => {
    const review = await db.migrator.execute(sql`
      select taxonomy_version_id, decision::text as decision from app.human_review
       where id = ${reviewId}
    `);
    expect(review.rows[0]).toMatchObject({
      taxonomy_version_id: v1.versionId,
      decision: "CORRECTED",
    });

    const labels = await db.migrator.execute(sql`
      select cat.code, cat.version_id from app.human_review_category link
        join app.taxonomy_category cat on cat.id = link.category_id
       where link.review_id = ${reviewId}
       order by cat.ordinal
    `);
    expect(labels.rows.map((r) => (r as { code: string }).code)).toEqual(["TOPIC_A", "TOPIC_B"]);
    for (const row of labels.rows as Array<{ version_id: string }>) {
      expect(row.version_id).toBe(v1.versionId);
    }
  });

  it("a v2 category cannot be attached to a v1 proposal", async () => {
    // The heart of it: v2 must not be able to reinterpret v1's codings, even by code equality.
    expect(
      await attempt(
        db.migrator.insert(socialSchema.aiClassificationCategory).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          classificationId,
          categoryId: v2.categoryIds.TOPIC_A!,
        }),
      ),
    ).toMatch(/coding_category_version_mismatch/i);
  });

  it("a v2 category cannot be attached to an existing review either", async () => {
    // Two rules refuse this and either is sufficient: the review is final, and the category
    // belongs to another version. The assertion accepts both, because which one fires first is an
    // ordering detail and the guarantee is that the write does not land.
    const error = await attempt(
      db.migrator.insert(socialSchema.humanReviewCategory).values({
        id: randomUUID(),
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        reviewId,
        categoryId: v2.categoryIds.TOPIC_C!,
      }),
    );
    expect(error).toMatch(/human_review_categories_final|coding_category_version_mismatch/i);

    const labels = await db.migrator.execute(sql`
      select count(*)::int as n from app.human_review_category where review_id = ${reviewId}
    `);
    expect((labels.rows[0] as { n: number }).n).toBe(2);
  });

  it("a brand-new review cannot be written with a category of another version", async () => {
    // The version rule on its own, with finality out of the way: a review created in one
    // transaction, carrying a category that belongs to v2 rather than to the run's v1.
    const error = await attempt(
      db.migrator.transaction(async (tx) => {
        const freshRun = await tx
          .insert(socialSchema.classificationRun)
          .values({
            id: randomUUID(),
            tenantId: w.tenantA.id,
            projectId: w.projectX.id,
            taxonomyVersionId: v1.versionId,
            sourceSurveyVersionId: (
              await tx.execute(
                sql`select id from app.survey_version where tenant_id = ${w.tenantA.id} limit 1`,
              )
            ).rows[0]!.id as string,
            sourceQuestionId: (
              await tx.execute(
                sql`select id from app.survey_question where tenant_id = ${w.tenantA.id} limit 1`,
              )
            ).rows[0]!.id as string,
            requestedModel: "fake/deterministic",
            classifierKind: "fake",
            promptVersion: "social-open-coding@1",
            promptHash: "0000000000000000",
            initiatedByUserId: w.memberA.id,
            provenanceId: prov,
          })
          .returning({ id: socialSchema.classificationRun.id });

        const freshClassification = randomUUID();
        await tx.insert(socialSchema.aiClassification).values({
          id: freshClassification,
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          runId: freshRun[0]!.id,
          answerId,
          status: "SUCCEEDED",
          provenanceId: prov,
        });

        const freshReview = randomUUID();
        await tx.insert(socialSchema.humanReview).values({
          id: freshReview,
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          classificationId: freshClassification,
          answerId,
          taxonomyVersionId: v1.versionId,
          reviewerUserId: w.memberA.id,
          reviewerMembershipId: w.memberAProjectXMembershipId,
          decision: "ACCEPTED",
          provenanceId: prov,
        });
        await tx.insert(socialSchema.humanReviewCategory).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          reviewId: freshReview,
          categoryId: v2.categoryIds.TOPIC_C!,
        });
      }),
    );
    expect(error).toMatch(/coding_category_version_mismatch/i);
  });

  it("a review cannot claim a different taxonomy version than its classification's run", async () => {
    expect(
      await attempt(
        db.migrator.insert(socialSchema.humanReview).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          classificationId,
          answerId,
          taxonomyVersionId: v2.versionId,
          reviewerUserId: w.memberA.id,
          reviewerMembershipId: w.memberAProjectXMembershipId,
          decision: "ACCEPTED",
          provenanceId: prov,
        }),
      ),
    ).toMatch(/human_review_version_mismatch|human_review_classification_key/i);
  });
});

describe("Slice 4 · a submitted review is final", () => {
  it("cannot be edited or deleted", async () => {
    expect(
      await attempt(
        db.migrator.execute(sql`
          update app.human_review set decision = 'ACCEPTED' where id = ${reviewId}
        `),
      ),
    ).toMatch(/human_review_final/i);

    expect(
      await attempt(db.migrator.execute(sql`delete from app.human_review where id = ${reviewId}`)),
    ).toMatch(/human_review_final/i);
  });

  it("cannot gain or lose a category afterwards", async () => {
    expect(
      await attempt(
        db.migrator.execute(sql`
          delete from app.human_review_category where review_id = ${reviewId}
        `),
      ),
    ).toMatch(/human_review_categories_final/i);
  });

  it("a second final review of the same proposal is refused", async () => {
    expect(
      await attempt(
        db.migrator.insert(socialSchema.humanReview).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          classificationId,
          answerId,
          taxonomyVersionId: v1.versionId,
          reviewerUserId: w.memberA.id,
          reviewerMembershipId: w.memberAProjectXMembershipId,
          decision: "ACCEPTED",
          provenanceId: prov,
        }),
      ),
    ).toMatch(/human_review_classification_key/i);
  });
});

describe("Slice 4 · a run codes against a published scheme", () => {
  it("a draft taxonomy version cannot be used by a run", async () => {
    const draftId = randomUUID();
    await db.migrator.insert(socialSchema.taxonomyVersion).values({
      id: draftId,
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      taxonomyId: v1.taxonomyId,
      versionLabel: "v3-draft",
      status: "DRAFT",
      provenanceId: prov,
    });

    const survey = await db.migrator.execute(sql`
      select id from app.survey_version where tenant_id = ${w.tenantA.id} limit 1
    `);
    const question = await db.migrator.execute(sql`
      select id from app.survey_question where tenant_id = ${w.tenantA.id} limit 1
    `);

    expect(
      await attempt(
        db.migrator.insert(socialSchema.classificationRun).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          taxonomyVersionId: draftId,
          sourceSurveyVersionId: (survey.rows[0] as { id: string }).id,
          sourceQuestionId: (question.rows[0] as { id: string }).id,
          requestedModel: "fake/deterministic",
          classifierKind: "fake",
          promptVersion: "social-open-coding@1",
          promptHash: "0000000000000000",
          initiatedByUserId: w.memberA.id,
          provenanceId: prov,
        }),
      ),
    ).toMatch(/classification_run_requires_published_taxonomy/i);
  });
});

describe("Slice 4 · run metadata is never reinterpreted (§57)", () => {
  it("a second run with a different model and prompt leaves the first untouched", async () => {
    const before = await db.migrator.execute(sql`
      select requested_model, prompt_version, prompt_hash, taxonomy_version_id
        from app.classification_run where id = ${runId}
    `);

    const survey = await db.migrator.execute(sql`
      select id from app.survey_version where tenant_id = ${w.tenantA.id} limit 1
    `);
    const question = await db.migrator.execute(sql`
      select id from app.survey_question where tenant_id = ${w.tenantA.id} limit 1
    `);
    await createClassificationRun(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      taxonomyVersionId: v2.versionId,
      surveyVersionId: (survey.rows[0] as { id: string }).id,
      questionId: (question.rows[0] as { id: string }).id,
      initiatedByUserId: w.memberA.id,
      requestedModel: "another/model",
      promptVersion: "social-open-coding@2",
      promptHash: "ffffffffffffffff",
    });

    const after = await db.migrator.execute(sql`
      select requested_model, prompt_version, prompt_hash, taxonomy_version_id
        from app.classification_run where id = ${runId}
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);

    // …and the first run's proposal still resolves to the scheme it was made against.
    const proposal = await db.migrator.execute(sql`
      select cat.version_id from app.ai_classification_category link
        join app.taxonomy_category cat on cat.id = link.category_id
       where link.classification_id = ${classificationId}
    `);
    expect((proposal.rows[0] as { version_id: string }).version_id).toBe(v1.versionId);
  });
});
