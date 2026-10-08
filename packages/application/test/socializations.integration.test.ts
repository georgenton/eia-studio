import { randomUUID } from "node:crypto";

import { InvalidInput, NotFound, PermissionDenied, type SessionUser } from "@eia/domain";
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
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type SeededQuestionnaire,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assignParcel,
  buildRequestContext,
  createMemoryStorage,
  createSocializationEvent,
  createUploadIntent,
  finalizeUpload,
  generateInvitations,
  listEligibleTechnicians,
  listInvitationCandidates,
  loadAssignmentBoard,
  reassignAssignment,
  reassignInvitation,
  recordDeliveryAttempt,
  transitionSocializationEvent,
  updateSocializationEvent,
} from "../src/index";

/**
 * Convening the people a road runs past (ADR-041), against a real database.
 *
 * The file is arranged around the two sentences the design has to deliver. **An invitation is
 * the unit of count, and an attempt is the history of trying** — so `ABSENT` leaves the
 * invitation open and three visits to one gate are one invitee. And **a delivery is attributed
 * to whoever made it** — so an invitation that changed hands while a phone was offline produces
 * a conflict a person looks at, never a silent re-attribution.
 *
 * Everything is synthetic: a tenant the suite made, people called "soc-…", parcels from the
 * fixture factory. No real consultancy, no real person, no real convocation.
 */
const db = getTestDatabase();
const storage = createMemoryStorage();
let w: TwoTenantWorld;

type Person = { id: string; email: string; membershipId: string };
let coordinator: Person;
let specialist: Person;
let gis: Person;
let technician: Person;
let otherTechnician: Person;
let foreignTechnician: Person;
let survey: SeededQuestionnaire;
let campaignId: string;
let prov: string;
const parcels: Array<{ parcelId: string; geometryId: string }> = [];

const CAPABILITIES = ["core.projects", "gis.maps", "gis.parcels", "field.surveys"] as const;

async function contextFor(
  user: { id: string; email: string },
  scope = { tenantSlug: w.tenantA.slug, projectSlug: w.projectX.slug },
) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, { sessionUser, ...scope });
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

/** A JPEG the technician uploads into the evidence namespace, through the product's own path. */
async function uploadEvidence(who: Person): Promise<string> {
  const ctx = await contextFor(who);
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

async function newEvent(title: string): Promise<string> {
  const { eventId } = await createSocializationEvent(db.runtime, await contextFor(specialist), {
    title,
    purpose: "Presentar los resultados del estudio a los predios frentistas.",
    startsAt: new Date("2026-11-12T14:00:00.000Z"),
    timezone: "America/Guayaquil",
    locationLabel: "Casa comunal del sector",
  });
  return eventId;
}

async function invite(
  eventId: string,
  parcelIndex: number,
  assignee: Person = technician,
): Promise<string> {
  await generateInvitations(db.runtime, await contextFor(specialist), {
    eventId,
    parcels: [
      {
        parcelId: parcels[parcelIndex]!.parcelId,
        assigneeMembershipId: assignee.membershipId,
        recipientLabel: null,
      },
    ],
  });
  const rows = await db.migrator.execute<{ id: string }>(sql`
    select id from app.socialization_invitation
     where event_id = ${eventId} and parcel_id = ${parcels[parcelIndex]!.parcelId}
  `);
  return rows.rows[0]!.id;
}

async function invitationRow(id: string) {
  const rows = await db.migrator.execute<{
    status: string;
    revision: number;
    assignee_user_id: string;
  }>(sql`
    select status::text as status, revision, assignee_user_id
      from app.socialization_invitation where id = ${id}
  `);
  return rows.rows[0]!;
}

async function attemptCount(invitationId: string): Promise<number> {
  const rows = await db.migrator.execute<{ n: number }>(sql`
    select count(*)::int as n from app.socialization_delivery_attempt
     where invitation_id = ${invitationId}
  `);
  return Number(rows.rows[0]!.n);
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const tenantId of [w.tenantA.id, w.tenantB.id]) {
    for (const key of CAPABILITIES) {
      await setTenantCapability(db.migrator, { tenantId, key, entitled: true, enabled: true });
    }
  }

  const make = async (label: string, role: string, projectId = w.projectX.id): Promise<Person> => {
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
  };
  coordinator = await make("soc-coordinator", "COORDINATOR");
  specialist = await make("soc-specialist", "SOCIAL_SPECIALIST");
  gis = await make("soc-gis", "GIS_SPECIALIST");
  technician = await make("soc-technician", "FIELD_TECHNICIAN");
  otherTechnician = await make("soc-technician-2", "FIELD_TECHNICIAN");
  // A technician of the tenant's *other* project. Eligible nowhere here.
  foreignTechnician = await make("soc-technician-foreign", "FIELD_TECHNICIAN", w.projectY.id);

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  survey = await createPublishedSurvey(db.migrator, {
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
  for (const code of ["001", "002", "003", "004"]) {
    parcels.push(
      await createParcelWithGeometry(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        datasetVersionId: dataset.id,
        provenanceId: prov,
        parcelCode: code,
      }),
    );
  }
  campaignId = (
    await createCampaign(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      surveyVersionId: survey.versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    })
  ).id;
}, 300_000);

