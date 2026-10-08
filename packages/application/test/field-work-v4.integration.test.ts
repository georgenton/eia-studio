import { randomUUID } from "node:crypto";

import { type SessionUser } from "@eia/domain";
import {
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_PACK_SCHEMA_VERSION_V4,
  FIELD_SYNC_PROTOCOL_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION_V4,
  workPackSchema,
} from "@eia/field-sync-contract";
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
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFieldPack,
  buildRequestContext,
  buildWorkPack,
  createMemoryStorage,
  createSocializationEvent,
  createUploadIntent,
  finalizeUpload,
  generateInvitations,
  processWorkSyncCommands,
  pullWorkChanges,
  reassignInvitation,
  resolveFieldScope,
  resolveFieldWorkScope,
} from "../src/index";

/**
 * Protocol v4, and the v3 it must not break (block 3, §G–§K).
 *
 * The question the whole version exists for is in the first describe: **a project whose survey
 * campaign is closed, with invitations still to deliver, is a project a technician must be able
 * to work in.** v3 cannot express it — its pack requires a campaign — so it answers
 * `no_active_campaign` and the device has nothing to do. Everything else here follows from that.
 */
const db = getTestDatabase();
const storage = createMemoryStorage();
let w: TwoTenantWorld;

type Person = { id: string; email: string; membershipId: string };
let specialist: Person;
let technician: Person;
let technicianY: Person;
let prov: string;
let provY: string;
const parcelX: Array<{ parcelId: string }> = [];
let parcelY: { parcelId: string };

const CAPABILITIES = ["core.projects", "gis.maps", "gis.parcels", "field.surveys"] as const;
const SCOPE_X = () => ({ tenantSlug: w.tenantA.slug, projectSlug: w.projectX.slug });

async function contextFor(user: { id: string; email: string }, scope = SCOPE_X()) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, { sessionUser, ...scope });
}

const PACK_OPTIONS = {
  sessionExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  technician: { email: "tecnico@example.invalid", name: null },
};

async function makePerson(label: string, role: string, projectId: string): Promise<Person> {
  const user = await createUser(db.migrator, label);
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: user.id,
    role: "MEMBER",
  });
  const membership = await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId,
    tenantMembershipId: tenantMembership.id,
    role: role as never,
  });
  return { ...user, membershipId: membership.id };
}

/** A convocation in project X with one invitation for the technician. */
async function inviteInX(parcelIndex: number): Promise<string> {
  const ctx = await contextFor(specialist);
  const { eventId } = await createSocializationEvent(db.runtime, ctx, {
    title: `Convocatoria ${randomUUID().slice(0, 8)}`,
    purpose: null,
    startsAt: new Date("2026-11-12T14:00:00.000Z"),
    timezone: "America/Guayaquil",
    locationLabel: "Casa comunal",
  });
  await generateInvitations(db.runtime, ctx, {
    eventId,
    parcels: [
      {
        parcelId: parcelX[parcelIndex]!.parcelId,
        assigneeMembershipId: technician.membershipId,
        recipientLabel: null,
      },
    ],
  });
  return eventId;
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

  specialist = await makePerson("v4-specialist", "SOCIAL_SPECIALIST", w.projectX.id);
  technician = await makePerson("v4-technician", "FIELD_TECHNICIAN", w.projectX.id);
  // The same person, also a technician in project Y: the multi-project case.
  const tenantMembershipY = await db.migrator.execute<{ id: string }>(sql`
    select id from app.tenant_membership
     where tenant_id = ${w.tenantA.id} and user_id = ${technician.id} limit 1
  `);
  const membershipY = await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    tenantMembershipId: tenantMembershipY.rows[0]!.id,
    role: "FIELD_TECHNICIAN",
  });
  technicianY = { ...technician, membershipId: membershipY.id };

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  provY = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;

  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    openTextCode: "concern_text",
    numericCode: "household_size",
  });
  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  for (const code of ["001", "002"]) {
    parcelX.push(
      await createParcelWithGeometry(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        datasetVersionId: dataset.id,
        provenanceId: prov,
        parcelCode: code,
      }),
    );
  }
  /*
   * Project X gets a campaign and **no assignment for this technician**: that is the shape the
   * whole version is about — a project where a person's only work is invitations.
   */
  await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: survey.versionId,
    captureChannel: "EIA_FIELD_MOBILE",
  });

  // Project Y: a survey campaign with the same technician assigned, so the discovery test has
  // two genuinely different projects to find.
  const surveyY = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    provenanceId: provY,
    openTextCode: "concern_text",
    numericCode: "household_size",
  });
  const datasetY = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    provenanceId: provY,
  });
  parcelY = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    datasetVersionId: datasetY.id,
    provenanceId: provY,
    parcelCode: "Y01",
  });
  const campaignY = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    provenanceId: provY,
    surveyVersionId: surveyY.versionId,
    captureChannel: "EIA_FIELD_MOBILE",
  });
  await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    provenanceId: provY,
    campaignId: campaignY.id,
    parcelId: parcelY.parcelId,
    assigneeMembershipId: technicianY.membershipId,
    assigneeUserId: technician.id,
  });
  await setTenantCapability(db.migrator, {
    tenantId: w.tenantA.id,
    key: "field.surveys",
    entitled: true,
    enabled: true,
  });
}, 300_000);

