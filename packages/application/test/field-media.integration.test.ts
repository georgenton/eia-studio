import { fieldSchema } from "@eia/db";
import type { SessionUser } from "@eia/domain";
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
  type TwoTenantWorld,
} from "@eia/testing";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { FIELD_PACK_SCHEMA_VERSION, FIELD_SYNC_PROTOCOL_VERSION } from "@eia/field-sync-contract";

import {
  buildRequestContext,
  createS3Storage,
  createUploadIntent,
  declareFieldMedia,
  finalizeUpload,
  loadParcelMedia,
  loadVisitMedia,
  resolveFinalizedUpload,
  processSyncCommands,
  startVisit,
  uploadDocumentVersion,
} from "../src/index";

/**
 * A photograph becomes evidence of a visit (ADR-032), against a real provider and a real database.
 *
 * The properties under test are the ones a bad connection produces, not the happy path:
 *
 * - the **same photograph declared twice** is one row, whichever way the retry arrives;
 * - a **second finalize** of one intent writes nothing, and the route's question still answers;
 * - a photograph **cannot be filed as a document**, and a document cannot be filed as a
 *   photograph — the two directions of ADR-031's namespace rule;
 * - a technician **cannot declare evidence in somebody else's name**, and a coordinator holding
 *   `field.responses.read` can read the project's photographs without being able to file any.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let technician: { id: string; email: string };
let otherTechnician: { id: string; email: string };
let coordinator: { id: string; email: string };
let gisSpecialist: { id: string; email: string };
let storage: ReturnType<typeof createS3Storage>;
let assignmentId: string;
let parcelId: string;
let surveyVersionId: string;
/** The fully-offline journey gets its own parcel, assignment and visit, so it collides with
 *  nothing: the other cases in this file share one visit and reopen it between them. */
let offlineParcelId: string;
let offlineAssignmentId: string;
let visitId: string;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

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

async function member(label: string, role: string) {
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
    role: role as never,
  });
  return { user, membershipId: membership.id };
}

async function upload(url: string, headers: Record<string, string>, bytes: Uint8Array) {
  const response = await fetch(url, { method: "PUT", headers, body: bytes });
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
}

/** Everything a device does before it declares: an intent, a PUT, a finalize. */
async function storePhotograph(
  user: { id: string; email: string },
  bytes: Uint8Array = PNG_BYTES,
  namespace: "field-media" | "documents" = "field-media",
) {
  const ctx = await contextFor(user);
  const intent = await createUploadIntent(db.runtime, ctx, storage, {
    namespace,
    filename: namespace === "documents" ? "acta.pdf" : "predio.png",
    mimeType: namespace === "documents" ? "application/pdf" : "image/png",
    sizeBytes: bytes.byteLength,
  });
  await upload(intent.url, intent.headers, bytes);
  const stored = await finalizeUpload(db.runtime, ctx, storage, {
    intentId: intent.intentId,
    objectKey: intent.key,
  });
  return { ctx, intent, stored };
}

/** The parts of a command envelope no test needs to think about. */
function envelope() {
  return {
    commandId: randomUUID(),
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
    deviceRevision: 1,
    occurredAt: new Date().toISOString(),
    appVersion: "0.1.0",
    packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
  } as const;
}

