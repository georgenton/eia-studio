import { appSchema } from "@eia/db";
import {
  FeatureDisabled,
  InvalidInput,
  PermissionDenied,
  reportSnapshotSchema,
  type SessionUser,
} from "@eia/domain";
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
  createTextAnswer,
  createUser,
  createVisitWithInstance,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type SeededTaxonomy,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  FakeNarrativeGenerator,
  generateSocialChapter,
  loadReportOverview,
  loadReportVersion,
  renderChapterDocx,
} from "../src/index";

/**
 * Report generation through the real use-cases and a real database.
 *
 * The properties that need a database are the ones about **what may become a sentence in a
 * chapter**: that a provisional AI classification never does, that a version keeps saying what it
 * said, and that a regenerated version differs only because its inputs did.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let specialist: { id: string; email: string };
let technician: { id: string; email: string };
let taxonomy: SeededTaxonomy;
let surveyVersionId: string;
let openQuestionId: string;
let classificationId: string;
let specialistMembershipId: string;
let answerId: string;
let prov: string;

const CAPABILITIES = [
  "core.projects",
  "gis.maps",
  "gis.parcels",
  "field.surveys",
  "social.analytics",
  "social.ai_coding",
  "core.documents",
  "quality.document_gate",
  "reports.social_generator",
] as const;

async function contextFor(user: { id: string; email: string }) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, {
    sessionUser,
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  });
}

const noNarrative = {
  state: "UNAVAILABLE" as const,
  reason: "NOT_CONFIGURED" as const,
  detail: "no narrative generator in this test",
};
const withNarrative = {
  state: "AVAILABLE" as const,
  kind: "fake" as const,
  model: "fake/deterministic",
  live: false,
};

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of CAPABILITIES) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }

  const make = async (
    label: string,
    role: "COORDINATOR" | "SOCIAL_SPECIALIST" | "FIELD_TECHNICIAN",
  ) => {
    const user = await createUser(db.migrator, label);
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: user.id,
      role: "MEMBER",
    });
    const membership = await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: tenantMembership.id,
      role,
    });
    return { ...user, membershipId: membership.id };
  };
  coordinator = await make("report-coordinator", "COORDINATOR");
  const specialistUser = await make("report-specialist", "SOCIAL_SPECIALIST");
  specialist = specialistUser;
  specialistMembershipId = specialistUser.membershipId;
  const technicianUser = await make("report-technician", "FIELD_TECHNICIAN");
  technician = technicianUser;

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;

  // A published version carrying the stock closed questions plus one open-text question: the
  // chapter needs both halves — a tabulation to compute and a response to have been coded.
  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    versionLabel: "v9",
    openTextCode: "concern_text",
  });
  surveyVersionId = survey.versionId;
  openQuestionId = survey.questionIds.concern_text!;

  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    datasetVersionId: dataset.id,
    parcelCode: "PRED-REP-001",
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId,
  });
  const assignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    campaignId: campaign.id,
    parcelId: parcel.parcelId,
    assigneeMembershipId: technicianUser.membershipId,
    assigneeUserId: technicianUser.id,
  });
  // Draft, then answer, then submit — the order the product enforces: a submitted instance's
  // answers are immutable, and a factory that inserted into one would be testing a database nobody
  // runs.
  const instance = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    assignmentId: assignment.id,
    technicianUserId: technicianUser.id,
    surveyVersionId,
    submitted: false,
  });
  answerId = (
    await createTextAnswer(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      instanceId: instance.instanceId,
      questionId: openQuestionId,
      text: "Preocupa el acceso al predio durante la obra.",
    })
  ).answerId;
  await db.migrator.execute(sql`
    update app.survey_instance set status = 'SUBMITTED', submitted_at = now()
     where tenant_id = ${w.tenantA.id} and id = ${instance.instanceId}
  `);

  taxonomy = await createPublishedTaxonomy(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    versionLabel: "v1",
    codes: ["ACCESS_PROPERTY_FENCES", "LOCAL_EMPLOYMENT"],
  });

  // A proposal with **no** review: the chapter must not count it.
  const run = await createClassificationRun(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    taxonomyVersionId: taxonomy.versionId,
    surveyVersionId,
    questionId: openQuestionId,
    initiatedByUserId: specialistUser.id,
  });
  classificationId = (
    await createAiClassification(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      runId: run.id,
      answerId,
      status: "SUCCEEDED",
      categoryIds: [taxonomy.categoryIds.ACCESS_PROPERTY_FENCES!],
    })
  ).id;
});
afterAll(() => db.close());

describe("a provisional coding never becomes a sentence in a chapter", () => {
  it("with proposals and no reviews, the themes section says nothing was validated", async () => {
    const result = await generateSocialChapter(
      db.runtime,
      await contextFor(coordinator),
      { surveyVersionId },
      { narrative: noNarrative },
    );
    expect(result.versionLabel).toBe("v1");

    const version = await loadReportVersion(db.runtime, await contextFor(coordinator), "v1");
    const themes = version.snapshot.sections.find((s) => s.key === "validated_themes")!;
    expect(themes.facts).toHaveLength(1);
    expect(themes.facts[0]!.value).toBe("—");
    expect(themes.facts[0]!.source).toMatchObject({ kind: "human_review", reviews: 0 });

    // …and the proposal really is there, so this is a refusal to count it rather than an absence
    // of anything to count.
    const proposals = await db.migrator.execute(
      sql`select count(*)::int as n from app.ai_classification where tenant_id = ${w.tenantA.id}`,
    );
    expect((proposals.rows[0] as { n: number }).n).toBe(1);
  });

  it("once a specialist validates it, the figure appears with its review count", async () => {
    await createHumanReview(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      classificationId,
      answerId,
      taxonomyVersionId: taxonomy.versionId,
      reviewerUserId: specialist.id,
      reviewerMembershipId: specialistMembershipId,
      categoryIds: [taxonomy.categoryIds.ACCESS_PROPERTY_FENCES!],
    });

    await generateSocialChapter(
      db.runtime,
      await contextFor(coordinator),
      { surveyVersionId },
      { narrative: noNarrative },
    );
    const version = await loadReportVersion(db.runtime, await contextFor(coordinator), "v2");
    const themes = version.snapshot.sections.find((s) => s.key === "validated_themes")!;
    expect(themes.facts[0]!.value).not.toBe("—");
    expect(themes.facts[0]!.source).toMatchObject({ kind: "human_review", reviews: 1 });
  });
});

describe("a version says what it said", () => {
  it("the earlier version keeps the empty themes section", async () => {
    const v1 = await loadReportVersion(db.runtime, await contextFor(coordinator), "v1");
    const themes = v1.snapshot.sections.find((s) => s.key === "validated_themes")!;
    expect(themes.facts[0]!.value).toBe("—");
    expect(v1.superseded).toBe(true);
  });

  it("the database refuses to edit a version or its sections", async () => {
    const version = await loadReportVersion(db.runtime, await contextFor(coordinator), "v1");
    expect(
      await attempt(
        db.migrator.execute(sql`
          update app.report_version set survey_version_label = 'tampered' where id = ${version.id}
        `),
      ),
    ).toMatch(/report_version_immutable/);
    expect(
      await attempt(
        db.migrator.execute(sql`
          update app.report_section set narrative = 'tampered' where version_id = ${version.id}
        `),
      ),
    ).toMatch(/report_version_immutable/);
    // …and deleting one is refused too, so a version cannot be quietly withdrawn.
    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.report_version where id = ${version.id}`),
      ),
    ).toMatch(/report_version_immutable/);
  });

  it("regenerating with unchanged data produces a new version and says it is identical", async () => {
    const again = await generateSocialChapter(
      db.runtime,
      await contextFor(coordinator),
      { surveyVersionId },
      { narrative: noNarrative },
    );
    expect(again.versionLabel).toBe("v3");
    expect(again.unchangedFromPrevious).toBe(true);

    const overview = await loadReportOverview(db.runtime, await contextFor(coordinator));
    expect(overview.versions).toHaveLength(3);
    expect(overview.versions[0]!.digest).toBe(overview.versions[1]!.digest);
  });
});

describe("every figure carries a source, and the sources are rows", () => {
  it("no fact in any section lacks one", async () => {
    const version = await loadReportVersion(db.runtime, await contextFor(coordinator));
    const parsed = reportSnapshotSchema.parse(version.snapshot);
    const facts = parsed.sections.flatMap((s) => s.facts);
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) expect(fact.source.kind).toBeTruthy();
  });

  it("the section sources are queryable, not only embedded in the snapshot", async () => {
    const version = await loadReportVersion(db.runtime, await contextFor(coordinator));
    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from app.report_section_source s
        join app.report_section sec on sec.tenant_id = s.tenant_id and sec.id = s.section_id
       where sec.version_id = ${version.id}
    `);
    const facts = version.snapshot.sections.reduce((sum, s) => sum + s.facts.length, 0);
    expect((rows.rows[0] as { n: number }).n).toBe(facts);
  });

  it("a chapter built on demo provenance declares that regime", async () => {
    const version = await loadReportVersion(db.runtime, await contextFor(coordinator));
    expect(version.snapshot.regimes).toContain("DEMO_SIMULATION");
  });
});

describe("the narrative, when there is one", () => {
  it("is written from the snapshot and attached to its sections", async () => {
    const result = await generateSocialChapter(
      db.runtime,
      await contextFor(coordinator),
      { surveyVersionId },
      { narrative: withNarrative, create: () => new FakeNarrativeGenerator() },
    );
    expect(result.narrativeSections).toBeGreaterThan(0);

    const version = await loadReportVersion(
      db.runtime,
      await contextFor(coordinator),
      result.versionLabel,
    );
    expect(version.narrativeModel).toBe("fake/deterministic");
    expect(version.narratives.size).toBe(result.narrativeSections);
  });

  it("a paragraph stating a figure the section did not compute fails the generation", async () => {
    await expect(
      generateSocialChapter(
        db.runtime,
        await contextFor(coordinator),
        { surveyVersionId },
        {
          narrative: withNarrative,
          create: () =>
            new FakeNarrativeGenerator({
              narrative: "Se visitaron 999 predios durante el levantamiento.",
              onlyKeys: ["universe"],
            }),
        },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("without a generator the version is still complete", async () => {
    const version = await loadReportVersion(db.runtime, await contextFor(coordinator), "v1");
    expect(version.narrativeModel).toBeNull();
    expect(version.narratives.size).toBe(0);
    expect(version.snapshot.sections.length).toBeGreaterThan(0);
    expect(version.factCount).toBeGreaterThan(0);
  });
});

describe("who may generate and read a chapter", () => {
  it("a technician may do neither", async () => {
    const ctx = await contextFor(technician);
    await expect(loadReportOverview(db.runtime, ctx)).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      generateSocialChapter(db.runtime, ctx, { surveyVersionId }, { narrative: noNarrative }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("the capability gates the module whatever the permission says", async () => {
    await db.migrator.execute(sql`
      delete from app.project_capability_setting
       where tenant_id = ${w.tenantA.id} and project_id = ${w.projectX.id}
         and capability_key = 'reports.social_generator'
    `);
    await db.migrator.insert(appSchema.projectCapabilitySetting).values({
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      capabilityKey: "reports.social_generator",
      enabled: false,
    });
    const ctx = await contextFor(coordinator);
    await expect(loadReportOverview(db.runtime, ctx)).rejects.toBeInstanceOf(FeatureDisabled);
    await db.migrator.execute(sql`
      delete from app.project_capability_setting
       where tenant_id = ${w.tenantA.id} and project_id = ${w.projectX.id}
         and capability_key = 'reports.social_generator'
    `);
  });
});

describe("the .docx is a rendering of the snapshot, and says it is a draft", () => {
  it("renders, names itself after the version, and carries the draft marking", async () => {
    const version = await loadReportVersion(db.runtime, await contextFor(coordinator));
    const rendered = await renderChapterDocx({
      snapshot: version.snapshot,
      versionLabel: version.versionLabel,
      narratives: version.narratives,
      generatedAt: new Date(version.generatedAt),
    });
    expect(rendered.fileName).toContain(version.versionLabel);
    expect(rendered.fileName).toContain("borrador");
    expect(rendered.buffer.byteLength).toBeGreaterThan(1000);
    // A .docx is a zip; the magic bytes are the cheapest proof it is one rather than an error page.
    expect(rendered.buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("isolation", () => {
  it("no report row belongs to another project", async () => {
    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from app.report_version where project_id <> ${w.projectX.id}
    `);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("a version label that means nothing is not found", async () => {
    await expect(
      loadReportVersion(db.runtime, await contextFor(coordinator), "v999"),
    ).rejects.toThrow(/not found/i);
  });

  it("the audit trail records the generation and never the chapter's text", async () => {
    const rows = await db.migrator.execute(sql`
      select action, details::text as details from audit.log
       where action like 'reports.%' order by occurred_at
    `);
    const entries = rows.rows as Array<{ action: string; details: string }>;
    expect(entries.map((e) => e.action)).toContain("reports.version.generated");
    for (const entry of entries) {
      expect(entry.details).not.toContain("Cobertura del levantamiento");
      expect(entry.details).not.toContain("acceso al predio");
    }
  });

  it("every version carries a provenance record marked derived and pending", async () => {
    const rows = await db.migrator.execute(sql`
      select p.transformations::text as transformations, p.validation_state::text as validation
        from app.report_version v
        join app.provenance_record p on p.tenant_id = v.tenant_id and p.id = v.provenance_id
       where v.tenant_id = ${w.tenantA.id}
    `);
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows as Array<{ transformations: string; validation: string }>) {
      expect(row.transformations).toContain("DERIVED");
      // A chapter that recorded itself as validated would claim the one thing this slice does not
      // do: approve a deliverable (TD-060).
      expect(row.validation).toBe("PENDING");
    }
  });
});
