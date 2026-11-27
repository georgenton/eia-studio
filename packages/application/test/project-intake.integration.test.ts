import { appSchema, fieldSchema, withDbContext } from "@eia/db";
import { PermissionDenied, type SessionUser } from "@eia/domain";
import { randomUUID } from "node:crypto";

import {
  attempt,
  createAssignment,
  createCampaign,
  createParcelWithGeometry,
  createProjectMembership,
  createVisitWithInstance,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activateProject,
  addProjectMembership,
  buildRequestContext,
  createProject,
  loadProjectIntake,
  updateProjectIntake,
} from "../src/index";

/**
 * *Preparar proyecto*, against a real database (ADR-030).
 *
 * Two things are worth proving here rather than in a unit test. **Least privilege is a property of
 * the running system**: a Project Data Manager who could reach a household's answers through some
 * other read model would still be a data manager on paper and a coordinator in practice. And
 * **readiness is decided on the server's picture**: activation recomputes the report inside the
 * use-case, so a browser that rendered a green page a minute ago cannot talk it into moving a
 * project that is not ready.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let dataManager: { id: string; email: string };
let technician: { id: string; email: string };
let prov: string;

const CAPABILITIES = [
  "core.projects",
  "core.documents",
  "gis.maps",
  "gis.parcels",
  "field.surveys",
] as const;

async function contextFor(user: { id: string; email: string }, projectSlug = w.projectX.slug) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, {
    sessionUser,
    tenantSlug: w.tenantA.slug,
    projectSlug,
  });
}

async function member(label: string, role: string) {
  const user = await createUser(db.migrator, label);
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: user.id,
    role: "MEMBER",
  });
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: tenantMembership.id,
    role: role as never,
  });
  return user;
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
  coordinator = await member("intake-coordinator", "COORDINATOR");
  dataManager = await member("intake-data-manager", "PROJECT_DATA_MANAGER");
  technician = await member("intake-technician", "FIELD_TECHNICIAN");

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;

  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: dataset.id,
    provenanceId: prov,
    parcelCode: "001",
  });

  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    translations: {
      locale: "en",
      questions: { tenure_category: { prompt: "Relationship to the parcel?" } },
    },
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: survey.versionId,
    captureChannel: "NATIVE_WEB",
  });

  // One real answer, so "the data manager sees zero" means the policy denied a row rather than
  // that there was nothing to deny.
  const technicianMembership = await db.migrator
    .select({ id: appSchema.projectMembership.id })
    .from(appSchema.projectMembership)
    .where(
      and(
        eq(appSchema.projectMembership.projectId, w.projectX.id),
        eq(appSchema.projectMembership.role, "FIELD_TECHNICIAN"),
      ),
    );
  const assignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    campaignId: campaign.id,
    parcelId: parcel.parcelId,
    assigneeMembershipId: technicianMembership[0]!.id,
    assigneeUserId: technician.id,
  });
  const visit = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    assignmentId: assignment.id,
    technicianUserId: technician.id,
    surveyVersionId: survey.versionId,
  });
  await db.migrator.insert(fieldSchema.surveyAnswer).values({
    id: randomUUID(),
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    instanceId: visit.instanceId,
    questionId: survey.questionIds.has_concern!,
    booleanValue: true,
  });
});
afterAll(() => db.close());

async function setOfflineMode(mode: string) {
  const ctx = await contextFor(coordinator);
  await updateProjectIntake(db.runtime, ctx, {
    name: "Proyecto X",
    officialTitle: "Estudio socioambiental de prueba",
    programmeReference: null,
    locationLabel: "Provincia, País",
    offlineMode: mode,
  });
}

describe("what the intake reads", () => {
  it("carries the eight stages' facts from one consistent picture", async () => {
    await setOfflineMode("disabled");
    const view = await loadProjectIntake(db.runtime, await contextFor(coordinator));

    expect(view.project.officialTitle).toBe("Estudio socioambiental de prueba");
    expect(view.team.map((m) => m.role)).toContain("PROJECT_DATA_MANAGER");
    expect(view.cartography.parcelsWithGeometry).toBeGreaterThan(0);
    expect(view.surveys.some((s) => s.status === "PUBLISHED")).toBe(true);
    expect(view.campaign.captureChannel).toBe("NATIVE_WEB");
    expect(view.offlineMode).toBe("disabled");
    expect(view.editable).toBe(true);
  });

  it("reports the questionnaire's languages from the translations it actually has", async () => {
    const view = await loadProjectIntake(db.runtime, await contextFor(coordinator));
    const published = view.surveys.find((s) => s.status === "PUBLISHED")!;
    expect(published.locales).toEqual(["es-EC", "en"]);
  });

  it("is operable once its identity, coordinator and questionnaire are in place", async () => {
    const view = await loadProjectIntake(db.runtime, await contextFor(coordinator));
    expect(view.readiness.blocking).toEqual([]);
    expect(view.readiness.operable).toBe(true);
  });
});

describe("the Project Data Manager", () => {
  it("may prepare the project", async () => {
    const ctx = await contextFor(dataManager);
    await updateProjectIntake(db.runtime, ctx, {
      name: "Proyecto X",
      officialTitle: "Estudio socioambiental de prueba",
      programmeReference: "PROG-1",
      locationLabel: "Provincia, País",
      offlineMode: "disabled",
    });
    const view = await loadProjectIntake(db.runtime, ctx);
    expect(view.project.programmeReference).toBe("PROG-1");
    expect(view.editable).toBe(true);
  });

  it("cannot read an individual survey response", async () => {
    // The whole point of the role, proved on a real answer rather than on an empty table.
    //
    // `field.responses.read` is absent from the permission set, so the application layer sets
    // `app.field_responses_access = off`, and the row-level policy on `survey_answer` denies the
    // row underneath — the two layers of SECURITY.md §10b. The coordinator's read is the control:
    // the same query, the same row, one setting apart.
    const ctx = await contextFor(dataManager);
    expect(ctx.permissions.has("field.responses.read")).toBe(false);

    const asUser = (userId: string, fieldResponsesAccess: boolean) =>
      withDbContext(
        db.runtime,
        {
          userId,
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          fieldResponsesAccess,
        },
        async (tx) => {
          const rows = await tx.execute(sql`select count(*)::int as n from app.survey_answer`);
          return (rows.rows[0] as { n: number }).n;
        },
      );

    expect(await asUser(coordinator.id, true), "the coordinator reads the answer").toBe(1);
    expect(await asUser(dataManager.id, false), "the data manager does not").toBe(0);
  });

  it("cannot settle a finding, publish to the client or change a module", async () => {
    const ctx = await contextFor(dataManager);
    for (const permission of [
      "quality.review",
      "social.coding.review",
      "portal.publish",
      "portal.preview",
      "project.configure",
      "project.members.manage",
      "pii.read",
    ] as const) {
      expect(ctx.permissions.has(permission), permission).toBe(false);
    }
  });
});

describe("who may not open it at all", () => {
  it("a field technician is refused", async () => {
    const ctx = await contextFor(technician);
    expect(ctx.permissions.has("project.intake.read")).toBe(false);
    await expect(loadProjectIntake(db.runtime, ctx)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("a technician cannot write it either", async () => {
    const ctx = await contextFor(technician);
    await expect(
      updateProjectIntake(db.runtime, ctx, {
        name: "Suyo ahora",
        officialTitle: null,
        programmeReference: null,
        locationLabel: null,
        offlineMode: "disabled",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("nobody reaches another tenant's project through this surface", async () => {
    const error = await attempt(
      buildRequestContext(db.runtime, {
        sessionUser: {
          subject: dataManager.id,
          email: dataManager.email,
          name: null,
          emailVerified: true,
        },
        tenantSlug: w.tenantB.slug,
        projectSlug: w.projectY.slug,
      }),
    );
    expect(error).toBeTruthy();
  });
});

describe("the offline gate, in the database (D-020, ADR-018)", () => {
  it("blocks readiness when the project requires offline and the channel cannot", async () => {
    await setOfflineMode("required");
    const view = await loadProjectIntake(db.runtime, await contextFor(coordinator));
    expect(view.readiness.blocking).toContain("project.offline_channel");
    expect(view.readiness.operable).toBe(false);
  });

  it("refuses activation while it is blocked, and changes nothing", async () => {
    const ctx = await contextFor(coordinator);
    const result = await activateProject(db.runtime, ctx);
    expect(result.blocked).toContain("project.offline_channel");
    expect(result.lifecycle).toBe("planning");
    const [row] = await db.migrator
      .select({ lifecycle: appSchema.project.lifecycle })
      .from(appSchema.project)
      .where(eq(appSchema.project.id, w.projectX.id));
    expect(row?.lifecycle).toBe("planning");
  });

  it("is satisfied by the mobile channel, and then activation moves the project once", async () => {
    await db.migrator
      .update(fieldSchema.surveyCampaign)
      .set({ captureChannel: "EIA_FIELD_MOBILE" })
      .where(
        and(
          eq(fieldSchema.surveyCampaign.tenantId, w.tenantA.id),
          eq(fieldSchema.surveyCampaign.projectId, w.projectX.id),
        ),
      );

    const ctx = await contextFor(coordinator);
    const view = await loadProjectIntake(db.runtime, ctx);
    expect(view.readiness.operable).toBe(true);

    const first = await activateProject(db.runtime, ctx);
    expect(first).toEqual({ lifecycle: "field", blocked: [] });

    // Idempotent in the honest sense: a second press reports where the project is rather than
    // pretending to move it again.
    const second = await activateProject(db.runtime, ctx);
    expect(second).toEqual({ lifecycle: "field", blocked: [] });
  });

  it("writes an audit line for the activation, and only one", async () => {
    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from audit.log
       where action = 'project.activated' and object_id = ${w.projectX.id}
    `);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });
});

/**
 * Staffing a project, which until 27 November 2026 could not be done in this product at all.
 *
 * `addProjectMembership` was written, permission-checked and tested, and had **no caller**: there
 * is no tenant-settings route, the intake's team stage read and did not write, and *Nuevo
 * proyecto* therefore produced a project whose creator was refused at its own door —
 * *Tu rol Administración no incluye Preparar proyecto* — with no way back in except an operator
 * script that rewrites an identity's password (TD-111, observed on staging).
 */