afterAll(() => db.close());

/* =============================================================================================
 * Assignment — closing the gap the permission had
 * ========================================================================================== */

describe("deciding who surveys a parcel", () => {
  it("a social specialist assigns, and the board shows who is going", async () => {
    const ctx = await contextFor(specialist);
    const eligible = await listEligibleTechnicians(db.runtime, ctx, campaignId);
    // The project's own technicians, and nobody else's: the one on project Y is absent.
    expect(eligible.map((t) => t.membershipId).sort()).toEqual(
      [technician.membershipId, otherTechnician.membershipId].sort(),
    );

    await assignParcel(db.runtime, ctx, {
      campaignId,
      parcelId: parcels[0]!.parcelId,
      assigneeMembershipId: technician.membershipId,
      note: null,
    });

    const board = await loadAssignmentBoard(db.runtime, ctx, campaignId);
    const row = board.rows.find((r) => r.parcelId === parcels[0]!.parcelId);
    expect(row?.assigneeMembershipId).toBe(technician.membershipId);
    expect(row?.status).toBe("PENDING");
    expect(row?.workStarted).toBe(false);
    // Every parcel is listed, assigned or not: an unassigned one is the interesting case.
    expect(board.rows).toHaveLength(parcels.length);
  });

  it("and can change their mind before anybody has gone", async () => {
    const ctx = await contextFor(specialist);
    const board = await loadAssignmentBoard(db.runtime, ctx, campaignId);
    const assignmentId = board.rows.find((r) => r.parcelId === parcels[0]!.parcelId)!.assignmentId!;

    const moved = await reassignAssignment(db.runtime, ctx, {
      assignmentId,
      assigneeMembershipId: otherTechnician.membershipId,
    });
    expect(moved.previousMembershipId).toBe(technician.membershipId);

    // Back again, so the rest of the file has a known owner.
    await reassignAssignment(db.runtime, ctx, {
      assignmentId,
      assigneeMembershipId: technician.membershipId,
    });
  });

  it("a coordinator may too, and a GIS specialist and a technician may not", async () => {
    await assignParcel(db.runtime, await contextFor(coordinator), {
      campaignId,
      parcelId: parcels[1]!.parcelId,
      assigneeMembershipId: technician.membershipId,
      note: null,
    });

    expect(
      await refusal(async () =>
        assignParcel(db.runtime, await contextFor(gis), {
          campaignId,
          parcelId: parcels[2]!.parcelId,
          assigneeMembershipId: technician.membershipId,
          note: null,
        }),
      ),
    ).toBeInstanceOf(PermissionDenied);
    expect(
      await refusal(async () =>
        assignParcel(db.runtime, await contextFor(technician), {
          campaignId,
          parcelId: parcels[2]!.parcelId,
          assigneeMembershipId: technician.membershipId,
          note: null,
        }),
      ),
    ).toBeInstanceOf(PermissionDenied);
  });

  it("a technician of another project is not somebody this project can send", async () => {
    expect(
      await refusal(async () =>
        assignParcel(db.runtime, await contextFor(specialist), {
          campaignId,
          parcelId: parcels[2]!.parcelId,
          assigneeMembershipId: foreignTechnician.membershipId,
          note: null,
        }),
      ),
    ).toBeInstanceOf(NotFound);
  });

  it("and once work exists the assignment stops moving, with the revisit named instead", async () => {
    const ctx = await contextFor(specialist);
    // A visit is the cheapest proof that somebody went.
    const assignment = await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId: parcels[3]!.parcelId,
      assigneeMembershipId: technician.membershipId,
      assigneeUserId: technician.id,
    });
    await db.migrator.execute(sql`
      insert into app.field_visit (id, tenant_id, project_id, assignment_id, technician_user_id,
                                   status, started_at, location_outcome, provenance_id)
      values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${assignment.id},
              ${technician.id}, 'IN_PROGRESS', now(), 'not_attempted', ${prov})
    `);

    const error = await refusal(() =>
      reassignAssignment(db.runtime, ctx, {
        assignmentId: assignment.id,
        assigneeMembershipId: otherTechnician.membershipId,
      }),
    );
    expect(String(error)).toMatch(/already been captured/);
    expect(String(error)).toMatch(/did not do it/);

    const board = await loadAssignmentBoard(db.runtime, ctx, campaignId);
    expect(board.rows.find((r) => r.parcelId === parcels[3]!.parcelId)?.workStarted).toBe(true);
  });
});