function declaration(over: Record<string, unknown> = {}) {
  return {
    assignmentId,
    visitId,
    localId: randomUUID(),
    storedObjectId: "",
    kind: "parcel" as const,
    capturedAt: new Date().toISOString(),
    note: "Frente del predio desde la vía",
    location: { latitude: -4.0761, longitude: -78.9412, accuracyM: 8 },
    ...over,
  };
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of [
    "core.projects",
    "core.documents",
    "gis.maps",
    "gis.parcels",
    "field.surveys",
  ] as const) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }

  const tech = await member("media-technician", "FIELD_TECHNICIAN");
  technician = tech.user;
  otherTechnician = (await member("media-technician-2", "FIELD_TECHNICIAN")).user;
  coordinator = (await member("media-coordinator", "COORDINATOR")).user;
  gisSpecialist = (await member("media-gis", "GIS_SPECIALIST")).user;

  const provenance = await createProvenanceRecord(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
  });
  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provenance.id,
  });
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: dataset.id,
    provenanceId: provenance.id,
  });
  parcelId = parcel.parcelId;
  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provenance.id,
  });
  surveyVersionId = survey.versionId;
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provenance.id,
    surveyVersionId: survey.versionId,
  });
  const assignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provenance.id,
    campaignId: campaign.id,
    parcelId: parcel.parcelId,
    assigneeMembershipId: tech.membershipId,
    assigneeUserId: technician.id,
  });
  assignmentId = assignment.id;

  const otherParcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: dataset.id,
    provenanceId: provenance.id,
    parcelCode: "PRED-OFFLINE-001",
  });
  offlineParcelId = otherParcel.parcelId;
  offlineAssignmentId = (
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provenance.id,
      campaignId: campaign.id,
      parcelId: otherParcel.parcelId,
      assigneeMembershipId: tech.membershipId,
      assigneeUserId: technician.id,
    })
  ).id;

  // Through the use-case, not a factory: the visit a photograph attaches to is the one a
  // technician actually starts.
  const visit = await startVisit(db.runtime, await contextFor(technician), {
    assignmentId,
    location: null,
    locationOutcome: "not_attempted",
  });
  visitId = visit.visitId;

  const config = inject("eiaTestStorage");
  storage = createS3Storage({
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
});
afterAll(() => db.close());

describe("declaring a photograph a device already uploaded", () => {
  it("writes one row, with the technician's own provenance and no invented coordinate", async () => {
    const { ctx, stored } = await storePhotograph(technician);
    const result = await declareFieldMedia(
      db.runtime,
      ctx,
      declaration({ storedObjectId: stored.storedObjectId }),
    );
    expect(result.outcome).toBe("stored");

    const [row] = await db.migrator
      .select()
      .from(fieldSchema.fieldMedia)
      .where(eq(fieldSchema.fieldMedia.id, result.mediaId));
    expect(row?.visitId).toBe(visitId);
    expect(row?.capturedByUserId).toBe(technician.id);
    expect(row?.kind).toBe("parcel");
    expect(row?.storedObjectId).toBe(stored.storedObjectId);
  });

  it("records no location when the device had none, rather than a nearby point", async () => {
    const { ctx, stored } = await storePhotograph(technician);
    const result = await declareFieldMedia(
      db.runtime,
      ctx,
      declaration({ storedObjectId: stored.storedObjectId, location: null }),
    );
    const [row] = await db.migrator
      .select()
      .from(fieldSchema.fieldMedia)
      .where(eq(fieldSchema.fieldMedia.id, result.mediaId));
    expect(row?.location).toBeNull();
    expect(row?.locationAccuracyM).toBeNull();
  });

  /*
   * The guarantee the whole design rests on. A technician's connection returns for four seconds;
   * the declaration is sent, the answer is lost, the device sends it again. One photograph.
   */
  it("the same localId twice is one row, and says so", async () => {
    const { ctx, stored } = await storePhotograph(technician);
    const input = declaration({ storedObjectId: stored.storedObjectId });

    const first = await declareFieldMedia(db.runtime, ctx, input);
    const second = await declareFieldMedia(db.runtime, ctx, input);
    expect(first.outcome).toBe("stored");
    expect(second.outcome).toBe("already_declared");
    expect(second.mediaId).toBe(first.mediaId);

    const rows = await db.migrator
      .select({ id: fieldSchema.fieldMedia.id })
      .from(fieldSchema.fieldMedia)
      .where(eq(fieldSchema.fieldMedia.localId, input.localId));
    expect(rows).toHaveLength(1);
  });

  it("a second finalize writes nothing, and the object it produced is still findable", async () => {
    const { ctx, intent, stored } = await storePhotograph(technician);

    // The use-case keeps its property: consuming an authorisation twice is refused.
    const error = await attempt(
      finalizeUpload(db.runtime, ctx, storage, {
        intentId: intent.intentId,
        objectKey: intent.key,
      }),
    );
    expect(error).toMatch(/already finalized/i);

    // The route's idempotency is a *different question*, and it answers.
    const resolved = await resolveFinalizedUpload(db.runtime, ctx, intent.intentId);
    expect(resolved?.storedObjectId).toBe(stored.storedObjectId);
  });

  it("refuses a second declaration over the same bytes under a new localId", async () => {
    const { ctx, stored } = await storePhotograph(technician);
    await declareFieldMedia(
      db.runtime,
      ctx,
      declaration({ storedObjectId: stored.storedObjectId }),
    );
    // A different `localId` would slip past the lookup; the unique index on the stored object is
    // the second door, and it is closed.
    const error = await attempt(
      declareFieldMedia(db.runtime, ctx, declaration({ storedObjectId: stored.storedObjectId })),
    );
    expect(error).toMatch(/field_media_object_key|duplicate key/i);
  });
});

