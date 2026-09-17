import { documentsSchema, storageSchema } from "@eia/db";
import { InvalidInput, PermissionDenied, type SessionUser } from "@eia/domain";
import {
  attempt,
  createProjectMembership,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  buildRequestContext,
  createS3Storage,
  createUploadIntent,
  finalizeUpload,
  presignStoredObjectDownload,
  uploadDocumentVersion,
} from "../src/index";

/**
 * Object storage against a **real** S3-compatible provider (ADR-031).
 *
 * MinIO speaks the protocol the production adapter speaks, so what is exercised here is the
 * adapter itself — a signed PUT that a plain `fetch` performs, a HEAD the server trusts over the
 * client, and a GET whose bytes the server hashes. A memory stand-in would have agreed with itself.
 *
 * The suite is deliberately about the *refusals*. An upload path that works is table stakes; what
 * has to hold is that a key from another tenant, an object that was never uploaded, a file whose
 * bytes are not what it claimed and a second finalize all fail, and fail before anything is
 * written.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let technician: { id: string; email: string };
let storage: ReturnType<typeof createS3Storage>;

const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);
// `MZ`, the DOS header every Windows executable begins with.
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

/** What a browser does with an upload intent: PUT the bytes, with the signed content type. */
async function upload(url: string, headers: Record<string, string>, bytes: Uint8Array) {
  const response = await fetch(url, { method: "PUT", headers, body: bytes });
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of ["core.projects", "core.documents", "field.surveys"] as const) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }
  coordinator = await member("storage-coordinator", "COORDINATOR");
  technician = await member("storage-technician", "FIELD_TECHNICIAN");

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

describe("the upload a person is authorised to make", () => {
  it("names a key the client did not choose, and carries no filename", async () => {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "Ficha socioeconómica de María Quizhpe.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });

    expect(intent.key).toMatch(
      new RegExp(`^t/${w.tenantA.id}/p/${w.projectX.id}/documents/[0-9a-f-]{36}$`),
    );
    // The rule this key shape exists for: a bucket listing is not where a respondent's name goes.
    expect(intent.key.toLowerCase()).not.toContain("maria");
    expect(intent.key.toLowerCase()).not.toContain("ficha");
    expect(intent.key).not.toContain(".pdf");
    expect(intent.method).toBe("PUT");
    expect(intent.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("stores the bytes, verifies them against the provider, and hashes what it read", async () => {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "informe.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });
    await upload(intent.url, intent.headers, PDF_BYTES);

    const result = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });
    expect(result.sizeBytes).toBe(PDF_BYTES.byteLength);
    expect(result.originalFilename).toBe("informe.pdf");
    // SHA-256 of the bytes this product read back — not the provider's ETag (ADR-031 §4).
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.duplicateOfObjectId).toBeNull();

    const [head] = await Promise.all([storage.head(intent.key)]);
    expect(head?.sizeBytes).toBe(PDF_BYTES.byteLength);
  });

  it("says so when the same content is uploaded to the project again", async () => {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "informe-copia.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });
    await upload(intent.url, intent.headers, PDF_BYTES);
    const result = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });
    // Explicit rather than silent: the caller decides what a repeat means, and a document surface
    // turns it into "same content" rather than a second version (ADR-031 §6).
    expect(result.duplicateOfObjectId).not.toBeNull();
  });

  it("mints a short-lived link to read it back", async () => {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "descargable.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });
    await upload(intent.url, intent.headers, PDF_BYTES);
    const stored = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });

    const link = await presignStoredObjectDownload(db.runtime, ctx, storage, stored.storedObjectId);
    expect(link.filename).toBe("descargable.pdf");
    const response = await fetch(link.url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });
});