/* =============================================================================================
 * The event
 * ========================================================================================== */

describe("the event", () => {
  it("1 · two convocations of the same road are independent", async () => {
    const first = await newEvent("Primera socialización");
    const second = await newEvent("Segunda socialización");
    expect(first).not.toBe(second);

    await invite(first, 0);
    // The second has no invitations because the first does: they share nothing.
    const rows = await db.migrator.execute<{ n: number }>(sql`
      select count(*)::int as n from app.socialization_invitation where event_id = ${second}
    `);
    expect(Number(rows.rows[0]!.n)).toBe(0);

    // And the second's logistics are still editable, which is the property that matters.
    await updateSocializationEvent(db.runtime, await contextFor(specialist), {
      eventId: second,
      title: "Segunda socialización, reprogramada",
      purpose: null,
      startsAt: new Date("2026-11-20T14:00:00.000Z"),
      timezone: "America/Guayaquil",
      locationLabel: "Escuela del sector",
    });
  });

  it("3 · but an event somebody has been told about does not rewrite its own convocation", async () => {
    const eventId = await newEvent("Convocatoria congelada");
    await invite(eventId, 1);
    const ctx = await contextFor(specialist);

    const error = await refusal(() =>
      updateSocializationEvent(db.runtime, ctx, {
        eventId,
        title: "Convocatoria congelada",
        purpose: null,
        // The one thing a delivered invitation makes unchangeable.
        startsAt: new Date("2026-12-01T14:00:00.000Z"),
        timezone: "America/Guayaquil",
        locationLabel: "Casa comunal del sector",
      }),
    );
    expect(String(error)).toMatch(/invitations already/);

    // And the database refuses it too, under the owning role, not only the use-case.
    const blocked = await attempt(
      db.migrator.execute(
        sql`update app.socialization_event set starts_at = now() where id = ${eventId}`,
      ),
    );
    expect(blocked).toContain("cannot change");
  });

  it("4 · cancelling keeps what happened and stops what had not", async () => {
    const eventId = await newEvent("Convocatoria cancelada");
    const delivered = await invite(eventId, 0);
    const pending = await invite(eventId, 1);

    // One is delivered before the cancellation, so there is history to keep.
    const evidence = await uploadEvidence(technician);
    const recorded = await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId: delivered,
      invitationRevision: (await invitationRow(delivered)).revision,
      localAttemptId: randomUUID(),
      outcome: "DELIVERED",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: evidence,
    });
    expect(recorded.kind).toBe("recorded");

    const result = await transitionSocializationEvent(db.runtime, await contextFor(specialist), {
      eventId,
      to: "CANCELLED",
      reason: "la comunidad pidió otra fecha",
    });
    expect(result.cancelledInvitations).toBe(1);

    expect((await invitationRow(delivered)).status).toBe("DELIVERED");
    expect((await invitationRow(pending)).status).toBe("CANCELLED");
    // The delivery itself is untouched: somebody was told, and that happened.
    expect(await attemptCount(delivered)).toBe(1);
  });

  it("· and says why, because a cancellation is a thing somebody decided", async () => {
    const eventId = await newEvent("Sin motivo");
    expect(
      await refusal(async () =>
        transitionSocializationEvent(db.runtime, await contextFor(specialist), {
          eventId,
          to: "CANCELLED",
          reason: null,
        }),
      ),
    ).toBeInstanceOf(InvalidInput);
  });
});

