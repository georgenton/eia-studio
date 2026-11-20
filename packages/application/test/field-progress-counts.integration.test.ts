import { randomUUID } from "node:crypto";

import { PermissionDenied, type ProjectRole, type SessionUser } from "@eia/domain";
import {
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
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  loadAssignmentDetail,
  loadFieldOverview,
  loadMyWork,
  withFieldContext,
} from "../src/index";

/**
 * *How many* must not require permission to read *which* — and must not be obtainable by somebody
 * who may not have it at all (migration 0059, TD-045).
 *
 * The defect was the quiet kind. A *Gestor de información* opened **Trabajo de campo**, saw the
 * right campaign, and saw **0 asignadas · 0 pendientes · 0 enviadas** for an operation a
 * coordinator was reading as 13 and 8. Nothing failed, nothing was denied, and the number on the
 * screen was false, because the counts were aggregates over `app.field_assignment`, whose policy
 * admits a row only when it is the caller's own or they hold `field.responses.read`.
 *
 * The fix moves the counts behind privileged functions, which makes the *authorization* the thing
 * to prove rather than the query. Project access is not the permission — a technician is a member
 * of the project and must still not obtain its overview — so the gate is the resolved `field.read`
 * carried into the transaction, the way `field.responses.read` and `pii.read` already are.
 *
 * Every case below therefore comes in a pair: a number somebody is entitled to, and the door that
 * is still shut beside it.
 */
const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

const CAPABILITIES = ["core.projects", "gis.maps", "gis.parcels", "field.surveys"] as const;

const db = getTestDatabase();
let w: TwoTenantWorld;

interface Person {
  readonly id: string;
  readonly email: string;
}

let coordinator: Person;
let dataManager: Person;
let gis: Person;
let technician: Person;
let otherTechnician: Person;
let outsider: Person;
let prov: string;
let campaignId: string;
let emptyCampaignId: string;
let projectYCampaignId: string;
let completedAssignmentId: string;
let technicianMembershipId: string;
let otherTechnicianMembershipId: string;
let parcelSeq = 0;

/** A tenant member of A, optionally with a project role on project X. */
async function makePerson(label: string, role: ProjectRole | null) {
  const user = await createUser(db.migrator, label);
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: user.id,
    role: "MEMBER",
  });
  const projectMembership =
    role === null
      ? null
      : await createProjectMembership(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          tenantMembershipId: tenantMembership.id,
          role,
        });
  return {
    user: { id: user.id, email: user.email },
    tenantMembershipId: tenantMembership.id,
    // An assignment names the **project** membership, not the tenant one: that is what makes a
    // suspended project assignment suspend the work rather than leaving it orphaned.
    projectMembershipId: projectMembership?.id ?? null,
  };
}