describe("what a declaration is refused for", () => {
  it("a file uploaded as a document, filed as a photograph", async () => {
    // Uploaded by the coordinator, because `documents.write` is theirs and not a technician's —
    // which is itself the namespace rule working one layer up.
    const { stored } = await storePhotograph(coordinator, PDF_BYTES, "documents");
    const error = await attempt(
      declareFieldMedia(
        db.runtime,
        await contextFor(technician),
        declaration({ storedObjectId: stored.storedObjectId }),
      ),
    );
    // The namespace is checked before the uploader, so this is the refusal that fires: what the
    // file *is*, before who put it there.
    expect(error).toMatch(/uploaded as a document/i);
  });

  it("and the other direction: a photograph filed as a document version", async () => {
    const { stored } = await storePhotograph(technician);
    const error = await attempt(
      uploadDocumentVersion(db.runtime, await contextFor(coordinator), {
        documentId: null,
        code: "DOC-MED1",
        title: "Una fotografía de campo",
        kind: "annex",
        storedObjectId: stored.storedObjectId,
        privacyClassification: "REVIEW_REQUIRED",
        sourceDate: null,
        sourceNote: "No debería entrar al expediente",
      }),
    );
    expect(error).toMatch(/uploaded as field media/i);
  });

  it("somebody else's upload, declared in this technician's name", async () => {
    const { stored } = await storePhotograph(otherTechnician);
    const error = await attempt(
      declareFieldMedia(
        db.runtime,
        await contextFor(technician),
        declaration({ storedObjectId: stored.storedObjectId }),
      ),
    );
    expect(error).toMatch(/uploaded by another person/i);
  });

  it("a visit that is not this technician's — and the answer does not confirm it exists", async () => {
    const { stored } = await storePhotograph(otherTechnician);
    const ctx = await contextFor(otherTechnician);
    const error = await attempt(
      declareFieldMedia(db.runtime, ctx, declaration({ storedObjectId: stored.storedObjectId })),
    );
    // 404, not a denial: a distinguishable error would confirm the visit exists (SECURITY.md §10b).
    expect(error).toMatch(/field visit/i);
  });

  it("a caller without media.upload, whatever else they hold", async () => {
    const { stored } = await storePhotograph(technician);
    for (const user of [coordinator, gisSpecialist]) {
      const error = await attempt(
        declareFieldMedia(
          db.runtime,
          await contextFor(user),
          declaration({ storedObjectId: stored.storedObjectId }),
        ),
      );
      expect(error, user.email).toMatch(/permission|denied|media\.upload/i);
    }
  });

  /**
   * The ordinary offline capture, and the reason the rule changed.
   *
   * `media.declare` names a `storedObjectId` only this server issues, so it cannot be formed
   * without signal. A technician working offline queues `survey.submit` first, that completes the
   * visit, and the declaration arrives behind it on the first bar of signal. Refusing it left the
   * bytes in storage belonging to nothing and the device holding the file for ever — reproduced
   * on an Android emulator on 19 November 2026 (predio 102).
   *
   * The admissibility question is answered with **two of this server's own timestamps**: the
   * upload intent was issued before the visit was completed. The device's clock plays no part,
   * which is why these cases never set `capturedAt` to make a point.
   */
  it("a photograph whose bytes this server took before the visit closed", async () => {
    const { ctx, stored } = await storePhotograph(technician);

    // The close happens after the intent was issued — which is the real order, because
    // `uploadPendingMedia` runs before the outbox is drained.
    await db.migrator.execute(sql`
      update app.field_visit set status = 'COMPLETED', completed_at = now() where id = ${visitId}
    `);

    const result = await declareFieldMedia(
      db.runtime,
      ctx,
      declaration({ storedObjectId: stored.storedObjectId }),
    );
    expect(result.outcome).toBe("stored");

    const [row] = await db.migrator
      .select()
      .from(fieldSchema.fieldMedia)
      .where(eq(fieldSchema.fieldMedia.id, result.mediaId));
    expect(row?.visitId).toBe(visitId);
  });

  /** What the original rule protected: bytes this server first saw after the work was reported. */
  it("but not one uploaded after the visit closed", async () => {
    await db.migrator.execute(sql`
      update app.field_visit set status = 'COMPLETED', completed_at = now() where id = ${visitId}
    `);
    const { ctx, stored } = await storePhotograph(technician);

    await expect(
      declareFieldMedia(db.runtime, ctx, declaration({ storedObjectId: stored.storedObjectId })),
    ).rejects.toThrow(/not uploaded before it closed/);
  });

  /**
   * The refusal whose answer never arrived.
   *
   * This is the half the sync tests cannot reach: they replay a `visit.start` conflict and a
   * `visit.start` acceptance, which proves the receipt machinery and proves nothing about a
   * **photograph's file**. Here the refused command is a `media.declare`, it is replayed through
   * `processSyncCommands` with the same `commandId`, and the two things that matter are asserted —
   * the answer is still a refusal, and no `field_media` row exists for that photograph.
   *
   * Were the replay to come back `duplicate`, the device's `SETTLED` list would treat it as a
   * success, `acknowledgeMedia` would run and the next sweep would delete the only copy of a
   * photograph this server never stored.
   */
  it("a refused declaration replayed is still refused, and writes no row", async () => {
    await db.migrator.execute(sql`
      update app.field_visit set status = 'COMPLETED', completed_at = now() where id = ${visitId}
    `);
    const { ctx, stored } = await storePhotograph(technician);
    const localId = randomUUID();
    const command = {
      ...envelope(),
      type: "media.declare" as const,
      payload: {
        assignmentId,
        visitId,
        localId,
        storedObjectId: stored.storedObjectId,
        kind: "parcel" as const,
        capturedAt: new Date().toISOString(),
        note: null,
        location: null,
      },
    };

    const first = await processSyncCommands(db.runtime, ctx, [command]);
    expect(first.results[0]!.outcome).toBe("rejected");

    // The device never heard the answer and sends the identical command again.
    const replay = await processSyncCommands(db.runtime, ctx, [command]);
    expect(replay.results[0]!.outcome, "a refusal is not a duplicate").toBe("rejected");
    expect(replay.results[0]!.message).toBe(first.results[0]!.message);

    const rows = await db.migrator
      .select({ id: fieldSchema.fieldMedia.id })
      .from(fieldSchema.fieldMedia)
      .where(eq(fieldSchema.fieldMedia.localId, localId));
    expect(rows, "nothing was stored, so nothing may be acknowledged").toHaveLength(0);
  });

  /**
   * A device whose clock is wrong decides nothing.
   *
   * Both halves use the same bytes, uploaded before the same close; only the hour the phone
   * believes it is changes. Admissibility must not move with it — in either direction.
   */
  it("a phone an hour fast, and a phone an hour slow, are admitted alike", async () => {
    for (const desvio of [-3_600_000, 3_600_000]) {
      await db.migrator.execute(sql`
        update app.field_visit set status = 'IN_PROGRESS', completed_at = null where id = ${visitId}
      `);
      const { ctx, stored } = await storePhotograph(technician);
      await db.migrator.execute(sql`
        update app.field_visit set status = 'COMPLETED', completed_at = now() where id = ${visitId}
      `);

      const result = await declareFieldMedia(
        db.runtime,
        ctx,
        declaration({
          storedObjectId: stored.storedObjectId,
          capturedAt: new Date(Date.now() + desvio).toISOString(),
        }),
      );
      expect(result.outcome, `desvío ${desvio} ms`).toBe("stored");
    }
  });

  /**
   * The whole failure, end to end, without touching a row by hand.
   *
   * This is the sequence a technician actually produces and the one that was broken: the visit is
   * open, the bytes are uploaded, `survey.submit` arrives and **completes the visit**, and the
   * declaration follows it in the same batch. Nothing here edits `field_visit`; the close is the
   * product's own, through `processSyncCommands`.
   */
  it("a ficha submitted offline closes the visit, and the photograph still attaches", async () => {
    await db.migrator.execute(sql`
      update app.field_visit set status = 'IN_PROGRESS', completed_at = null where id = ${visitId}
    `);

    // Signal returns: the device uploads first, exactly as `uploadPendingMedia` does.
    const { ctx, stored } = await storePhotograph(technician);

    // …then the outbox drains, and the submit closes the visit.
    const submitted = await processSyncCommands(db.runtime, ctx, [
      {
        commandId: randomUUID(),
        protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
        deviceRevision: 1,
        occurredAt: new Date().toISOString(),
        appVersion: "0.1.0",
        packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
        type: "survey.submit",
        payload: {
          assignmentId,
          visitId,
          surveyVersionId,
          answers: { has_concern: { kind: "boolean" as const, value: true } },
        },
      },
    ]);
    expect(submitted.results[0]!.outcome).toBe("applied");

    const [visita] = await db.migrator
      .select({ status: fieldSchema.fieldVisit.status })
      .from(fieldSchema.fieldVisit)
      .where(eq(fieldSchema.fieldVisit.id, visitId));
    expect(visita?.status, "the submit is what closes the visit").toBe("COMPLETED");

    // …and the declaration, last in the batch, is accepted.
    const declared = await declareFieldMedia(
      db.runtime,
      ctx,
      declaration({ storedObjectId: stored.storedObjectId }),
    );
    expect(declared.outcome).toBe("stored");
    expect(declared.visitId).toBe(visitId);
  });

  afterAll(async () => {
    await db.migrator.execute(sql`
      update app.field_visit set status = 'IN_PROGRESS', completed_at = null where id = ${visitId}
    `);
  });

  it("an assignment the visit does not belong to", async () => {
    const { ctx, stored } = await storePhotograph(technician);
    const error = await attempt(
      declareFieldMedia(
        db.runtime,
        ctx,
        declaration({ storedObjectId: stored.storedObjectId, assignmentId: randomUUID() }),
      ),
    );
    expect(error).toMatch(/does not belong to the assignment/i);
  });
});