/* =============================================================================================
 * The invitation
 * ========================================================================================== */

describe("the invitation", () => {
  it("2 · the same parcel is invited to the same event once, however many times you ask", async () => {
    const eventId = await newEvent("Idempotencia");
    const ctx = await contextFor(specialist);
    const payload = {
      eventId,
      parcels: [
        {
          parcelId: parcels[0]!.parcelId,
          assigneeMembershipId: technician.membershipId,
          recipientLabel: null,
        },
        {
          parcelId: parcels[1]!.parcelId,
          assigneeMembershipId: technician.membershipId,
          recipientLabel: null,
        },
      ],
    };
    const first = await generateInvitations(db.runtime, ctx, payload);
    expect(first).toEqual({ created: 2, skipped: 0 });

    const again = await generateInvitations(db.runtime, ctx, payload);
    expect(again).toEqual({ created: 0, skipped: 2 });

    const rows = await db.migrator.execute<{ n: number }>(sql`
      select count(*)::int as n from app.socialization_invitation where event_id = ${eventId}
    `);
    expect(Number(rows.rows[0]!.n)).toBe(2);
  });

  it("· offers the technician who surveyed a parcel, and saves nothing until somebody confirms", async () => {
    const eventId = await newEvent("Sugerencias");
    const candidates = await listInvitationCandidates(
      db.runtime,
      await contextFor(specialist),
      eventId,
    );
    expect(candidates).toHaveLength(parcels.length);
    // Nothing has been written by looking.
    const rows = await db.migrator.execute<{ n: number }>(sql`
      select count(*)::int as n from app.socialization_invitation where event_id = ${eventId}
    `);
    expect(Number(rows.rows[0]!.n)).toBe(0);
    // Every candidate names its parcel and says whether it is already invited.
    expect(candidates.every((c) => c.parcelCode.length > 0)).toBe(true);
    expect(candidates.every((c) => c.alreadyInvited === false)).toBe(true);
  });

  it("· changes hands only while nobody has acted on it", async () => {
    const eventId = await newEvent("Reasignación");
    const invitationId = await invite(eventId, 0);
    const before = await invitationRow(invitationId);

    await reassignInvitation(db.runtime, await contextFor(specialist), {
      invitationId,
      assigneeMembershipId: otherTechnician.membershipId,
    });
    const after = await invitationRow(invitationId);
    expect(after.assignee_user_id).toBe(otherTechnician.id);
    // The revision rises, which is how a device holding the old one finds out.
    expect(after.revision).toBe(before.revision + 1);
  });
});

/* =============================================================================================
 * The delivery
 * ========================================================================================== */

