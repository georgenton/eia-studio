import { createDatabase, createPool, portalSchema } from "@eia/db";
import { FeatureDisabled, InvalidInput, PermissionDenied, type SessionUser } from "@eia/domain";
import {
  createAlignment,
  createInfluenceArea,
  createMetricSnapshot,
  createPgasChapter,
  createProjectMembership,
  createProvenanceRecord,
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
  buildClientPublicationDraft,
  buildRequestContext,
  loadPortalManagement,
  loadPublishedClientView,
  publishClientPublication,
} from "../src/index";

/**
 * The client portal through the real use-cases and a real database.
 *
 * The properties that need a database are the ones about **what may leave the firm**: that a
 * simulated figure cannot become client progress, that an unresolved internal disagreement is not
 * settled by accident on a client's page, that a publication keeps saying what it said, and that
 * opening the client's page reads the publication and not the operational record.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

/** Run and hand back whatever was thrown, so the *kind* of refusal can be asserted. */
async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}
let coordinator: { id: string; email: string };
let reviewer: { id: string; email: string };
let technician: { id: string; email: string };

const CAPABILITIES = ["core.projects", "gis.maps", "gis.parcels", "client.portal"] as const;

async function contextFor(
  user: { id: string; email: string },
  scope: { tenantSlug: string; projectSlug: string } = {
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  },
) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, { sessionUser, ...scope });
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const tenantId of [w.tenantA.id, w.tenantB.id]) {
    for (const key of CAPABILITIES) {
      await setTenantCapability(db.migrator, { tenantId, key, entitled: true, enabled: true });
    }
  }

  const make = async (label: string, role: "COORDINATOR" | "REVIEWER" | "FIELD_TECHNICIAN") => {
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
      role,
    });
    return user;
  };
  coordinator = await make("portal-coordinator", "COORDINATOR");
  reviewer = await make("portal-reviewer", "REVIEWER");
  technician = await make("portal-technician", "FIELD_TECHNICIAN");

  // The study's own concluded aggregates …
  const historical = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "HISTORICAL_OBSERVED",
      title: "Cifras agregadas del expediente",
    })
  ).id;
  // … and the simulated operation running beside them.
  const simulated = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
      title: "Operación de demostración",
    })
  ).id;

  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: historical,
    key: "universe_estimated",
    value: 141,
  });
  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: historical,
    key: "surveys_complete",
    value: 119,
  });
  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: historical,
    key: "consultation_participants",
    value: 185,
  });
  // A publishable *key* whose only value is simulated: the builder must drop it, not publish it.
  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: simulated,
    key: "corridor_length_km",
    value: 7.4,
  });
  // A simulated operational figure whose key is not publishable at all.
  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: simulated,
    key: "parcels_pending",
    value: 22,
  });

  const alignmentVersion = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: historical,
    kind: "alignment",
  });
  await createAlignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: alignmentVersion.id,
    provenanceId: historical,
    label: "Eje vial del estudio",
  });
  await createInfluenceArea(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: alignmentVersion.id,
    provenanceId: historical,
    label: "Área de influencia directa",
  });

  await createPgasChapter(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: historical,
    plans: [
      {
        code: "PPMI-01",
        title: "PLAN DE PREVENCIÓN Y MITIGACIÓN",
        measures: [{ programmeTitle: "PROGRAMA A" }, { programmeTitle: "PROGRAMA A" }],
      },
      { code: "PRC-01", title: "PLAN DE RELACIONES COMUNITARIAS", measures: [{}] },
    ],
  });
});

afterAll(() => db.close());

