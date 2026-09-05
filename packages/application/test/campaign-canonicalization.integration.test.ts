import { appSchema, withDbContext } from "@eia/db";
import { PermissionDenied, type SessionUser } from "@eia/domain";
import {
  createAssignment,
  createCampaign,
  createParcelWithGeometry,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  createVisitWithInstance,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  buildSocialSnapshot,
  closeCampaign,
  loadFieldProgress,
  loadTabulation,
  supersedeOtherCampaigns,
} from "../src/index";

/**
 * The regression that made this rule necessary (ADR-026).
 *
 * A fixture revision changed which parcels the demo campaign should cover. The seeder filled the
 * new targets *beside* the ones already there rather than deleting anything — correctly, because
 * two of the old assignments carried submitted responses — and a twelve-parcel operation silently
 * became a twenty-two-parcel one that had never happened.
 *
 * The rule this file holds: a campaign with field history is never rewritten to adopt a changed
 * target universe. Changed semantics open a **new** campaign; the old one is closed and keeps
 * everything it did.
 *
 * Every assertion here is about rows *surviving*. The failure mode being tested is not a crash but
 * a quiet rewrite, so the test counts what is still there rather than what the code returned.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let prov: string;
let versionId: string;
let datasetVersionId: string;
let technicianMembershipId: string;
let technicianUserId: string;

/** V1's parcels, V2's parcels, and the overlap the real revision also had. */
const V1_PARCELS = ["PRED-CANON-001", "PRED-CANON-002", "PRED-CANON-003"] as const;
const V2_PARCELS = ["PRED-CANON-001", "PRED-CANON-010", "PRED-CANON-020"] as const;

const parcelIds = new Map<string, string>();

async function assignmentsOf(campaignId: string) {
  const rows = await db.migrator.execute(sql`
    select p.parcel_code, a.status::text as status, a.id
      from app.field_assignment a
      join app.parcel p on p.id = a.parcel_id
     where a.campaign_id = ${campaignId}
     order by p.parcel_code
  `);
  return rows.rows as Array<{ parcel_code: string; status: string; id: string }>;
}

async function submittedOf(campaignId: string): Promise<number> {
  const rows = await db.migrator.execute(sql`
    select count(*)::int as n
      from app.survey_instance i
      join app.field_assignment a on a.tenant_id = i.tenant_id and a.id = i.assignment_id
     where a.campaign_id = ${campaignId} and i.status = 'SUBMITTED'
  `);
  return (rows.rows[0] as { n: number }).n;
}

/** The seeder runs this inside its own transaction; the test does the same. */
const supersede = (currentCampaignId: string) =>
  withDbContext(
    db.migrator,
    { userId: null, tenantId: w.tenantA.id, projectId: w.projectX.id },
    (tx) =>
      supersedeOtherCampaigns(tx, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        currentCampaignId,
        supersededName: "Operativo de campo anterior",
        closedAt: new Date(),
      }),
  );

async function campaignRow(id: string) {
  const rows = await db.migrator.execute(sql`
    select name, status::text as status, closed_at from app.survey_campaign where id = ${id}
  `);
  return rows.rows[0] as { name: string; status: string; closed_at: Date | null } | undefined;
}

const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

const contextFor = (user: { id: string; email: string }) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  });

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of [
    "core.projects",
    "gis.maps",
    "gis.parcels",
    "field.surveys",
    "social.analytics",
  ] as const) {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({ tenantId: w.tenantA.id, capabilityKey: key, entitled: true, enabled: true })
      .onConflictDoUpdate({
        target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
        set: { entitled: true, enabled: true },
      });
  }
  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  versionId = survey.versionId;
  datasetVersionId = (
    await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
    })
  ).id;
  for (const [index, code] of [...new Set([...V1_PARCELS, ...V2_PARCELS])].entries()) {
    const parcel = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      datasetVersionId,
      parcelCode: code,
      lon: -78.9 - index / 100,
    });
    parcelIds.set(code, parcel.parcelId);
  }
  technicianMembershipId = w.memberAProjectXMembershipId;
  technicianUserId = w.memberA.id;
});