describe("recording a delivery", () => {
  it("5 · a delivered invitation needs a photograph", async () => {
    const eventId = await newEvent("Evidencia obligatoria");
    const invitationId = await invite(eventId, 0);
    const error = await refusal(async () =>
      recordDeliveryAttempt(db.runtime, await contextFor(technician), {
        invitationId,
        invitationRevision: (await invitationRow(invitationId)).revision,
        localAttemptId: randomUUID(),
        outcome: "DELIVERED",
        occurredAt: new Date(),
        note: null,
        location: null,
        evidenceStoredObjectId: null,
      }),
    );
    expect(String(error)).toMatch(/needs a photograph/);
    expect(await attemptCount(invitationId)).toBe(0);
    expect((await invitationRow(invitationId)).status).toBe("PENDING");
  });

  it("6 · the same attempt sent twice is one row", async () => {
    const eventId = await newEvent("Reintento");
    const invitationId = await invite(eventId, 0);
    const localAttemptId = randomUUID();
    const evidence = await uploadEvidence(technician);
    const revision = (await invitationRow(invitationId)).revision;

    const first = await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: revision,
      localAttemptId,
      outcome: "DELIVERED",
      occurredAt: new Date(),
      note: null,
      location: { latitude: -3.8, longitude: -78.7, accuracyM: 12 },
      evidenceStoredObjectId: evidence,
    });
    expect(first).toMatchObject({ kind: "recorded", duplicate: false });

    // The retry arrives with the revision the device still holds, which is now stale — and it is
    // answered with the row it already wrote rather than becoming a conflict.
    const retry = await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: revision,
      localAttemptId,
      outcome: "DELIVERED",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: evidence,
    });
    expect(retry).toMatchObject({ kind: "recorded", duplicate: true });
    expect(await attemptCount(invitationId)).toBe(1);
  });

  it("7 · nobody home leaves the invitation open for another visit", async () => {
    const eventId = await newEvent("Ausente");
    const invitationId = await invite(eventId, 0);

    await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: (await invitationRow(invitationId)).revision,
      localAttemptId: randomUUID(),
      outcome: "ABSENT",
      occurredAt: new Date(),
      note: "la casa estaba cerrada",
      location: null,
      evidenceStoredObjectId: null,
    });
    expect((await invitationRow(invitationId)).status).toBe("PENDING");

    const evidence = await uploadEvidence(technician);
    await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: (await invitationRow(invitationId)).revision,
      localAttemptId: randomUUID(),
      outcome: "DELIVERED",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: evidence,
    });
    expect((await invitationRow(invitationId)).status).toBe("DELIVERED");
    // Two attempts, one invitee. This is the distinction the whole model rests on.
    expect(await attemptCount(invitationId)).toBe(2);
  });

  it("8 · a settled invitation takes no further ordinary attempt", async () => {
    const eventId = await newEvent("Terminal");
    const invitationId = await invite(eventId, 0);
    await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: (await invitationRow(invitationId)).revision,
      localAttemptId: randomUUID(),
      outcome: "REFUSED",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: null,
    });
    expect((await invitationRow(invitationId)).status).toBe("REFUSED");

    const second = await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: (await invitationRow(invitationId)).revision,
      localAttemptId: randomUUID(),
      outcome: "DELIVERED",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: await uploadEvidence(technician),
    });
    expect(second).toMatchObject({ kind: "conflict", reason: "already_settled" });
  });

  it("· an attempt is written once, by the owning role as well", async () => {
    const eventId = await newEvent("Inmutable");
    const invitationId = await invite(eventId, 0);
    await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: (await invitationRow(invitationId)).revision,
      localAttemptId: randomUUID(),
      outcome: "ABSENT",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: null,
    });
    const updated = await attempt(
      db.migrator.execute(
        sql`update app.socialization_delivery_attempt set outcome = 'DELIVERED'
             where invitation_id = ${invitationId}`,
      ),
    );
    expect(updated).toContain("written once");
    const deleted = await attempt(
      db.migrator.execute(
        sql`delete from app.socialization_delivery_attempt where invitation_id = ${invitationId}`,
      ),
    );
    expect(deleted).toContain("written once");
  });
});

/* =============================================================================================
 * Conflicts — what the phone is told when the world moved
 * ========================================================================================== */