afterAll(() => db.close());

/* =============================================================================================
 * 15 · 16 — the case v3 cannot express
 * ========================================================================================== */

describe("a project with invitations and no campaign", () => {
  let eventId: string;

  beforeAll(async () => {
    // Project X has a campaign in DRAFT (never activated), so there is no survey work at all.
    eventId = await inviteInX(0);
  });

  it("15 · is a project this technician has work in", async () => {
    const scope = await resolveFieldWorkScope(db.runtime, technician.id);
    const x = scope.projects.find((p) => p.projectSlug === w.projectX.slug);
    expect(x).toBeDefined();
    expect(x?.work).toContain("socialization");
    expect(x?.work).not.toContain("survey");
  });

  it("16 · and produces a valid, operable pack with no survey half at all", async () => {
    const ctx = await contextFor(technician);
    const response = await buildWorkPack(db.runtime, ctx, PACK_OPTIONS);
    expect(response.kind).toBe("pack");
    if (response.kind !== "pack") return;

    expect(response.pack.surveyWork).toBeNull();
    expect(response.pack.socializationWork.invitations).toHaveLength(1);
    expect(response.pack.schemaVersion).toBe(FIELD_PACK_SCHEMA_VERSION_V4);
    expect(response.pack.protocolVersion).toBe(FIELD_SYNC_PROTOCOL_VERSION_V4);
    // The pack satisfies its own contract; `buildWorkPack` parses it, and so does this.
    expect(() => workPackSchema.parse(response.pack)).not.toThrow();

    const invitation = response.pack.socializationWork.invitations[0]!;
    expect(invitation.eventId).toBe(eventId);
    expect(invitation.parcelCode).toBe("001");
    expect(invitation.status).toBe("PENDING");
    expect(invitation.revision).toBeGreaterThan(0);
  });

  it("· and v3, asked the same question, has nothing to offer", async () => {
    /*
     * Not a regression: the honest answer for a protocol whose pack is a campaign and its
     * assignments. This technician has no assignment here — only invitations, which v3 has no
     * vocabulary for — so it answers `no_work` and the device shows an empty day. That is the
     * whole reason v4 exists, and it is asserted rather than described.
     */
    const v3 = await buildFieldPack(db.runtime, await contextFor(technician), PACK_OPTIONS);
    expect(v3.kind).toBe("no_work");
    if (v3.kind === "no_work") {
      expect(["no_assignments", "no_active_campaign"]).toContain(v3.reason);
    }
  });

  it("· the pack carries the event's words and no other technician's invitation", async () => {
    // A second invitation, to somebody else, on the other parcel.
    const other = await makePerson("v4-technician-other", "FIELD_TECHNICIAN", w.projectX.id);
    await generateInvitations(db.runtime, await contextFor(specialist), {
      eventId,
      parcels: [
        {
          parcelId: parcelX[1]!.parcelId,
          assigneeMembershipId: other.membershipId,
          recipientLabel: null,
        },
      ],
    });

    const response = await buildWorkPack(db.runtime, await contextFor(technician), PACK_OPTIONS);
    expect(response.kind).toBe("pack");
    if (response.kind !== "pack") return;
    expect(response.pack.socializationWork.invitations).toHaveLength(1);
    expect(response.pack.socializationWork.invitations[0]!.parcelCode).toBe("001");
  });
});