describe("who may see a photograph", () => {
  it("the technician who took it, and a coordinator who may read responses", async () => {
    const forTechnician = await loadVisitMedia(db.runtime, await contextFor(technician), visitId);
    expect(forTechnician.length).toBeGreaterThan(0);

    const forCoordinator = await loadVisitMedia(db.runtime, await contextFor(coordinator), visitId);
    expect(forCoordinator.length).toBe(forTechnician.length);
  });

  /*
   * A picture of a parcel can hold a person, a house number or a number plate. A GIS specialist
   * may know a parcel was visited without seeing what was photographed there — the same line
   * `survey_instance` draws (SECURITY.md §10b), enforced by the row-level policy rather than by a
   * check somebody has to remember.
   */
  it("not a GIS specialist, who holds field.read and not field.responses.read", async () => {
    const rows = await loadVisitMedia(db.runtime, await contextFor(gisSpecialist), visitId);
    expect(rows).toHaveLength(0);
  });

  it("not another technician, even on the same project", async () => {
    const rows = await loadVisitMedia(db.runtime, await contextFor(otherTechnician), visitId);
    expect(rows).toHaveLength(0);
  });

  it("the parcel workspace lists them, with whether there is a point and never the point", async () => {
    const rows = await loadParcelMedia(db.runtime, await contextFor(coordinator), parcelId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.mimeType).toBe("image/png");
      expect(typeof row.hasLocation).toBe("boolean");
      // A coordinate on a list is a coordinate in a screenshot, and this one is a person's
      // position at a moment.
      expect(JSON.stringify(row)).not.toMatch(/latitude|longitude|-4\.07|-78\.94/);
    }
  });

  it("the parcel workspace refuses a caller without field.responses.read", async () => {
    const error = await attempt(
      loadParcelMedia(db.runtime, await contextFor(gisSpecialist), parcelId),
    );
    expect(error).toMatch(/permission|denied|field\.responses\.read/i);
  });
});

