import {
  CAPABILITY_KEYS,
  PROJECT_ROLE_PERMISSIONS,
  type CapabilitySet,
  type ProjectRole,
  type RequestContext,
} from "@eia/domain";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  asContext,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";

import { assignParcel } from "../src/field/assignments";
import {
  createSurveyTemplate,
  publishSurveyVersion,
  saveSurveyDefinition,
} from "../src/field/authoring";
import { createSurveyCampaign, listPublishableSurveyVersions } from "../src/field/create-campaign";
import { buildFieldPack } from "../src/field/field-pack";
import { activateCampaign, closeCampaign } from "../src/field/use-cases";

/**
 * The step that was missing: a project with parcels and a published questionnaire could not open
 * the operation that field work belongs to, so nothing ever reached a technician's phone.
 *
 * Everything here is synthetic and non-personal: two square parcels, a three-question form about
 * a fence and a gate, and three invented identities.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

function ctxFor(
  role: ProjectRole,
  project: { id: string; slug: string },
  tenant: { id: string; slug: string },
  userId?: string,
): RequestContext {
  return {
    requestId: randomUUID(),
    userId: userId ?? w.ownerA.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantMembershipId: w.ownerA.membershipId,
    tenantRole: "OWNER",
    projectId: project.id,
    projectSlug: project.slug,
    projectMembershipId: randomUUID(),
    projectRole: role,
    implicitOwnerProjectAccess: false,
    permissions: PROJECT_ROLE_PERMISSIONS[role],
    capabilities: Object.fromEntries(
      CAPABILITY_KEYS.map((k: string) => [k, true]),
    ) as CapabilitySet,
    locale: "es-EC",
    fieldResponsesAccess: true,
  } as RequestContext;
}

const coordinator = () => ctxFor("COORDINATOR", w.projectX, w.tenantA);

/** A questionnaire about a boundary, not about a household. */
const DEFINITION = {
  questions: [
    {
      code: "fence_present",
      ordinal: 0,
      type: "BOOLEAN" as const,
      prompt: "¿El predio tiene cerramiento?",
      helpText: null,
      required: true,
      sensitivity: "NON_PERSONAL" as const,
      section: null,
      options: [],
      translations: {},
    },
    {
      code: "gate_count",
      ordinal: 1,
      type: "INTEGER" as const,
      prompt: "¿Cuántos accesos tiene?",
      helpText: null,
      required: false,
      sensitivity: "NON_PERSONAL" as const,
      section: null,
      options: [],
      translations: {},
    },
    {
      code: "fence_material",
      ordinal: 2,
      type: "SINGLE_CHOICE" as const,
      prompt: "Material del cerramiento",
      helpText: null,
      required: false,
      sensitivity: "NON_PERSONAL" as const,
      section: null,
      options: [
        { code: "alambre", ordinal: 0, label: "Alambre", translations: {} },
        { code: "muro", ordinal: 1, label: "Muro", translations: {} },
      ],
      translations: {},
    },
  ],
};

/** Template → draft → definition → published version, through the real use-cases. */
async function publishedVersion(key: string): Promise<string> {
  const ctx = coordinator();
  const created = await createSurveyTemplate(db.runtime, ctx, {
    key,
    name: `Ficha ${key}`,
    description: null,
  });
  await saveSurveyDefinition(db.runtime, ctx, {
    versionId: created.versionId,
    definition: DEFINITION,
  });
  await publishSurveyVersion(db.runtime, ctx, { versionId: created.versionId });
  return created.versionId;
}

async function draftVersion(key: string): Promise<string> {
  const ctx = coordinator();
  const created = await createSurveyTemplate(db.runtime, ctx, {
    key,
    name: `Ficha ${key}`,
    description: null,
  });
  return created.versionId;
}

let parcelSeq = 0;

/** Synthetic parcels, written with the project's own provenance. Codes never repeat in a test. */
async function synthParcels(count: number): Promise<string[]> {
  const ids: string[] = [];
  await db.migrator.execute(sql`
    insert into app.provenance_record (id, tenant_id, project_id, regime, origin, transformations,
      granularity, title, note, validation_state)
    values ('11111111-1111-4111-8111-111111111111', ${w.tenantA.id}, ${w.projectX.id},
      'LIVE_OPERATIONAL','IMPORTED_DATASET', ARRAY['ORIGINAL']::app.provenance_transformation[],
      'INDIVIDUAL','predios sintéticos','sin datos de personas','PENDING')
    on conflict do nothing`);
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    await db.migrator.execute(sql`
      insert into app.parcel (id, tenant_id, project_id, parcel_code, side, status, provenance_id)
      values (${id}, ${w.tenantA.id}, ${w.projectX.id}, ${`P-${++parcelSeq}`}, 'right', 'estimated',
              '11111111-1111-4111-8111-111111111111')`);
    ids.push(id);
  }
  return ids;
}