async function newParcel(datasetVersionId: string, projectId: string, prefix: string) {
  parcelSeq += 1;
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId,
    datasetVersionId,
    provenanceId: prov,
    parcelCode: `${prefix}-${String(parcelSeq).padStart(3, "0")}`,
  });
  return parcel.parcelId;
}

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

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;

  const coord = await makePerson("coordinacion", "COORDINATOR");
  coordinator = coord.user;
  dataManager = (await makePerson("gestor", "PROJECT_DATA_MANAGER")).user;
  gis = (await makePerson("cartografia", "GIS_SPECIALIST")).user;
  const tech = await makePerson("tecnico-uno", "FIELD_TECHNICIAN");
  technician = tech.user;
  technicianMembershipId = tech.projectMembershipId!;
  const tech2 = await makePerson("tecnico-dos", "FIELD_TECHNICIAN");
  otherTechnician = tech2.user;
  otherTechnicianMembershipId = tech2.projectMembershipId!;
  outsider = (await makePerson("ajeno", null)).user;

  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  campaignId = (
    await createCampaign(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      surveyVersionId: survey.versionId,
      name: "Campaña con trabajo",
    })
  ).id;

  /*
   * Five original assignments, all the technician's own, in four states: two pending, one in
   * progress, one completed-and-submitted, one cancelled. Nobody else's row is involved, which is
   * exactly the condition that used to produce zeros for everybody else.
   */
  const states = ["PENDING", "PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
  let correctedInstanceId = "";
  for (const status of states) {
    const parcelId = await newParcel(dataset.id, w.projectX.id, "PRED-CNT");
    const assignment = await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId,
      assigneeMembershipId: technicianMembershipId,
      assigneeUserId: technician.id,
      status,
    });
    if (status === "COMPLETED") {
      const visit = await createVisitWithInstance(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: prov,
        assignmentId: assignment.id,
        technicianUserId: technician.id,
        surveyVersionId: survey.versionId,
        submitted: true,
      });
      completedAssignmentId = assignment.id;
      correctedInstanceId = visit.instanceId;
    }
  }

  /*
   * One **applied correction** of that submitted response: a second assignment, a second submitted
   * instance, and the `survey_correction` row saying which replaced which. The denominator must
   * not move (a correction is not a parcel) and the household must still count once.
   */
  const correctionParcel = await newParcel(dataset.id, w.projectX.id, "PRED-CNT");
  const correctionAssignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    campaignId,
    parcelId: correctionParcel,
    assigneeMembershipId: technicianMembershipId,
    assigneeUserId: technician.id,
    status: "COMPLETED",
  });
  const correctingVisit = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    assignmentId: correctionAssignment.id,
    technicianUserId: technician.id,
    surveyVersionId: survey.versionId,
    submitted: true,
  });
  await db.migrator.execute(sql`
    update app.field_assignment
       set corrects_assignment_id = ${completedAssignmentId}
     where tenant_id = ${w.tenantA.id} and id = ${correctionAssignment.id}
  `);
  await db.migrator.execute(sql`
    insert into app.survey_correction
      (id, tenant_id, project_id, original_instance_id, correction_assignment_id,
       correcting_instance_id, state, reason, requested_by_user_id, applied_at)
    values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${correctedInstanceId},
            ${correctionAssignment.id}, ${correctingVisit.instanceId}, 'APPLIED',
            'la superficie declarada no coincide con la cartografia', ${coordinator.id}, now())
  `);

  /* A second technician carrying two pending assignments, so workload has more than one row. */
  for (let i = 0; i < 2; i += 1) {
    const parcelId = await newParcel(dataset.id, w.projectX.id, "PRED-CNT");
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId,
      assigneeMembershipId: otherTechnicianMembershipId,
      assigneeUserId: otherTechnician.id,
      status: "PENDING",
    });
  }

  /* A campaign that genuinely has nothing in it: its zeros must be real zeros. */
  emptyCampaignId = (
    await createCampaign(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      surveyVersionId: survey.versionId,
      status: "DRAFT",
      name: "Campaña sin trabajo",
    })
  ).id;

  /*
   * A second project of the **same tenant**, with its own campaign and assignments, so "does
   * project X leak into project Y" is a question with a wrong answer available.
   */
  const provY = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  const surveyY = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    provenanceId: provY,
  });
  const datasetY = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    provenanceId: provY,
  });
  projectYCampaignId = (
    await createCampaign(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      provenanceId: provY,
      surveyVersionId: surveyY.versionId,
      name: "Campaña del otro proyecto",
    })
  ).id;
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    tenantMembershipId: coord.tenantMembershipId,
    role: "COORDINATOR",
  });
  const techY = await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    tenantMembershipId: tech.tenantMembershipId,
    role: "FIELD_TECHNICIAN",
  });
  for (let i = 0; i < 3; i += 1) {
    parcelSeq += 1;
    const parcel = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      datasetVersionId: datasetY.id,
      provenanceId: provY,
      parcelCode: `PRED-OTRO-${String(parcelSeq).padStart(3, "0")}`,
    });
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      provenanceId: provY,
      campaignId: projectYCampaignId,
      parcelId: parcel.parcelId,
      assigneeMembershipId: techY.id,
      assigneeUserId: technician.id,
      status: "PENDING",
    });
  }
});