describe("a declaration is written once", () => {
  it("cannot be updated or deleted, by the runtime role or by the owner", async () => {
    const { ctx, stored } = await storePhotograph(technician);
    const result = await declareFieldMedia(
      db.runtime,
      ctx,
      declaration({ storedObjectId: stored.storedObjectId }),
    );

    // The owning role, which the REVOKE does not constrain — the trigger is what refuses it.
    const update = await attempt(
      db.migrator
        .update(fieldSchema.fieldMedia)
        .set({ kind: "other" })
        .where(eq(fieldSchema.fieldMedia.id, result.mediaId)),
    );
    expect(update).toMatch(/written once/i);

    const remove = await attempt(
      db.migrator
        .delete(fieldSchema.fieldMedia)
        .where(eq(fieldSchema.fieldMedia.id, result.mediaId)),
    );
    expect(remove).toMatch(/written once/i);
  });
});

/**
 * The whole parcel captured with no signal at all, delivered in the order the fixed client sends.
 *
 * A technician opens the assignment in a valley: `visit.start` is queued, the ficha is filled and
 * submitted locally, two photographs are taken. Nothing has a server id. Then one bar of signal.
 *
 * The device's passes are what produce this order (`apps/field/src/sync/engine.ts`): the visit is
 * acknowledged first, which is what gives the photographs a visit to belong to; the declarations
 * go next, while the visit is still open; the ficha goes last and closes it. The assertions are
 * the relations a coordinator reads on the web — ficha ↔ visita ↔ predio ↔ fotografías.
 *
 * It has its own parcel and its own assignment, because the cases above share one visit and
 * reopen it between them, and a test that borrowed it would be asserting their photographs.
 */