/** A technician with a real project membership, so `assignParcel` has somebody to assign to. */
async function technicianMembership(): Promise<{ membershipId: string; userId: string }> {
  const userId = randomUUID();
  const tenantMembershipId = randomUUID();
  const membershipId = randomUUID();
  // Three statements, three calls: a parameterised multi-statement string is not something
  // PostgreSQL will prepare.
  await db.migrator.execute(sql`
    insert into app."user" (id, email, name)
    values (${userId}, ${`tecnico-${userId.slice(0, 8)}@example.invalid`}, 'Técnico sintético')`);
  await db.migrator.execute(sql`
    insert into app.tenant_membership (id, tenant_id, user_id, role, status)
    values (${tenantMembershipId}, ${w.tenantA.id}, ${userId}, 'MEMBER', 'active')`);
  await db.migrator.execute(sql`
    insert into app.project_membership (id, tenant_id, project_id, tenant_membership_id, role, status)
    values (${membershipId}, ${w.tenantA.id}, ${w.projectX.id}, ${tenantMembershipId},
            'FIELD_TECHNICIAN', 'active')`);
  return { membershipId, userId };
}

/*
 * A full reset between tests, not a targeted delete. A published `SurveyVersion` is frozen by
 * trigger — questions and options refuse INSERT, UPDATE *and* DELETE (ADR-037) — so a cleanup
 * that tried to tidy them was asking the product to break its own invariant. `truncate` is the
 * migrator's tool and goes under the trigger; the test harness should not need an exception.
 */
beforeEach(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  parcelSeq = 0;
});

describe("B · a draft campaign is opened against a published questionnaire", () => {
  it("records the version, the channel, who opened it and DRAFT", async () => {
    const versionId = await publishedVersion("ficha_b");
    const ctx = coordinator();
    const campaign = await createSurveyCampaign(db.runtime, ctx, {
      name: "Levantamiento sintético",
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    expect(campaign.status).toBe("DRAFT");
    expect(campaign.surveyVersionId).toBe(versionId);
    expect(campaign.reused).toBe(false);

    const row = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (
          await tx.execute<{
            name: string;
            status: string;
            capture_channel: string;
            created_by: string;
            offline_mode_at_activation: string | null;
            provenance_id: string;
          }>(sql`select name, status, capture_channel, created_by, offline_mode_at_activation,
                      provenance_id from app.survey_campaign`)
        ).rows[0],
    );
    expect(row?.name).toBe("Levantamiento sintético");
    expect(row?.status).toBe("DRAFT");
    expect(row?.capture_channel).toBe("EIA_FIELD_MOBILE");
    expect(row?.created_by).toBe(ctx.userId);
    // The offline policy binds at activation, not here.
    expect(row?.offline_mode_at_activation).toBeNull();

    const prov = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (
          await tx.execute<{ regime: string; origin: string }>(
            sql`select regime, origin from app.provenance_record where id = ${row?.provenance_id}`,
          )
        ).rows[0],
    );
    // A real operation, never a demonstration.
    expect(prov?.regime).toBe("LIVE_OPERATIONAL");

    const audit = await db.migrator.execute<{ action: string; details: unknown }>(
      sql`select action, details from audit.log where action = 'field.campaign.created'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]?.details)).not.toContain("P-1");
  });

  it("K · a repeated submit returns the same draft rather than a second one", async () => {
    const versionId = await publishedVersion("ficha_k");
    const ctx = coordinator();
    const input = {
      name: "Doble clic",
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE" as const,
    };
    const first = await createSurveyCampaign(db.runtime, ctx, input);
    const second = await createSurveyCampaign(db.runtime, ctx, input);
    expect(second.reused).toBe(true);
    expect(second.campaignId).toBe(first.campaignId);
    const n = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.survey_campaign`))
          .rows[0]?.n,
    );
    expect(n).toBe(1);
  });
});