describe("a delivery captured before the world changed", () => {
  it("is refused with a conflict when the invitation changed hands", async () => {
    const eventId = await newEvent("Reasignada en vuelo");
    const invitationId = await invite(eventId, 0);
    const revisionTheDeviceRead = (await invitationRow(invitationId)).revision;

    await reassignInvitation(db.runtime, await contextFor(specialist), {
      invitationId,
      assigneeMembershipId: otherTechnician.membershipId,
    });

    const result = await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: revisionTheDeviceRead,
      localAttemptId: randomUUID(),
      outcome: "DELIVERED",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: await uploadEvidence(technician),
    });
    // Not attributed to the new technician, and not applied. The device keeps its work.
    expect(result).toMatchObject({ kind: "conflict", reason: "invitation_reassigned" });
    expect(await attemptCount(invitationId)).toBe(0);
  });

  it("and when the event was called off", async () => {
    const eventId = await newEvent("Cancelada en vuelo");
    const invitationId = await invite(eventId, 0);
    const revision = (await invitationRow(invitationId)).revision;
    await transitionSocializationEvent(db.runtime, await contextFor(specialist), {
      eventId,
      to: "CANCELLED",
      reason: "se suspendió por lluvia",
    });

    const result = await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: revision,
      localAttemptId: randomUUID(),
      outcome: "DELIVERED",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: await uploadEvidence(technician),
    });
    expect(result.kind).toBe("conflict");
  });

  it("and when the revision moved for any other reason", async () => {
    const eventId = await newEvent("Revisión movida");
    const invitationId = await invite(eventId, 0);
    const stale = (await invitationRow(invitationId)).revision;
    await db.migrator.execute(
      sql`update app.socialization_invitation set revision = revision + 1 where id = ${invitationId}`,
    );

    const result = await recordDeliveryAttempt(db.runtime, await contextFor(technician), {
      invitationId,
      invitationRevision: stale,
      localAttemptId: randomUUID(),
      outcome: "ABSENT",
      occurredAt: new Date(),
      note: null,
      location: null,
      evidenceStoredObjectId: null,
    });
    expect(result).toMatchObject({ kind: "conflict", reason: "invitation_revision_changed" });
  });
});

/* =============================================================================================
 * Boundaries
 * ========================================================================================== */

describe("who may do what", () => {
  it("9 · a GIS specialist and a technician manage no socialization", async () => {
    for (const person of [gis, technician]) {
      expect(
        await refusal(async () =>
          createSocializationEvent(db.runtime, await contextFor(person), {
            title: "No debería existir",
            purpose: null,
            startsAt: new Date("2026-11-12T14:00:00.000Z"),
            timezone: "America/Guayaquil",
            locationLabel: "Ninguno",
          }),
        ),
      ).toBeInstanceOf(PermissionDenied);
    }
  });

  it("· a technician sees their own invitations and nobody else's", async () => {
    const eventId = await newEvent("Visibilidad");
    const mine = await invite(eventId, 0, technician);
    const theirs = await invite(eventId, 1, otherTechnician);

    const ctx = await contextFor(technician);
    const visible = await db.runtime.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`);
      await tx.execute(sql`select set_config('app.project_id', ${ctx.projectId!}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      await tx.execute(sql`select set_config('app.surface', 'internal', true)`);
      const rows = await tx.execute<{ id: string }>(
        sql`select id from app.socialization_invitation where event_id = ${eventId}`,
      );
      return rows.rows.map((r) => r.id);
    });
    expect(visible).toContain(mine);
    expect(visible).not.toContain(theirs);
  });

  it("· and a technician cannot file evidence that is not their own upload", async () => {
    const eventId = await newEvent("Evidencia ajena");
    const invitationId = await invite(eventId, 0, technician);
    const somebodyElses = await uploadEvidence(otherTechnician);

    const error = await refusal(async () =>
      recordDeliveryAttempt(db.runtime, await contextFor(technician), {
        invitationId,
        invitationRevision: (await invitationRow(invitationId)).revision,
        localAttemptId: randomUUID(),
        outcome: "DELIVERED",
        occurredAt: new Date(),
        note: null,
        location: null,
        evidenceStoredObjectId: somebodyElses,
      }),
    );
    expect(String(error)).toMatch(/filed by whoever uploaded it|stored object/);
  });

  it("10 · and another tenant's project is not reachable at all", async () => {
    // Tenant B's owner, on tenant B's project, sees none of tenant A's events.
    const ctx = await contextFor(
      { id: w.ownerB.id, email: w.ownerB.email },
      { tenantSlug: w.tenantB.slug, projectSlug: w.projectZ.slug },
    );
    const rows = await db.runtime.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`);
      await tx.execute(sql`select set_config('app.project_id', ${ctx.projectId!}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      await tx.execute(sql`select set_config('app.surface', 'internal', true)`);
      await tx.execute(sql`select set_config('app.field_responses_access', 'on', true)`);
      const result = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from app.socialization_event`,
      );
      return Number(result.rows[0]!.n);
    });
    expect(rows).toBe(0);
  });
});