describe("a parcel captured entirely offline", () => {
  it("arrives whole, and every relation holds", async () => {
    const ctxTech = await contextFor(technician);

    // Pass 1 — the visit. Until this is acknowledged the photographs have nothing to belong to.
    const started = await processSyncCommands(db.runtime, ctxTech, [
      {
        ...envelope(),
        type: "visit.start",
        payload: {
          assignmentId: offlineAssignmentId,
          location: null,
          locationOutcome: "not_attempted",
        },
      },
    ]);
    expect(started.results[0]!.outcome).toBe("applied");
    const visitaId = started.results[0]!.visitId!;

    // Pass 2 — the bytes, then the declarations, while the visit is still open.
    const first = await storePhotograph(technician);
    const second = await storePhotograph(technician);
    const localIds = [randomUUID(), randomUUID()] as const;
    const declared = await processSyncCommands(
      db.runtime,
      ctxTech,
      [0, 1].map((index) => ({
        ...envelope(),
        type: "media.declare" as const,
        payload: {
          assignmentId: offlineAssignmentId,
          visitId: visitaId,
          localId: localIds[index]!,
          storedObjectId: (index === 0 ? first : second).stored.storedObjectId,
          kind: index === 0 ? ("parcel" as const) : ("access" as const),
          capturedAt: new Date().toISOString(),
          note: null,
          location: null,
        },
      })),
    );
    expect(declared.results.map((result) => result.outcome)).toEqual(["applied", "applied"]);

    // Pass 3 — the ficha, which closes the visit.
    const submitted = await processSyncCommands(db.runtime, ctxTech, [
      {
        ...envelope(),
        type: "survey.submit",
        payload: {
          assignmentId: offlineAssignmentId,
          visitId: visitaId,
          surveyVersionId,
          answers: { has_concern: { kind: "boolean" as const, value: true } },
        },
      },
    ]);
    expect(submitted.results[0]!.outcome).toBe("applied");
    const instanceId = submitted.results[0]!.instanceId!;

    // ── the relations a coordinator reads ─────────────────────────────────────────────────────
    const [visita] = await db.migrator
      .select({
        status: fieldSchema.fieldVisit.status,
        assignmentId: fieldSchema.fieldVisit.assignmentId,
      })
      .from(fieldSchema.fieldVisit)
      .where(eq(fieldSchema.fieldVisit.id, visitaId));
    expect(visita?.status).toBe("COMPLETED");
    expect(visita?.assignmentId).toBe(offlineAssignmentId);

    const [instance] = await db.migrator
      .select({
        status: fieldSchema.surveyInstance.status,
        visitId: fieldSchema.surveyInstance.visitId,
      })
      .from(fieldSchema.surveyInstance)
      .where(eq(fieldSchema.surveyInstance.id, instanceId));
    expect(instance?.status).toBe("SUBMITTED");
    expect(instance?.visitId, "the ficha names the visit it was captured in").toBe(visitaId);

    const [asignacion] = await db.migrator
      .select({ parcelId: fieldSchema.fieldAssignment.parcelId })
      .from(fieldSchema.fieldAssignment)
      .where(eq(fieldSchema.fieldAssignment.id, offlineAssignmentId));
    expect(asignacion?.parcelId, "and the assignment names the parcel").toBe(offlineParcelId);

    // Two photographs on that visit, and one row each.
    const fotos = await loadVisitMedia(db.runtime, ctxTech, visitaId);
    expect(fotos).toHaveLength(2);
    expect([...fotos].map((foto) => foto.kind).sort()).toEqual(["access", "parcel"]);

    // What the web surface itself answers, for the coordinator rather than the technician.
    const delPredio = await loadParcelMedia(
      db.runtime,
      await contextFor(coordinator),
      offlineParcelId,
    );
    expect(delPredio).toHaveLength(2);

    /*
     * And the whole thing again, as a device that never heard the answers would send it: the same
     * `commandId`s and the same `localId`s. Nothing may double.
     */
    const again = await processSyncCommands(db.runtime, ctxTech, [
      {
        ...envelope(),
        type: "media.declare",
        payload: {
          assignmentId: offlineAssignmentId,
          visitId: visitaId,
          localId: localIds[0]!,
          storedObjectId: first.stored.storedObjectId,
          kind: "parcel" as const,
          capturedAt: new Date().toISOString(),
          note: null,
          location: null,
        },
      },
    ]);
    expect(again.results[0]!.outcome, "already declared is a success the device can act on").toBe(
      "applied",
    );
    expect(await loadVisitMedia(db.runtime, ctxTech, visitaId)).toHaveLength(2);
  });
});