describe("C · a campaign may only be opened against a questionnaire that was published here", () => {
  it("refuses a draft version", async () => {
    const versionId = await draftVersion("ficha_c1");
    await expect(
      createSurveyCampaign(db.runtime, coordinator(), {
        name: "Sobre un borrador",
        surveyVersionId: versionId,
        captureChannel: "EIA_FIELD_MOBILE",
      }),
    ).rejects.toThrow(/published/);
  });

  it("refuses a retired version", async () => {
    const versionId = await publishedVersion("ficha_c2");
    await db.migrator.execute(
      sql`update app.survey_version set status = 'RETIRED' where id = ${versionId}`,
    );
    await expect(
      createSurveyCampaign(db.runtime, coordinator(), {
        name: "Sobre una retirada",
        surveyVersionId: versionId,
        captureChannel: "EIA_FIELD_MOBILE",
      }),
    ).rejects.toThrow(/published/);
  });

  it("refuses a version of another project, and of another tenant", async () => {
    const versionId = await publishedVersion("ficha_c3");
    for (const other of [
      ctxFor("COORDINATOR", w.projectY, w.tenantA),
      ctxFor("COORDINATOR", w.projectZ, w.tenantB),
    ]) {
      await expect(
        createSurveyCampaign(db.runtime, other, {
          name: "Versión ajena",
          surveyVersionId: versionId,
          captureChannel: "EIA_FIELD_MOBILE",
        }),
      ).rejects.toThrow();
    }
  });
});

describe("D · opening a campaign is a coordinator's act", () => {
  for (const role of ["FIELD_TECHNICIAN", "GIS_SPECIALIST", "VIEWER"] as const) {
    it(`refuses ${role}`, async () => {
      const versionId = await publishedVersion(`ficha_d_${role.toLowerCase()}`);
      await expect(
        createSurveyCampaign(db.runtime, ctxFor(role, w.projectX, w.tenantA), {
          name: "Sin permiso",
          surveyVersionId: versionId,
          captureChannel: "EIA_FIELD_MOBILE",
        }),
      ).rejects.toThrow();
    });
  }
});