describe("what an upload is refused for", () => {
  it("a type this surface does not accept", async () => {
    const ctx = await contextFor(coordinator);
    await expect(
      createUploadIntent(db.runtime, ctx, storage, {
        namespace: "documents",
        filename: "hoja.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("a size beyond the format's ceiling", async () => {
    const ctx = await contextFor(coordinator);
    await expect(
      createUploadIntent(db.runtime, ctx, storage, {
        namespace: "documents",
        filename: "enorme.pdf",
        mimeType: "application/pdf",
        sizeBytes: 500 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("a role without the grant that namespace needs", async () => {
    // A technician may upload media and not documents; the check is the permission, not the route.
    const ctx = await contextFor(technician);
    await expect(
      createUploadIntent(db.runtime, ctx, storage, {
        namespace: "documents",
        filename: "informe.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);

    const allowed = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "field-media",
      filename: "predio.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
    });
    expect(allowed.key).toContain("/field-media/");
  });
});

describe("what finalize refuses, and refuses before writing anything", () => {
  async function issued() {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "pendiente.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });
    return { ctx, intent };
  }

  it("an object that was never uploaded", async () => {
    const { ctx, intent } = await issued();
    const error = await attempt(
      finalizeUpload(db.runtime, ctx, storage, {
        intentId: intent.intentId,
        objectKey: intent.key,
      }),
    );
    expect(error).toMatch(/nothing was uploaded/i);
    const rows = await db.migrator
      .select()
      .from(storageSchema.storedObject)
      .where(eq(storageSchema.storedObject.objectKey, intent.key));
    expect(rows).toHaveLength(0);
  });

  it("a key that is not the one it authorised", async () => {
    const { ctx, intent } = await issued();
    const other = await issued();
    await upload(other.intent.url, other.intent.headers, PDF_BYTES);
    const error = await attempt(
      finalizeUpload(db.runtime, ctx, storage, {
        intentId: intent.intentId,
        objectKey: other.intent.key,
      }),
    );
    expect(error).toMatch(/not the object that was authorised/i);
  });

  it("bytes that are not the format the client declared — the renamed .exe", async () => {
    const { ctx, intent } = await issued();
    await upload(intent.url, intent.headers, EXE_BYTES);
    const error = await attempt(
      finalizeUpload(db.runtime, ctx, storage, {
        intentId: intent.intentId,
        objectKey: intent.key,
      }),
    );
    expect(error).toMatch(/not the format it claims/i);
    const rows = await db.migrator
      .select()
      .from(storageSchema.storedObject)
      .where(eq(storageSchema.storedObject.objectKey, intent.key));
    expect(rows, "nothing is described when the bytes are refused").toHaveLength(0);
  });

  it("a second finalize of the same intent", async () => {
    const { ctx, intent } = await issued();
    await upload(intent.url, intent.headers, PDF_BYTES);
    await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });
    const error = await attempt(
      finalizeUpload(db.runtime, ctx, storage, {
        intentId: intent.intentId,
        objectKey: intent.key,
      }),
    );
    expect(error).toMatch(/already finalized/i);
  });

  it("an intent that belongs to another tenant's project", async () => {
    const { intent } = await issued();
    const stranger = await createUser(db.migrator, "storage-stranger");
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantB.id,
      userId: stranger.id,
      role: "MEMBER",
    });
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      tenantMembershipId: tenantMembership.id,
      role: "COORDINATOR",
    });
    const foreign = await buildRequestContext(db.runtime, {
      sessionUser: {
        subject: stranger.id,
        email: stranger.email,
        name: null,
        emailVerified: true,
      },
      tenantSlug: w.tenantB.slug,
      projectSlug: w.projectZ.slug,
    });

    // The row is invisible under their context, so the intent simply does not exist for them.
    const error = await attempt(
      finalizeUpload(db.runtime, foreign, storage, {
        intentId: intent.intentId,
        objectKey: intent.key,
      }),
    );
    expect(error).toMatch(/not authorised here/i);
  });
});

describe("the row is what anything else may read", () => {
  it("a stored object's description cannot be rewritten, even by the owner", async () => {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "inmutable.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });
    await upload(intent.url, intent.headers, PDF_BYTES);
    const stored = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });

    const error = await attempt(
      db.migrator
        .update(storageSchema.storedObject)
        .set({ sizeBytes: 1 })
        .where(eq(storageSchema.storedObject.id, stored.storedObjectId)),
    );
    expect(error).toMatch(/stored_object_immutable/i);
  });

  it("an intent's authorisation cannot be widened after it is granted", async () => {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "limite.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    const error = await attempt(
      db.migrator
        .update(storageSchema.uploadIntent)
        .set({ maxBytes: 999_999_999 })
        .where(eq(storageSchema.uploadIntent.id, intent.intentId)),
    );
    expect(error).toMatch(/upload_intent_immutable/i);
  });
});