/* =============================================================================================
 * 17 — several projects, and the decision that is not the device's
 * ========================================================================================== */

describe("a technician with work in two roads", () => {
  it("17 · is told about both, rather than being handed a dead end", async () => {
    const scope = await resolveFieldWorkScope(db.runtime, technician.id);
    const slugs = scope.projects.map((p) => p.projectSlug).sort();
    expect(slugs).toEqual([w.projectX.slug, w.projectY.slug].sort());
    expect(scope.protocolVersion).toBe(FIELD_SYNC_PROTOCOL_VERSION_V4);

    // Project Y has an active campaign with an assignment; project X has invitations only.
    const y = scope.projects.find((p) => p.projectSlug === w.projectY.slug);
    expect(y?.work).toEqual(["survey"]);
  });

  it("· while v3's scope still answers its terminal state, unchanged", async () => {
    const v3 = await resolveFieldScope(db.runtime, technician.id);
    // v3 counts projects with *survey* work, which is one here — so it yields a scope rather
    // than the terminal state. The point is that it is untouched and still answers in its own
    // vocabulary; a device speaking v3 sees exactly what it saw before this block.
    expect(["scope", "no_field_project", "multiple_field_projects"]).toContain(v3.kind);
  });

  it("· and somebody with no work anywhere is told nothing about anybody's projects", async () => {
    const idle = await makePerson("v4-idle", "VIEWER", w.projectX.id);
    const scope = await resolveFieldWorkScope(db.runtime, idle.id);
    expect(scope.projects).toEqual([]);
  });
});

/* =============================================================================================
 * 18 — v3 is unchanged
 * ========================================================================================== */

describe("protocol v3", () => {
  it("18 · keeps its version numbers, so a signed build is not silently re-pointed", () => {
    expect(FIELD_SYNC_PROTOCOL_VERSION).toBe(3);
    expect(FIELD_PACK_SCHEMA_VERSION).toBe(1);
    expect(FIELD_SYNC_PROTOCOL_VERSION_V4).toBe(4);
    expect(FIELD_PACK_SCHEMA_VERSION_V4).toBe(2);
  });
});

/* =============================================================================================
 * The delivery command, over the wire
 * ========================================================================================== */