afterAll(() => db.close());

let v1: string;
let v2: string;

describe("a campaign with field history is never rewritten to match a newer plan", () => {
  it("V1 runs: three parcels, one of them visited and submitted", async () => {
    v1 = (
      await createCampaign(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: prov,
        surveyVersionId: versionId,
        name: "Operativo de campo · en curso",
      })
    ).id;

    for (const code of V1_PARCELS) {
      const assignment = await createAssignment(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: prov,
        campaignId: v1,
        parcelId: parcelIds.get(code)!,
        assigneeMembershipId: technicianMembershipId,
        assigneeUserId: technicianUserId,
        status: code === V1_PARCELS[0] ? "COMPLETED" : "PENDING",
      });
      if (code === V1_PARCELS[0]) {
        await createVisitWithInstance(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          provenanceId: prov,
          assignmentId: assignment.id,
          technicianUserId,
          surveyVersionId: versionId,
          submitted: true,
        });
      }
    }

    expect(await assignmentsOf(v1)).toHaveLength(3);
    expect(await submittedOf(v1)).toBe(1);
  });

  it("the revision closes V1 instead of adding V2's parcels to it", async () => {
    // The new revision is a *different campaign*, opened alongside the one that ran.
    v2 = (
      await createCampaign(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: prov,
        surveyVersionId: versionId,
        name: "Operativo de campo · en curso",
      })
    ).id;

    const result = await supersede(v2);

    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]).toMatchObject({ id: v1, assignments: 3, submitted: 1 });

    const row = await campaignRow(v1);
    expect(row?.status).toBe("CLOSED");
    expect(row?.name).toBe("Operativo de campo anterior");
    expect(row?.closed_at).not.toBeNull();

    // Nothing was deleted, moved or cancelled: the operation that ran is exactly as it was.
    expect((await assignmentsOf(v1)).map((a) => a.parcel_code)).toEqual([...V1_PARCELS].sort());
    expect(await submittedOf(v1)).toBe(1);
  });

  it("V2 receives only its own parcels, including the one both revisions share", async () => {
    for (const code of V2_PARCELS) {
      await createAssignment(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: prov,
        campaignId: v2,
        parcelId: parcelIds.get(code)!,
        assigneeMembershipId: technicianMembershipId,
        assigneeUserId: technicianUserId,
      });
    }

    expect((await assignmentsOf(v2)).map((a) => a.parcel_code)).toEqual([...V2_PARCELS].sort());
    // The shared parcel is assigned in both, which is what a per-campaign uniqueness rule allows:
    // the same ground surveyed twice by two operations is a fact, not a duplicate.
    expect(await assignmentsOf(v1)).toHaveLength(3);
    expect(await submittedOf(v2)).toBe(0);
  });

  it("seeding the same revision again changes nothing at all", async () => {
    const before = await db.migrator.execute(sql`
      select
        (select count(*)::int from app.survey_campaign where project_id = ${w.projectX.id}) as campaigns,
        (select count(*)::int from app.field_assignment where project_id = ${w.projectX.id}) as assignments,
        (select count(*)::int from app.survey_instance where project_id = ${w.projectX.id}) as instances
    `);

    const again = await supersede(v2);
    expect(again.closed).toEqual([]);

    const after = await db.migrator.execute(sql`
      select
        (select count(*)::int from app.survey_campaign where project_id = ${w.projectX.id}) as campaigns,
        (select count(*)::int from app.field_assignment where project_id = ${w.projectX.id}) as assignments,
        (select count(*)::int from app.survey_instance where project_id = ${w.projectX.id}) as instances
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect((await campaignRow(v1))?.status).toBe("CLOSED");
  });

  it("a draft is left alone, because there is no operation to close", async () => {
    const draft = (
      await createCampaign(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: prov,
        surveyVersionId: versionId,
        status: "DRAFT",
        name: "Operativo planificado",
      })
    ).id;

    const result = await supersede(v2);

    expect(result.closed).toEqual([]);
    const row = await campaignRow(draft);
    expect(row?.status).toBe("DRAFT");
    expect(row?.name).toBe("Operativo planificado");
  });
});

describe("the current operation is what the surfaces count", () => {
  it("V2 gets a submitted response of its own, so the two operations are distinguishable", async () => {
    const assignment = (await assignmentsOf(v2))[0]!;
    await createVisitWithInstance(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      assignmentId: assignment.id,
      technicianUserId,
      surveyVersionId: versionId,
      submitted: true,
    });
    expect(await submittedOf(v1)).toBe(1);
    expect(await submittedOf(v2)).toBe(1);
  });

  it("the Command Center's field panel reports the active campaign, not the closed one", async () => {
    const ctx = await contextFor(w.ownerA);
    const progress = await loadFieldProgress(db.runtime, ctx);
    expect(progress?.campaignId).toBe(v2);
    expect(progress?.status).toBe("ACTIVE");
    // The closed operation's three assignments are not added to today's workload.
    expect(progress?.progress.total).toBe(V2_PARCELS.length);
  });

  it("the tabulation's denominator is the current operation, not both of them", async () => {
    const ctx = await contextFor(w.ownerA);
    const tabulation = await loadTabulation(db.runtime, ctx, versionId);
    // Two submitted responses exist on this version. One belongs to an operation that closed, and
    // counting them together would describe two operations, months apart, as one sample.
    expect(tabulation.submitted).toBe(1);
  });

  it("a report snapshot counts one operation, and says which", async () => {
    const forCurrent = await withDbContext(
      db.runtime,
      // The snapshot counts response rows, so the unit of work needs the same door the generator
      // opens for it: `field.responses.read`, which the use-case resolves from the caller's role.
      {
        userId: w.ownerA.id,
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        fieldResponsesAccess: true,
      },
      (tx) =>
        buildSocialSnapshot(tx, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          surveyVersionId: versionId,
          campaignId: v2,
          campaignName: "Operativo de campo · en curso",
        }),
    );
    const universe = forCurrent.sections.find((s) => s.key === "universe");
    expect(universe?.facts.find((f) => f.key === "submitted")?.value).toBe("1");
    expect(universe?.summary).toContain("Operativo de campo · en curso");

    const forClosed = await withDbContext(
      db.runtime,
      // The snapshot counts response rows, so the unit of work needs the same door the generator
      // opens for it: `field.responses.read`, which the use-case resolves from the caller's role.
      {
        userId: w.ownerA.id,
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        fieldResponsesAccess: true,
      },
      (tx) =>
        buildSocialSnapshot(tx, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          surveyVersionId: versionId,
          campaignId: v1,
          campaignName: "Operativo de campo anterior",
        }),
    );
    // The closed operation is still fully readable — it is history, not a deletion.
    expect(
      forClosed.sections.find((s) => s.key === "universe")?.facts.find((f) => f.key === "submitted")
        ?.value,
    ).toBe("1");
  });
});

describe("closing a campaign is a permission, not a convenience", () => {
  it("a viewer cannot close one", async () => {
    const ctx = await contextFor(w.memberA);
    await expect(closeCampaign(db.runtime, ctx, v2)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("a coordinator can, and the campaign keeps everything it did", async () => {
    const ctx = await contextFor(w.ownerA);
    const result = await closeCampaign(db.runtime, ctx, v2);
    expect(result.status).toBe("CLOSED");
    expect(result.assignmentCount).toBe(V2_PARCELS.length);
    expect(result.submittedCount).toBe(1);
    expect(await assignmentsOf(v2)).toHaveLength(V2_PARCELS.length);
    expect(await submittedOf(v2)).toBe(1);
  });

  it("closing it twice is refused rather than silently repeated", async () => {
    const ctx = await contextFor(w.ownerA);
    await expect(closeCampaign(db.runtime, ctx, v2)).rejects.toThrow(/already closed/);
  });
});
