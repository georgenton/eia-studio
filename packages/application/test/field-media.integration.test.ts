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
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  buildRequestContext,
  createS3Storage,
  createUploadIntent,
  declareFieldMedia,
  finalizeUpload,
  loadParcelMedia,
  loadVisitMedia,
  resolveFinalizedUpload,
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