describe("a delivered file becomes a version of a document (PART G)", () => {
  async function storeFile(bytes: Uint8Array, filename: string) {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename,
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
    });
    await upload(intent.url, intent.headers, bytes);
    const stored = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });
    return { ctx, stored };
  }

  it("creates the document and its first version, uploaded and not yet processed", async () => {
    const { ctx, stored } = await storeFile(PDF_BYTES, "estudio-social.pdf");
    const result = await uploadDocumentVersion(db.runtime, ctx, {
      documentId: null,
      code: "DOC-UP1",
      title: "Estudio social",
      kind: "report",
      storedObjectId: stored.storedObjectId,
      privacyClassification: "NO_PERSONAL_DATA_KNOWN",
      sourceDate: "2026-08-28",
      sourceNote: "Entregado por la consultora",
    });
    expect(result.outcome).toBe("stored");
    expect(result.versionLabel).toBe("v1");

    const [version] = await db.migrator
      .select()
      .from(documentsSchema.documentVersion)
      .where(eq(documentsSchema.documentVersion.id, result.versionId!));
    // Uploaded is not processed, and the row says so rather than implying passages exist.
    expect(version?.processingState).toBe("UPLOADED");
    expect(version?.textSource).toBe("PENDING_EXTRACTION");
    expect(version?.chunkCount).toBe(0);
    expect(version?.fileSha256).toBe(stored.sha256);
    expect(version?.originalFilename).toBe("estudio-social.pdf");
  });

  it("a corrected delivery is v2, and v1's object is untouched", async () => {
    const first = await storeFile(PDF_BYTES, "plan.pdf");
    const created = await uploadDocumentVersion(db.runtime, first.ctx, {
      documentId: null,
      code: "DOC-UP2",
      title: "Plan de participación",
      kind: "plan",
      storedObjectId: first.stored.storedObjectId,
      privacyClassification: "REVIEW_REQUIRED",
      sourceDate: null,
      sourceNote: "Primera entrega",
    });

    const corrected = new Uint8Array([...PDF_BYTES, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
    const second = await storeFile(corrected, "plan-corregido.pdf");
    const result = await uploadDocumentVersion(db.runtime, second.ctx, {
      documentId: created.documentId,
      code: null,
      title: null,
      kind: null,
      storedObjectId: second.stored.storedObjectId,
      privacyClassification: "REVIEW_REQUIRED",
      sourceDate: null,
      sourceNote: "Entrega corregida",
    });
    expect(result.outcome).toBe("stored");
    expect(result.versionLabel).toBe("v2");

    // The whole reason a version is a version: v1's bytes are still there, byte for byte.
    expect(await storage.get(first.stored.objectKey)).toEqual(PDF_BYTES);
    expect(await storage.get(second.stored.objectKey)).toEqual(corrected);
  });

  it("the same file again is answered, not duplicated", async () => {
    const first = await storeFile(PDF_BYTES, "tdr.pdf");
    const created = await uploadDocumentVersion(db.runtime, first.ctx, {
      documentId: null,
      code: "DOC-UP3",
      title: "Términos de referencia",
      kind: "legal",
      storedObjectId: first.stored.storedObjectId,
      privacyClassification: "NO_PERSONAL_DATA_KNOWN",
      sourceDate: null,
      sourceNote: "Entrega original",
    });

    const again = await storeFile(PDF_BYTES, "tdr-reenviado.pdf");
    const result = await uploadDocumentVersion(db.runtime, again.ctx, {
      documentId: created.documentId,
      code: null,
      title: null,
      kind: null,
      storedObjectId: again.stored.storedObjectId,
      privacyClassification: "NO_PERSONAL_DATA_KNOWN",
      sourceDate: null,
      sourceNote: "Reenvío",
    });
    expect(result.outcome).toBe("same_content");
    expect(result.versionLabel).toBe("v1");

    const versions = await db.migrator
      .select({ id: documentsSchema.documentVersion.id })
      .from(documentsSchema.documentVersion)
      .where(eq(documentsSchema.documentVersion.documentId, created.documentId));
    expect(versions, "no second version was written").toHaveLength(1);
  });

  it("refuses a code this project already uses, with a sentence and not a constraint", async () => {
    const first = await storeFile(PDF_BYTES, "acta.pdf");
    await uploadDocumentVersion(db.runtime, first.ctx, {
      documentId: null,
      code: "DOC-UP5",
      title: "Acta de socialización",
      kind: "minutes",
      storedObjectId: first.stored.storedObjectId,
      privacyClassification: "REVIEW_REQUIRED",
      sourceDate: null,
      sourceNote: "Entregada por la consultora",
    });

    // Different bytes, so nothing here turns on the same-content answer: this is a second
    // *document* claiming a code the first one holds, which would make every citation naming that
    // code ambiguous.
    const second = await storeFile(
      new Uint8Array([...PDF_BYTES, 0x0a, 0x25, 0x25]),
      "acta-otra.pdf",
    );
    const error = await attempt(
      uploadDocumentVersion(db.runtime, second.ctx, {
        documentId: null,
        code: "DOC-UP5",
        title: "Otra acta con el mismo código",
        kind: "minutes",
        storedObjectId: second.stored.storedObjectId,
        privacyClassification: "REVIEW_REQUIRED",
        sourceDate: null,
        sourceNote: "No debería entrar",
      }),
    );
    expect(error).toMatch(/already has a document DOC-UP5/i);

    const documents = await db.migrator
      .select({ id: documentsSchema.sourceDocument.id })
      .from(documentsSchema.sourceDocument)
      .where(eq(documentsSchema.sourceDocument.code, "DOC-UP5"));
    expect(documents, "no second document was written").toHaveLength(1);
  });

  it("refuses a field photograph filed as a document", async () => {
    // Captured by the technician, whose grant it is; filed by the coordinator, whose grant that
    // is. Both are on the project, so the object is visible to both — and it is still refused,
    // because a namespace is what a file *is*, not who can see it.
    const technicianCtx = await contextFor(technician);
    const intent = await createUploadIntent(db.runtime, technicianCtx, storage, {
      namespace: "field-media",
      filename: "predio.png",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
    });
    await upload(intent.url, intent.headers, PNG_BYTES);
    const stored = await finalizeUpload(db.runtime, technicianCtx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });

    const ctx = await contextFor(coordinator);
    const error = await attempt(
      uploadDocumentVersion(db.runtime, ctx, {
        documentId: null,
        code: "DOC-UP4",
        title: "Una fotografía",
        kind: "annex",
        storedObjectId: stored.storedObjectId,
        privacyClassification: "REVIEW_REQUIRED",
        sourceDate: null,
        sourceNote: "No debería entrar",
      }),
    );
    expect(error).toMatch(/uploaded as field media/i);
  });
});