afterAll(() => db.close());

const contextFor = (user: Person, projectSlug: string = w.projectX.slug) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug: w.tenantA.slug,
    projectSlug,
  });

const campaignOf = (view: Awaited<ReturnType<typeof loadFieldOverview>>, id: string) =>
  view.campaigns.find((c) => c.id === id);

/**
 * The database's own words, not the driver's.
 *
 * Drizzle wraps a failed statement in `Failed query: …` and keeps the server's message on
 * `cause`. Asserting on the wrapper would pass for *any* SQL error — a typo in the test included —
 * which is precisely the kind of green that proves nothing.
 */
async function refusalFrom(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error("expected the call to be refused, and it was not");
}

/* ---------------------------------------------------------------------------------------------
 * 1 · the figures, for everybody entitled to them
 * ------------------------------------------------------------------------------------------ */

describe("the counts a role with field.read is entitled to", () => {
  it("gives a coordinator the campaign's real progress", async () => {
    const view = await loadFieldOverview(db.runtime, await contextFor(coordinator));
    const campaign = campaignOf(view, campaignId);
    expect(campaign).toBeDefined();
    /*
     * Seven original assignments: five on the first technician (two pending, one in progress, one
     * completed, one cancelled) and two pending on the second. The applied correction is an eighth
     * assignment and is deliberately **not** in the denominator — a correction is not a parcel
     * (ADR-038), and counting it would turn seven parcels into eight the moment somebody asked for
     * one response to be captured again.
     */
    expect(campaign!.progress.total).toBe(7);
    expect(campaign!.progress.pending).toBe(4);
    expect(campaign!.progress.inProgress).toBe(1);
    expect(campaign!.progress.completed).toBe(1);
    expect(campaign!.progress.cancelled).toBe(1);
    // One household answered, whichever of its two responses is the effective one.
    expect(campaign!.submittedCount).toBe(1);
    expect(campaign!.openCorrections).toBe(0);
  });

  it.each([
    ["Gestor de informacion", () => dataManager],
    ["Cartografia / SIG", () => gis],
  ])("gives %s exactly the same numbers", async (_label, who) => {
    const reference = await loadFieldOverview(db.runtime, await contextFor(coordinator));
    const view = await loadFieldOverview(db.runtime, await contextFor(who()));

    // The regression, stated as plainly as it appeared: not "greater than zero", but *identical*
    // to what the coordinator is looking at. Two people must not be reading two different studies.
    expect(campaignOf(view, campaignId)!.progress).toEqual(
      campaignOf(reference, campaignId)!.progress,
    );
    expect(campaignOf(view, campaignId)!.progress.total).toBe(7);
    expect(campaignOf(view, campaignId)!.submittedCount).toBe(1);
  });

  it("counts each technician once, whatever the joins behind the row", async () => {
    const view = await loadFieldOverview(db.runtime, await contextFor(dataManager));
    expect(new Set(view.workload.map((r) => r.userId)).size).toBe(view.workload.length);

    const first = view.workload.find((r) => r.userId === technician.id)!;
    // Project-wide and excluding cancelled, **including** the revisit: two pending, one in
    // progress, two completed (the original and its correction).
    expect(first.pending).toBe(2);
    expect(first.inProgress).toBe(1);
    expect(first.completed).toBe(2);

    const second = view.workload.find((r) => r.userId === otherTechnician.id)!;
    expect(second.pending).toBe(2);
    expect(second.completed).toBe(0);
  });

  it("shows a real zero for a campaign that genuinely has nothing in it", async () => {
    const view = await loadFieldOverview(db.runtime, await contextFor(dataManager));
    const empty = campaignOf(view, emptyCampaignId);
    expect(empty).toBeDefined();
    expect(empty!.progress.total).toBe(0);
    expect(empty!.submittedCount).toBe(0);
    expect(empty!.openCorrections).toBe(0);
  });

  it("keeps an open correction out of the denominator and counts it separately", async () => {
    // A requested-but-not-captured correction changes no count (ADR-038) except its own.
    // Its own parcel: one assignment per (campaign, parcel) is a unique index, and a revisit of a
    // parcel that already has one is created on a fresh row in the real flow too.
    const datasetRow = await db.migrator.execute<{ id: string }>(sql`
      select id from app.spatial_dataset_version
       where tenant_id = ${w.tenantA.id} and project_id = ${w.projectX.id} limit 1
    `);
    const parcelId = await newParcel(datasetRow.rows[0]!.id, w.projectX.id, "PRED-REV");
    const open = await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId,
      assigneeMembershipId: technicianMembershipId,
      assigneeUserId: technician.id,
      status: "PENDING",
    });
    await db.migrator.execute(sql`
      update app.field_assignment set corrects_assignment_id = ${completedAssignmentId}
       where tenant_id = ${w.tenantA.id} and id = ${open.id}
    `);
    try {
      const campaign = campaignOf(
        await loadFieldOverview(db.runtime, await contextFor(coordinator)),
        campaignId,
      )!;
      expect(campaign.progress.total).toBe(7);
      expect(campaign.progress.pending).toBe(4);
      expect(campaign.openCorrections).toBe(1);
      expect(campaign.submittedCount).toBe(1);
    } finally {
      await db.migrator.execute(sql`
        delete from app.field_assignment where tenant_id = ${w.tenantA.id} and id = ${open.id}
      `);
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * 2 · the doors that stay shut
 * ------------------------------------------------------------------------------------------ */

describe("what counting still does not open", () => {
  it.each([
    ["Gestor de informacion", () => dataManager],
    ["Cartografia / SIG", () => gis],
  ])("refuses %s the individual response the counts are about", async (_label, who) => {
    const ctx = await contextFor(who());
    await expect(loadAssignmentDetail(db.runtime, ctx, completedAssignmentId)).rejects.toThrow();
  });

  it("refuses them the rows directly, not only through the read model", async () => {
    // The same question asked of the database rather than of the use-case: the row policies of
    // migration 0014 are untouched, so the answers themselves stay invisible.
    const ctx = await contextFor(dataManager);
    const seen = await withFieldContext(db.runtime, ctx, async (tx) => {
      const instances = await tx.execute(sql`select count(*)::int as n from app.survey_instance`);
      const media = await tx.execute(sql`select count(*)::int as n from app.field_media`);
      const assignments = await tx.execute(
        sql`select count(*)::int as n from app.field_assignment`,
      );
      return {
        instances: (instances.rows[0] as { n: number }).n,
        media: (media.rows[0] as { n: number }).n,
        assignments: (assignments.rows[0] as { n: number }).n,
      };
    });
    expect(seen).toEqual({ instances: 0, media: 0, assignments: 0 });
  });

  it("gives the coordinator that same assignment", async () => {
    const detail = await loadAssignmentDetail(
      db.runtime,
      await contextFor(coordinator),
      completedAssignmentId,
    );
    expect(detail.assignment.id).toBe(completedAssignmentId);
  });

  it("refuses a technician the overview and keeps their own work", async () => {
    const ctx = await contextFor(technician);
    await expect(loadFieldOverview(db.runtime, ctx)).rejects.toBeInstanceOf(PermissionDenied);
    const mine = await loadMyWork(db.runtime, ctx);
    expect(mine.length).toBeGreaterThan(0);
    for (const assignment of mine) {
      expect(assignment.parcelCode).toMatch(/^PRED-CNT-/);
    }
  });

  it("shows one technician nothing of the other's work", async () => {
    const ctx = await contextFor(otherTechnician);
    const mine = await loadMyWork(db.runtime, ctx);
    expect(mine).toHaveLength(2);
    await expect(loadAssignmentDetail(db.runtime, ctx, completedAssignmentId)).rejects.toThrow();
  });

  it("refuses an organisation administrator with no assignment on the project", async () => {
    /*
     * D-015: an ADMIN administers the tenant and has **no implicit access to a project's data**.
     * The context resolves — administering a project is a real thing they may do — and the counts
     * are refused, which is the layer that must hold. An ADMIN who needs the figures gets a
     * project membership, and that membership is an audited row.
     */
    const ctx = await contextFor(w.adminA);
    expect(ctx.projectRole).toBeNull();
    await expect(loadFieldOverview(db.runtime, ctx)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("refuses a tenant member with no project membership at all", async () => {
    await expect(contextFor(outsider)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("refuses a user of another tenant", async () => {
    await expect(
      buildRequestContext(db.runtime, {
        sessionUser: session(w.ownerB),
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

/* ---------------------------------------------------------------------------------------------
 * 3 · two projects of one tenant, and a context that does not match
 * ------------------------------------------------------------------------------------------ */

describe("project isolation inside one tenant", () => {
  it("does not mix two projects' campaigns or counts", async () => {
    const x = await loadFieldOverview(db.runtime, await contextFor(coordinator, w.projectX.slug));
    const y = await loadFieldOverview(db.runtime, await contextFor(coordinator, w.projectY.slug));

    expect(x.campaigns.map((c) => c.id).sort()).toEqual([campaignId, emptyCampaignId].sort());
    expect(y.campaigns.map((c) => c.id)).toEqual([projectYCampaignId]);
    expect(campaignOf(y, projectYCampaignId)!.progress.total).toBe(3);
    expect(campaignOf(x, campaignId)!.progress.total).toBe(7);
  });

  it("counts one technician's two projects separately", async () => {
    const y = await loadFieldOverview(db.runtime, await contextFor(coordinator, w.projectY.slug));
    const row = y.workload.find((entry) => entry.userId === technician.id)!;
    // Three pending in project Y; the six of project X are not here.
    expect(row.pending).toBe(3);
    expect(row.completed).toBe(0);
  });

  it("refuses a counter asked about a project the transaction is not acting on", async () => {
    const ctx = await contextFor(coordinator, w.projectX.slug);
    const message = await refusalFrom(() =>
      withFieldContext(db.runtime, ctx, (tx) =>
        tx.execute(
          sql`select * from app.field_campaign_counts(${w.tenantA.id}::uuid, ${w.projectY.id}::uuid)`,
        ),
      ),
    );
    expect(message).toMatch(/not acting on/i);
  });

  it("refuses the counter to a technician's own transaction", async () => {
    /*
     * The contract `has_project_access` cannot express, asked where it matters: a technician's
     * context is a real, verified context on this project, and `withFieldContext` sets
     * `app.field_read_access` to off for them — so a direct call is refused rather than handing
     * over the campaign the use-case would never have given them.
     */
    const ctx = await contextFor(technician);
    const message = await refusalFrom(() =>
      withFieldContext(db.runtime, ctx, (tx) =>
        tx.execute(
          sql`select * from app.field_campaign_counts(${w.tenantA.id}::uuid, ${w.projectX.id}::uuid)`,
        ),
      ),
    );
    expect(message).toMatch(/field\.read permission/i);
  });

  it("leaves no setting behind on a pooled connection", async () => {
    /*
     * `set_config(..., true)` is transaction-local, and the whole isolation model rests on it. A
     * coordinator's transaction turns the flag on; the next statement on the same pooled
     * connection must not inherit it.
     */
    await withFieldContext(db.runtime, await contextFor(coordinator), async (tx) => {
      const on = await tx.execute<{ v: boolean }>(sql`select app.can_read_field_workflow() as v`);
      expect(on.rows[0]!.v).toBe(true);
    });
    const bare = await db.runtime.execute<{ v: boolean }>(
      sql`select app.can_read_field_workflow() as v`,
    );
    expect(bare.rows[0]!.v).toBe(false);
    const tenantless = await db.runtime.execute<{ v: string | null }>(
      sql`select current_setting('app.tenant_id', true) as v`,
    );
    expect(tenantless.rows[0]!.v ?? "").toBe("");
  });
});