describe("E–G · draft → assignments → active", () => {
  it("E · a campaign with no assignments cannot be activated", async () => {
    const versionId = await publishedVersion("ficha_e");
    const ctx = coordinator();
    const c = await createSurveyCampaign(db.runtime, ctx, {
      name: "Sin asignaciones",
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    await expect(activateCampaign(db.runtime, ctx, c.campaignId)).rejects.toThrow();
  });

  it("F–G · two parcels assigned by hand, then activated", async () => {
    const versionId = await publishedVersion("ficha_g");
    const ctx = coordinator();
    const parcels = await synthParcels(4);
    const tech = await technicianMembership();
    const c = await createSurveyCampaign(db.runtime, ctx, {
      name: "Campaña sintética",
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    for (const parcelId of parcels.slice(0, 2)) {
      await assignParcel(db.runtime, ctx, {
        campaignId: c.campaignId,
        parcelId,
        assigneeMembershipId: tech.membershipId,
        note: null,
      });
    }
    const activated = await activateCampaign(db.runtime, ctx, c.campaignId);
    expect(activated.status).toBe("ACTIVE");
    expect(activated.assignmentCount).toBe(2);
    expect(activated.offlineMode).toBeDefined();

    // The other two parcels were not assigned by anybody, and nothing assigned them.
    const assignments = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.field_assignment`))
          .rows[0]?.n,
    );
    expect(assignments).toBe(2);

    const audit = await db.migrator.execute<{ action: string }>(
      sql`select action from audit.log where action = 'field.campaign.activated'`,
    );
    expect(audit.rows).toHaveLength(1);
  });
});

describe("H–I · the Field Pack a technician downloads", () => {
  it("carries this campaign, this version and exactly their assignments", async () => {
    const versionId = await publishedVersion("ficha_h");
    const ctx = coordinator();
    const parcels = await synthParcels(4);
    const tech = await technicianMembership();
    const c = await createSurveyCampaign(db.runtime, ctx, {
      name: "Campaña H",
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    for (const parcelId of parcels.slice(0, 2)) {
      await assignParcel(db.runtime, ctx, {
        campaignId: c.campaignId,
        parcelId,
        assigneeMembershipId: tech.membershipId,
        note: null,
      });
    }
    await activateCampaign(db.runtime, ctx, c.campaignId);

    const techCtx = ctxFor("FIELD_TECHNICIAN", w.projectX, w.tenantA, tech.userId);
    const options = {
      sessionExpiresAt: new Date(Date.now() + 86_400_000),
      technician: { email: "tecnico@example.invalid", name: "Técnico sintético" },
    };
    const pack = await buildFieldPack(db.runtime, techCtx, options);
    const json = JSON.stringify(pack);
    expect(json).toContain("Campaña H");
    expect(json).toContain("P-1");
    expect(json).toContain("P-2");
    // Not the parcels nobody assigned, and nothing of the other tenant.
    expect(json).not.toContain("P-3");
    expect(json).not.toContain(w.tenantB.slug);

    // I · downloading again creates no assignment.
    const before = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.field_assignment`))
          .rows[0]?.n,
    );
    await buildFieldPack(db.runtime, techCtx, options);
    const after = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.field_assignment`))
          .rows[0]?.n,
    );
    expect(after).toBe(before);
    expect(after).toBe(2);
  });
});

describe("J–K · one current operation, and a closed one stays closed", () => {
  async function activeCampaign(key: string, name: string): Promise<string> {
    const ctx = coordinator();
    const versionId = await publishedVersion(key);
    const [parcelId] = await synthParcels(1);
    const tech = await technicianMembership();
    const c = await createSurveyCampaign(db.runtime, ctx, {
      name,
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    await assignParcel(db.runtime, ctx, {
      campaignId: c.campaignId,
      parcelId: parcelId!,
      assigneeMembershipId: tech.membershipId,
      note: null,
    });
    await activateCampaign(db.runtime, ctx, c.campaignId);
    return c.campaignId;
  }

  it("J · a second activation is refused and the first keeps running", async () => {
    const ctx = coordinator();
    const firstId = await activeCampaign("ficha_j1", "Primera");
    const versionId = await publishedVersion("ficha_j2");
    const [parcelId] = await synthParcels(1);
    const tech = await technicianMembership();
    const second = await createSurveyCampaign(db.runtime, ctx, {
      name: "Segunda",
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    await assignParcel(db.runtime, ctx, {
      campaignId: second.campaignId,
      parcelId: parcelId!,
      assigneeMembershipId: tech.membershipId,
      note: null,
    });
    await expect(activateCampaign(db.runtime, ctx, second.campaignId)).rejects.toThrow(
      /already has an active campaign/,
    );

    // The first is untouched: not closed, not renamed.
    const rows = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (
          await tx.execute<{ id: string; status: string; name: string }>(
            sql`select id, status, name from app.survey_campaign order by name`,
          )
        ).rows,
    );
    expect(rows.find((r) => r.id === firstId)?.status).toBe("ACTIVE");
    expect(rows.find((r) => r.id === firstId)?.name).toBe("Primera");
    expect(rows.find((r) => r.id === second.campaignId)?.status).toBe("DRAFT");
  });

  it("K · a closed campaign takes no new assignment and does not reopen", async () => {
    const ctx = coordinator();
    const id = await activeCampaign("ficha_k2", "Cerrada");
    await closeCampaign(db.runtime, ctx, id);
    const [extra] = await synthParcels(1);
    const tech = await technicianMembership();
    await expect(
      assignParcel(db.runtime, ctx, {
        campaignId: id,
        parcelId: extra!,
        assigneeMembershipId: tech.membershipId,
        note: null,
      }),
    ).rejects.toThrow();
    await expect(activateCampaign(db.runtime, ctx, id)).rejects.toThrow();
  });
});

describe("M · opening a campaign touches nothing else", () => {
  it("writes no metric, affectation, document or extra questionnaire", async () => {
    const versionId = await publishedVersion("ficha_m");
    await createSurveyCampaign(db.runtime, coordinator(), {
      name: "Sólo la campaña",
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    const ctx = coordinator();
    for (const table of ["app.affectation", "app.source_document", "app.influence_area"]) {
      const n = await asContext(
        db.runtime,
        ctx,
        async (tx) =>
          (await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(table)}`))
            .rows[0]?.n,
      );
      expect(n).toBe(0);
    }
    const versions = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.survey_version`))
          .rows[0]?.n,
    );
    expect(versions).toBe(1);
  });

  it("lists only this project's published versions", async () => {
    await publishedVersion("ficha_pub");
    await draftVersion("ficha_draft");
    const list = await listPublishableSurveyVersions(db.runtime, coordinator());
    expect(list).toHaveLength(1);
    expect(list[0]?.templateName).toBe("Ficha ficha_pub");
  });
});