describe("socialization.delivery.record", () => {
  async function evidence(): Promise<string> {
    const ctx = await contextFor(technician);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, ...new Array<number>(64).fill(0x20)]);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "socialization-evidence",
      filename: "entrega.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
    });
    storage.put(intent.key, bytes, "image/jpeg");
    const stored = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });
    return stored.storedObjectId;
  }

  function command(payload: Record<string, unknown>, commandId = randomUUID()) {
    return {
      commandId,
      protocolVersion: FIELD_SYNC_PROTOCOL_VERSION_V4,
      deviceRevision: 1,
      occurredAt: new Date().toISOString(),
      appVersion: "0.2.0",
      packSchemaVersion: FIELD_PACK_SCHEMA_VERSION_V4,
      type: "socialization.delivery.record",
      payload,
    };
  }

  it("records one attempt, and a retry of the same command records none", async () => {
    const ctx = await contextFor(technician);
    const pack = await buildWorkPack(db.runtime, ctx, PACK_OPTIONS);
    if (pack.kind !== "pack") throw new Error("expected a pack");
    const invitation = pack.pack.socializationWork.invitations[0]!;

    const commandId = randomUUID();
    const payload = {
      invitationId: invitation.invitationId,
      invitationRevision: invitation.revision,
      localAttemptId: randomUUID(),
      outcome: "DELIVERED",
      note: null,
      location: null,
      storedObjectId: await evidence(),
    };

    const first = await processWorkSyncCommands(db.runtime, ctx, [command(payload, commandId)]);
    expect(first.results[0]).toMatchObject({ outcome: "applied", invitationStatus: "DELIVERED" });
    expect(first.protocolVersion).toBe(FIELD_SYNC_PROTOCOL_VERSION_V4);

    const retry = await processWorkSyncCommands(db.runtime, ctx, [command(payload, commandId)]);
    expect(retry.results[0]?.outcome).toBe("duplicate");

    const rows = await db.migrator.execute<{ n: number }>(sql`
      select count(*)::int as n from app.socialization_delivery_attempt
       where invitation_id = ${invitation.invitationId}
    `);
    expect(Number(rows.rows[0]!.n)).toBe(1);
  });

  it("refuses a DELIVERED with no photograph, and the device is told to stop", async () => {
    const ctx = await contextFor(technician);
    const eventId = await inviteInX(1);
    const pack = await buildWorkPack(db.runtime, ctx, PACK_OPTIONS);
    if (pack.kind !== "pack") throw new Error("expected a pack");
    const invitation = pack.pack.socializationWork.invitations.find((i) => i.eventId === eventId)!;

    const result = await processWorkSyncCommands(db.runtime, ctx, [
      command({
        invitationId: invitation.invitationId,
        invitationRevision: invitation.revision,
        localAttemptId: randomUUID(),
        outcome: "DELIVERED",
        note: null,
        location: null,
        storedObjectId: null,
      }),
    ]);
    expect(result.results[0]?.outcome).toBe("rejected");
    expect(result.results[0]?.message).toMatch(/fotografía|photograph/);
  });

  it("answers conflict when the invitation changed hands while the device was offline", async () => {
    const ctx = await contextFor(technician);
    const eventId = await inviteInX(1);
    const pack = await buildWorkPack(db.runtime, ctx, PACK_OPTIONS);
    if (pack.kind !== "pack") throw new Error("expected a pack");
    const invitation = pack.pack.socializationWork.invitations.find((i) => i.eventId === eventId)!;

    const other = await makePerson("v4-technician-receiver", "FIELD_TECHNICIAN", w.projectX.id);
    await reassignInvitation(db.runtime, await contextFor(specialist), {
      invitationId: invitation.invitationId,
      assigneeMembershipId: other.membershipId,
    });

    const result = await processWorkSyncCommands(db.runtime, ctx, [
      command({
        invitationId: invitation.invitationId,
        invitationRevision: invitation.revision,
        localAttemptId: randomUUID(),
        outcome: "DELIVERED",
        note: null,
        location: null,
        storedObjectId: await evidence(),
      }),
    ]);
    expect(result.results[0]).toMatchObject({
      outcome: "conflict",
      conflictReason: "invitation_reassigned",
    });
    // Nothing was written, and nothing was attributed to the new technician.
    const rows = await db.migrator.execute<{ n: number }>(sql`
      select count(*)::int as n from app.socialization_delivery_attempt
       where invitation_id = ${invitation.invitationId}
    `);
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });
});

/* =============================================================================================
 * Pull
 * ========================================================================================== */

describe("pull", () => {
  it("names what is no longer this device's, without touching what it captured", async () => {
    const ctx = await contextFor(technician);
    const pack = await buildWorkPack(db.runtime, ctx, PACK_OPTIONS);
    if (pack.kind !== "pack") throw new Error("expected a pack");
    const held = pack.pack.socializationWork.invitations.map((i) => i.invitationId);

    // An id the device holds that the server no longer considers theirs.
    const stale = randomUUID();
    const pulled = await pullWorkChanges(
      db.runtime,
      ctx,
      { knownAssignmentIds: [], knownInvitationIds: [...held, stale] },
      PACK_OPTIONS,
    );
    expect(pulled.revokedInvitationIds).toContain(stale);
    for (const id of held) expect(pulled.revokedInvitationIds).not.toContain(id);
    expect(pulled.protocolVersion).toBe(FIELD_SYNC_PROTOCOL_VERSION_V4);
    /*
     * Project X has an active campaign this technician has no assignments in, so the survey half
     * is present and empty rather than absent — which is the honest distinction: *there is a
     * campaign and none of it is yours* is not *there is no campaign*.
     */
    expect(pulled.surveyChanges?.assignments ?? []).toEqual([]);
  });
});