describe("building what a client may be shown", () => {
  it("publishes the study's own aggregates and nothing that is simulated", async () => {
    const ctx = await contextFor(coordinator);
    const draft = await buildClientPublicationDraft(db.runtime, ctx);
    const keys = [
      ...draft.payload.summary.facts,
      ...draft.payload.participation.facts,
      ...(draft.payload.managementPlan?.facts ?? []),
    ].map((fact) => fact.key);

    expect(keys).toContain("parcel_universe");
    expect(keys).toContain("socioeconomic_surveys");
    expect(keys).toContain("consultation_participants");
    // The corridor length exists as a figure, but the only value for it here is simulated.
    expect(keys).not.toContain("corridor_length_km");
    expect(draft.withheld.map((item) => item.key)).toContain("field_operation_progress");
  });

  it("never publishes the unresolved affected-parcel count", async () => {
    const ctx = await contextFor(coordinator);
    const draft = await buildClientPublicationDraft(db.runtime, ctx);
    const facts = [
      ...draft.payload.summary.facts,
      ...draft.payload.participation.facts,
      ...(draft.payload.managementPlan?.facts ?? []),
    ];
    // Neither number, and no figure that could be read as either. The corpus says 70 in one place
    // and 71 in another; a publication that picked one would settle an open review by accident.
    expect(facts.map((fact) => fact.value)).not.toContain("70");
    expect(facts.map((fact) => fact.value)).not.toContain("71");
    expect(facts.map((fact) => fact.label).join(" ")).not.toMatch(/afecta/i);
    expect(draft.withheld.map((item) => item.key)).toContain("affected_parcels");
  });

  it("publishes the corridor and its delimited areas, and no parcel geometry", async () => {
    const ctx = await contextFor(coordinator);
    const draft = await buildClientPublicationDraft(db.runtime, ctx);
    expect(draft.payload.territory.alignment?.label).toBe("Eje vial del estudio");
    expect(draft.payload.territory.influenceAreas).toHaveLength(1);
    // The territory has exactly two shapes of thing in it, and no third: no parcel identity, no
    // parcel geometry, nothing that resolves to a person's land.
    expect(Object.keys(draft.payload.territory).sort()).toEqual([
      "alignment",
      "influenceAreas",
      "note",
    ]);
    expect(JSON.stringify(draft.payload)).not.toMatch(/parcelcode|parcel_code|predio\s+P-/i);
  });

  it("counts the management plan's plans, programmes and measures", async () => {
    const ctx = await contextFor(coordinator);
    const draft = await buildClientPublicationDraft(db.runtime, ctx);
    const facts = Object.fromEntries(
      (draft.payload.managementPlan?.facts ?? []).map((f) => [f.key, f.value]),
    );
    expect(facts["pgas_plans"]).toBe("2");
    expect(facts["pgas_measures"]).toBe("3");
    // Two measures share a banner inside one plan; the other plan has none.
    expect(facts["pgas_programmes"]).toBe("1");
    expect(draft.payload.managementPlan?.plans.map((p) => p.code)).toEqual(["PPMI-01", "PRC-01"]);
  });

  it("says nothing about operational progress or deliverables it does not have", async () => {
    const ctx = await contextFor(coordinator);
    const draft = await buildClientPublicationDraft(db.runtime, ctx);
    expect(draft.payload.milestones).toEqual([]);
    expect(draft.payload.deliverables).toEqual([]);
    expect(draft.payload.forecast).toBeNull();
  });
});

describe("who may prepare and who may publish", () => {
  it("a reviewer may prepare and preview, and may not publish", async () => {
    const ctx = await contextFor(reviewer);
    await expect(buildClientPublicationDraft(db.runtime, ctx)).resolves.toBeDefined();
    const refused = await refusal(() => publishClientPublication(db.runtime, ctx));
    expect(refused).toBeInstanceOf(PermissionDenied);
  });

  it("a field technician may not even prepare one", async () => {
    const ctx = await contextFor(technician);
    const refused = await refusal(() => buildClientPublicationDraft(db.runtime, ctx));
    expect(refused).toBeInstanceOf(PermissionDenied);
  });

  it("a project without the capability has no portal at all", async () => {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key: "client.portal",
      entitled: true,
      enabled: false,
    });
    const ctx = await contextFor(coordinator);
    const refused = await refusal(() => buildClientPublicationDraft(db.runtime, ctx));
    expect(refused).toBeInstanceOf(FeatureDisabled);
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key: "client.portal",
      entitled: true,
      enabled: true,
    });
  });
});

describe("publishing", () => {
  it("writes v1, then v2, and never edits v1 into v2", async () => {
    const ctx = await contextFor(coordinator);
    const first = await publishClientPublication(db.runtime, ctx);
    expect(first.versionLabel).toBe("v1");

    const second = await publishClientPublication(db.runtime, ctx);
    expect(second.versionLabel).toBe("v2");
    expect(second.unchangedFromPrevious).toBe(true);

    const management = await loadPortalManagement(db.runtime, ctx);
    expect(management.history.map((entry) => entry.versionLabel)).toEqual(["v2", "v1"]);
    expect(management.latest?.sequence).toBe(2);
  });

  it("refuses to rewrite a publication, by grant and by trigger", async () => {
    // Read through the migrator: the runtime role sees nothing without a transaction context,
    // which is itself the RLS contract and is asserted separately below.
    const rows = await db.migrator
      .select({ id: portalSchema.clientPublication.id })
      .from(portalSchema.clientPublication)
      .limit(1);
    // The runtime role has no UPDATE at all; the migrator has it and still cannot, because the
    // trigger is what makes the immutability a property of the data rather than of a grant.
    const asRuntime = await refusal(() =>
      db.runtime
        .update(portalSchema.clientPublication)
        .set({ contentHash: "tampered" })
        .where(eq(portalSchema.clientPublication.id, rows[0]!.id)),
    );
    expect(asRuntime).toBeInstanceOf(Error);
    const asMigrator = await refusal(() =>
      db.migrator.execute(
        sql`update portal.client_publication set content_hash = 'tampered' where id = ${rows[0]!.id}`,
      ),
    );
    // Drizzle wraps the driver error; the trigger's own message is the cause.
    const cause = (asMigrator as { cause?: { message?: string } } | null)?.cause;
    expect(`${String(asMigrator)} ${cause?.message ?? ""}`).toMatch(/client_publication_immutable/);
  });

  it("records the decision in the audit log, without the payload", async () => {
    const rows = await db.migrator.execute(sql`
      select action, details from audit.log where action = 'portal.publication.published'
       order by occurred_at desc limit 1
    `);
    const row = rows.rows[0] as { action: string; details: Record<string, unknown> };
    expect(row.action).toBe("portal.publication.published");
    expect(Object.keys(row.details).sort()).toEqual([
      "figures",
      "sequence",
      "unchangedFromPrevious",
    ]);
  });
});