describe("putting somebody on a project", () => {
  it("makes the creator its coordinator, so the project it just made can be opened", async () => {
    const admin = await createUser(db.migrator, "intake-creator-admin");
    await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: admin.id,
      role: "ADMIN",
    });
    const ctx = await buildRequestContext(db.runtime, {
      sessionUser: { subject: admin.id, email: admin.email, name: null, emailVerified: true },
      tenantSlug: w.tenantA.slug,
      projectSlug: null,
    });
    const slug = `creada-en-el-producto-${randomUUID().slice(0, 8)}`;
    await createProject(db.runtime, ctx, {
      name: "Creada en el producto",
      slug,
      profileKey: "road_eia_social",
    });

    // The point: the surface the product redirects to, opened by the person it redirected.
    const projectCtx = await buildRequestContext(db.runtime, {
      sessionUser: { subject: admin.id, email: admin.email, name: null, emailVerified: true },
      tenantSlug: w.tenantA.slug,
      projectSlug: slug,
    });
    expect(projectCtx.projectRole).toBe("COORDINATOR");
    const view = await loadProjectIntake(db.runtime, projectCtx);
    expect(view.team.map((m) => m.role)).toEqual(["COORDINATOR"]);

    // And it is an audited membership change, which is what TENANCY §6 asks of an ADMIN who
    // gains project data access — never an implicit one.
    const audited = await withDbContext(
      db.migrator,
      { userId: admin.id, tenantId: w.tenantA.id, projectId: view.project.id },
      (tx) =>
        tx.execute<{ action: string }>(sql`
          select action from audit.log
           where project_id = ${view.project.id} and action = 'project.membership.added'
        `),
    );
    expect(audited.rows).toHaveLength(1);
  });

  it("offers candidates to a coordinator and nothing at all to a data manager", async () => {
    const asCoordinator = await loadProjectIntake(db.runtime, await contextFor(coordinator));
    expect(asCoordinator.teamCandidates).not.toBeNull();
    // Everyone already on the project is excluded, by tenant membership.
    const onProject = new Set(asCoordinator.team.map((m) => m.membershipId));
    expect(asCoordinator.teamCandidates!.some((c) => onProject.has(c.tenantMembershipId))).toBe(
      false,
    );
    // No address: this page hands out a name and a role (ADR-030).
    for (const candidate of asCoordinator.teamCandidates!) {
      expect(Object.keys(candidate).sort()).toEqual([
        "displayName",
        "tenantMembershipId",
        "tenantRole",
      ]);
    }

    // Null, not empty: *this is not yours to decide* is a different statement from *there is
    // nobody left to add*, and the surface says each one differently.
    const asDataManager = await loadProjectIntake(db.runtime, await contextFor(dataManager));
    expect(asDataManager.teamCandidates).toBeNull();
  });

  it("refuses a data manager who calls the use-case anyway", async () => {
    const candidates = (await loadProjectIntake(db.runtime, await contextFor(coordinator)))
      .teamCandidates!;
    const ctx = await contextFor(dataManager);
    const refusal = await attempt(
      addProjectMembership(db.runtime, ctx, {
        tenantMembershipId: candidates[0]!.tenantMembershipId,
        role: "VIEWER",
      }),
    );
    expect(refusal).not.toBeNull();
    expect(refusal).toMatch(/permission/i);
  });

  it("lets a coordinator add somebody, who can then open the project", async () => {
    const newcomer = await createUser(db.migrator, "intake-newcomer");
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: newcomer.id,
      role: "MEMBER",
    });

    // Before: the project does not exist as far as this person is concerned. Resolving the
    // context refuses rather than returning a context with no role, which is the non-enumeration
    // rule the workspace routes follow (ADR-016).
    const session = {
      subject: newcomer.id,
      email: newcomer.email,
      name: null,
      emailVerified: true,
    };
    const before = await attempt(
      buildRequestContext(db.runtime, {
        sessionUser: session,
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    );
    expect(before).not.toBeNull();

    await addProjectMembership(db.runtime, await contextFor(coordinator), {
      tenantMembershipId: tenantMembership.id,
      role: "GIS_SPECIALIST",
    });

    const after = await buildRequestContext(db.runtime, {
      sessionUser: session,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    expect(after.projectRole).toBe("GIS_SPECIALIST");
  });

  it("never offers, and never accepts, a membership of another tenant", async () => {
    const stranger = await createUser(db.migrator, "intake-stranger");
    const foreign = await createTenantMembership(db.migrator, {
      tenantId: w.tenantB.id,
      userId: stranger.id,
      role: "MEMBER",
    });

    const view = await loadProjectIntake(db.runtime, await contextFor(coordinator));
    expect(view.teamCandidates!.some((c) => c.tenantMembershipId === foreign.id)).toBe(false);

    // And naming it directly is refused by the database's composite key, not only by the list.
    const coordinatorCtx = await contextFor(coordinator);
    const refusal = await attempt(
      addProjectMembership(db.runtime, coordinatorCtx, {
        tenantMembershipId: foreign.id,
        role: "VIEWER",
      }),
    );
    // The composite foreign key `(tenant_id, tenant_membership_id)` is what refuses it: a row of
    // this tenant cannot point at another tenant's membership even when the application asks.
    expect(refusal).not.toBeNull();
  });
});