describe("the client's page reads the publication and nothing else", () => {
  it("returns the latest publication, and an earlier one on request", async () => {
    const ctx = await contextFor(coordinator);
    const latest = await loadPublishedClientView(db.runtime, ctx);
    expect(latest?.versionLabel).toBe("v2");
    const earlier = await loadPublishedClientView(db.runtime, ctx, { sequence: 1 });
    expect(earlier?.versionLabel).toBe("v1");
  });

  /**
   * The defining architectural property, asserted by watching the wire.
   *
   * A separate pool records the SQL text of every statement the read issues. The client view may
   * touch `portal.client_publication` and the transaction's own framing; it may not touch a
   * survey answer, an assignment, a validated coding, a finding, a document or a parcel — and
   * "may not" here means *does not appear in the statements*, not "was filtered afterwards".
   */
  it("issues no statement against an operational table", async () => {
    const seen: string[] = [];
    const pool = createPool(db.info.runtimeUrl, { max: 1 });
    pool.on("connect", (client) => {
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
        const first = args[0];
        const text =
          typeof first === "string"
            ? first
            : ((first as { text?: string } | undefined)?.text ?? "");
        // Quoting varies by builder; compare on a normalised form so `"portal"."x"` and
        // `portal.x` are the same statement to this assertion.
        if (text) seen.push(text.toLowerCase().replace(/"/g, ""));
        return original(...args);
      };
    });
    const observed = createDatabase(pool);
    try {
      const ctx = await contextFor(coordinator);
      seen.length = 0;
      await loadPublishedClientView(observed, ctx);
    } finally {
      await pool.end();
    }

    expect(seen.some((text) => text.includes("portal.client_publication"))).toBe(true);
    for (const table of [
      "survey_answer",
      "survey_instance",
      "field_assignment",
      "field_visit",
      "human_review",
      "ai_classification",
      "quality_finding",
      "specialist_review",
      "document_chunk",
      "parcel_geometry",
      "app.parcel",
      "audit.log",
    ]) {
      expect(seen.filter((text) => text.includes(table))).toEqual([]);
    }
  });
});

describe("tenant isolation", () => {
  it("tenant B cannot enumerate, preview or publish tenant A's publications", async () => {
    const outsider = await createUser(db.migrator, "portal-outsider");
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantB.id,
      userId: outsider.id,
      role: "MEMBER",
    });
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      tenantMembershipId: tenantMembership.id,
      role: "COORDINATOR",
    });

    // Their own project has nothing published, which is the honest answer …
    const own = await contextFor(outsider, {
      tenantSlug: w.tenantB.slug,
      projectSlug: w.projectZ.slug,
    });
    expect(await loadPublishedClientView(db.runtime, own)).toBeNull();
    expect((await loadPortalManagement(db.runtime, own)).history).toEqual([]);

    // … and tenant A's project is not reachable at all, which is the same answer a project that
    // does not exist gives.
    const across = await refusal(() =>
      contextFor(outsider, { tenantSlug: w.tenantA.slug, projectSlug: w.projectX.slug }),
    );
    expect(across).toBeInstanceOf(PermissionDenied);
  });

  it("the row-level policy hides another tenant's publication even from a direct query", async () => {
    const ctx = await contextFor(coordinator);
    const visible = await db.runtime.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${w.tenantB.id}, true)`);
      await tx.execute(sql`select set_config('app.project_id', ${w.projectZ.id}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      const rows = await tx
        .select({ id: portalSchema.clientPublication.id })
        .from(portalSchema.clientPublication)
        .where(
          and(
            eq(portalSchema.clientPublication.tenantId, w.tenantA.id),
            eq(portalSchema.clientPublication.projectId, w.projectX.id),
          ),
        );
      return rows.length;
    });
    expect(visible).toBe(0);
  });
});

describe("a project with nothing publishable", () => {
  it("refuses to publish an empty page", async () => {
    const bare = await createUser(db.migrator, "portal-bare");
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: bare.id,
      role: "MEMBER",
    });
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      tenantMembershipId: tenantMembership.id,
      role: "COORDINATOR",
    });
    const ctx = await contextFor(bare, {
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectY.slug,
    });
    const refused = await refusal(() => publishClientPublication(db.runtime, ctx));
    expect(refused).toBeInstanceOf(InvalidInput);
    expect(String(refused)).toMatch(/publication_has_nothing_to_say/);
  });
});
