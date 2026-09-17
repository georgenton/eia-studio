import { documentsSchema, storageSchema } from "@eia/db";
import type { SessionUser } from "@eia/domain";
import {
  attempt,
  buildDocx,
  buildPdf,
  buildZipBomb,
  createProjectMembership,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  buildRequestContext,
  claimNextExtraction,
  createS3Storage,
  createUploadIntent,
  finalizeUpload,
  loadDocumentVersion,
  processDocumentExtraction,
  issueDocumentDownload,
  queueDocumentExtraction,
  releaseStaleExtractions,
  uploadDocumentVersion,
  FullTextRetriever,
} from "../src/index";
import { withDbContext } from "@eia/db";

/**
 * A delivered file becomes passages a citation can name (ADR-033), against a real provider, a real
 * database and a real PDF.
 *
 * The suite is about the **four outcomes**, and three of them are not the happy path: a scan that
 * must not be indexed, a corrupt file that must not crash a worker, and an archive that lies about
 * how much it expands to. The happy path's assertion is the one that matters most anyway — that a
 * PDF's citation names the page a reader will turn to, and a DOCX's names nothing of the kind.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let technician: { id: string; email: string };
let storage: ReturnType<typeof createS3Storage>;

const prose = (times: number) =>
  "El estudio describe la afectacion predial a lo largo del corredor vial. ".repeat(times);

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

/** The same coordinator, scoped to the tenant's other project. */
async function otherProjectContext() {
  const sessionUser: SessionUser = {
    subject: coordinator.id,
    email: coordinator.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, {
    sessionUser,
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectY.slug,
  });
}

async function upload(url: string, headers: Record<string, string>, bytes: Uint8Array) {
  const response = await fetch(url, { method: "PUT", headers, body: bytes });
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
}

/** Everything that happens before the worker: intent, PUT, finalize, version, queue. */
async function deliver(
  code: string,
  bytes: Uint8Array,
  format: "pdf" | "docx",
): Promise<{ versionId: string }> {
  const ctx = await contextFor(coordinator);
  const mimeType =
    format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const intent = await createUploadIntent(db.runtime, ctx, storage, {
    namespace: "documents",
    filename: `${code.toLowerCase()}.${format}`,
    mimeType,
    sizeBytes: bytes.byteLength,
  });
  await upload(intent.url, intent.headers, bytes);
  const stored = await finalizeUpload(db.runtime, ctx, storage, {
    intentId: intent.intentId,
    objectKey: intent.key,
  });
  const version = await uploadDocumentVersion(db.runtime, ctx, {
    documentId: null,
    code,
    title: `Documento ${code}`,
    kind: "report",
    storedObjectId: stored.storedObjectId,
    privacyClassification: "NO_PERSONAL_DATA_KNOWN",
    sourceDate: null,
    sourceNote: "Entregado por la consultora",
  });
  await queueDocumentExtraction(db.runtime, ctx, version.versionId!);
  return { versionId: version.versionId! };
}

/** One turn of the worker's loop. */
async function runWorkerOnce() {
  const claim = await claimNextExtraction(db.runtime);
  if (!claim) return null;
  return processDocumentExtraction(db.runtime, claim, storage);
}

async function versionRow(versionId: string) {
  const [row] = await db.migrator
    .select()
    .from(documentsSchema.documentVersion)
    .where(eq(documentsSchema.documentVersion.id, versionId));
  return row;
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of ["core.projects", "core.documents"] as const) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }
  const user = await createUser(db.migrator, "extraction-coordinator");
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: user.id,
    role: "MEMBER",
  });
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: tenantMembership.id,
    role: "COORDINATOR" as never,
  });
  coordinator = user;

  // A technician on the same project: holds `media.upload`, not `documents.read`.
  const tech = await createUser(db.migrator, "extraction-technician");
  const techTenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: tech.id,
    role: "MEMBER",
  });
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: techTenantMembership.id,
    role: "FIELD_TECHNICIAN" as never,
  });
  technician = tech;

  // The same person on the tenant's *other* project, so "not this project" is observable without
  // crossing a tenant boundary — the narrower and more realistic failure.
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    tenantMembershipId: tenantMembership.id,
    role: "COORDINATOR" as never,
  });

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

describe("a PDF, whose citation names a page a reader can turn to", () => {
  it("is read, chunked, and every chunk carries a real page number", async () => {
    const { versionId } = await deliver(
      "DOC-PDF1",
      buildPdf([
        prose(6),
        prose(5) + "El segundo capitulo trata de la consulta significativa.",
        prose(4),
      ]),
      "pdf",
    );

    const outcome = await runWorkerOnce();
    expect(outcome?.state).toBe("READY");
    expect(outcome?.locatorKind).toBe("PAGE");
    expect(outcome?.pageCount).toBe(3);
    expect(outcome!.chunkCount).toBeGreaterThan(0);

    const version = await versionRow(versionId);
    expect(version?.processingState).toBe("READY");
    // The text hash at last: until extraction ran, `content_hash` held the file's (ADR-031 §7).
    expect(version?.textSource).toBe("PDF_TEXT");
    expect(version?.contentHash).not.toBe(version?.fileSha256);

    const chunks = await db.migrator
      .select()
      .from(documentsSchema.documentChunk)
      .where(eq(documentsSchema.documentChunk.versionId, versionId));
    expect(chunks.length).toBe(version?.chunkCount);
    for (const chunk of chunks) {
      expect(chunk.locatorKind).toBe("PAGE");
      expect(chunk.pageFrom).not.toBeNull();
      expect(chunk.pageFrom!).toBeGreaterThanOrEqual(1);
      expect(chunk.pageFrom!).toBeLessThanOrEqual(3);
      expect(chunk.sectionPath).toBeNull();
    }
  });

  it("the words in the file are the words a reader finds", async () => {
    const ctx = await contextFor(coordinator);
    const found = await withDbContext(db.runtime, ctx, (tx) =>
      new FullTextRetriever(tx, { tenantId: ctx.tenantId, projectId: ctx.projectId! }).retrieve({
        question: "consulta significativa",
        limit: 5,
      }),
    );
    const passage = found.passages.find((p) => p.documentCode === "DOC-PDF1");
    expect(passage, "the uploaded PDF is searchable").toBeDefined();
    expect(passage!.text).toContain("consulta significativa");
    // The page a citation would name, from the file rather than from a chunk index.
    expect(passage!.locatorKind).toBe("PAGE");
    expect(passage!.pageFrom).toBe(2);
  });
});

describe("a DOCX, which has no pages this product could know", () => {
  it("is located by its heading trail, and stores no page number at all", async () => {
    const { versionId } = await deliver(
      "DOC-DOCX1",
      buildDocx([
        { text: "6. Plan de Manejo Ambiental", headingLevel: 1 },
        { text: "6.2 Programa de manejo de desechos", headingLevel: 2 },
        { text: prose(8) },
        { text: "7. Cronograma", headingLevel: 1 },
        { text: prose(8) },
      ]),
      "docx",
    );

    const outcome = await runWorkerOnce();
    expect(outcome?.state).toBe("READY");
    expect(outcome?.locatorKind).toBe("SECTION");
    // Zero, and honestly so: reporting a page count would be the invention the whole design avoids.
    expect(outcome?.pageCount).toBe(0);

    const version = await versionRow(versionId);
    expect(version?.textSource).toBe("DOCX_TEXT");

    const chunks = await db.migrator
      .select()
      .from(documentsSchema.documentChunk)
      .where(eq(documentsSchema.documentChunk.versionId, versionId));
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.locatorKind).toBe("SECTION");
      expect(chunk.pageFrom).toBeNull();
      expect(chunk.pageTo).toBeNull();
    }
    // The trail resets at a sibling heading rather than accumulating every heading ever seen.
    const trails = chunks.map((chunk) => chunk.sectionPath);
    expect(trails.some((trail) => trail?.includes("6.2 Programa de manejo de desechos"))).toBe(
      true,
    );
    expect(trails.some((trail) => trail === "7. Cronograma")).toBe(true);
    expect(trails.some((trail) => trail?.includes("6. Plan") && trail.includes("7. Crono"))).toBe(
      false,
    );
  });

  it("its passages render a section rather than a page", async () => {
    const ctx = await contextFor(coordinator);
    const detail = await loadDocumentVersion(db.runtime, ctx, "DOC-DOCX1");
    expect(detail.passages.length).toBeGreaterThan(0);
    for (const passage of detail.passages) {
      expect(passage.locatorKind).toBe("SECTION");
      expect(passage.pageFrom).toBeNull();
    }
  });
});

describe("a PDF that is a scan", () => {
  /*
   * The outcome this whole module exists for. Extracting a scan yields a handful of characters of
   * noise; chunked and indexed, that becomes a document which *appears* searchable and answers
   * nothing — under a citation somebody would quote.
   */
  it("is REQUIRES_OCR, not a document with three words in it", async () => {
    const { versionId } = await deliver("DOC-SCAN1", buildPdf(["", "", "", ""]), "pdf");

    const outcome = await runWorkerOnce();
    expect(outcome?.state).toBe("REQUIRES_OCR");
    expect(outcome?.chunkCount).toBe(0);

    const version = await versionRow(versionId);
    expect(version?.processingState).toBe("REQUIRES_OCR");
    // The note carries the numbers, so an operator can see *why* rather than be told a verdict.
    expect(version?.processingNote).toMatch(/pages carry text/);
    // Nothing was indexed. A scan contributes no passages, so it can never be cited.
    const chunks = await db.migrator
      .select()
      .from(documentsSchema.documentChunk)
      .where(eq(documentsSchema.documentChunk.versionId, versionId));
    expect(chunks).toHaveLength(0);
  });
});

describe("a file that cannot be read", () => {
  it("is FAILED, with a bounded note, and the worker keeps running", async () => {
    // Bytes that begin `%PDF` — so the upload gate accepted them (ADR-031) — and are not a PDF.
    const notReallyAPdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0x01, 0x02, 0x03,
    ]);
    const { versionId } = await deliver("DOC-BAD1", notReallyAPdf, "pdf");

    const outcome = await runWorkerOnce();
    expect(outcome?.state).toBe("FAILED");

    const version = await versionRow(versionId);
    expect(version?.processingState).toBe("FAILED");
    expect(version?.processingNote).not.toBeNull();
    // Operational text a consultant reads, not a stack trace.
    expect(version!.processingNote!.length).toBeLessThanOrEqual(400);
    expect(version?.processingNote).not.toMatch(/\bat \/|node_modules/);
  });

  it("a DOCX that lies about how much it expands to is refused, not expanded", async () => {
    const { versionId } = await deliver("DOC-BOMB1", buildZipBomb(), "docx");
    const outcome = await runWorkerOnce();
    expect(outcome?.state).toBe("FAILED");
    const version = await versionRow(versionId);
    expect(version?.processingNote).toMatch(/expand/i);
  });
});

describe("the queue itself", () => {
  it("a version nobody asked to have read is not claimed", async () => {
    const ctx = await contextFor(coordinator);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "quieto.pdf",
      mimeType: "application/pdf",
      sizeBytes: 64,
    });
    const bytes = buildPdf([prose(4)]);
    await upload(intent.url, intent.headers, bytes);
    const stored = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });
    const version = await uploadDocumentVersion(db.runtime, ctx, {
      documentId: null,
      code: "DOC-QUIET",
      title: "No encolado",
      kind: "report",
      storedObjectId: stored.storedObjectId,
      privacyClassification: "REVIEW_REQUIRED",
      sourceDate: null,
      sourceNote: "Cargado sin encolar",
    });

    // `UPLOADED` is a real state, not a formality: the file is stored and nobody asked for it to
    // be read. The worker leaves it alone until somebody does.
    expect((await versionRow(version.versionId!))?.processingState).toBe("UPLOADED");
    expect(await runWorkerOnce()).toBeNull();
  });

  it("a version already read cannot be read again, because its chunks are immutable", async () => {
    const ctx = await contextFor(coordinator);
    const [ready] = await db.migrator
      .select({ id: documentsSchema.documentVersion.id })
      .from(documentsSchema.documentVersion)
      .where(
        and(
          eq(documentsSchema.documentVersion.processingState, "READY"),
          eq(documentsSchema.documentVersion.projectId, w.projectX.id),
        ),
      );
    const error = await attempt(queueDocumentExtraction(db.runtime, ctx, ready!.id));
    expect(error).toMatch(/already been read/i);
  });

  it("a claim a crashed worker never finished returns to the queue", async () => {
    await deliver("DOC-STALE1", buildPdf([prose(5)]), "pdf");
    const claim = await claimNextExtraction(db.runtime);
    expect(claim).not.toBeNull();
    expect((await versionRow(claim!.versionId))?.processingState).toBe("PROCESSING");

    // The worker is killed here. Nothing settles the version, and without the release it would
    // sit in PROCESSING for ever.
    await db.migrator.execute(
      sql`update app.document_version set extraction_claimed_at = now() - interval '1 hour'
           where id = ${claim!.versionId}`,
    );
    expect(await releaseStaleExtractions(db.runtime, "15 minutes")).toBeGreaterThanOrEqual(1);
    expect((await versionRow(claim!.versionId))?.processingState).toBe("QUEUED");

    // And it is picked up again, rather than being stranded or silently failed.
    expect((await runWorkerOnce())?.state).toBe("READY");
  });

  /*
   * A `PAGE` chunk with no page, or a `SECTION` chunk with one, would be a row whose citation says
   * one thing and whose data says another. The CHECK is what stops a future extractor writing it —
   * an *insert*, because a chunk has been write-once since Slice 6 and an UPDATE never gets that
   * far.
   */
  it("a locator that disagrees with itself is refused by the database", async () => {
    const [chunk] = await db.migrator
      .select()
      .from(documentsSchema.documentChunk)
      .where(eq(documentsSchema.documentChunk.locatorKind, "PAGE"))
      .limit(1);

    const attempts: ReadonlyArray<[string, string, string, string]> = [
      // A section that claims a page.
      ["SECTION", "3", "3", "'6. Plan de Manejo'"],
      // A page with none.
      ["PAGE", "null", "null", "null"],
    ];
    for (const [kind, from, to, path] of attempts) {
      let constraint = "";
      try {
        await db.migrator.execute(
          sql.raw(
            `insert into app.document_chunk
               (id, tenant_id, project_id, version_id, ordinal, locator_kind, page_from, page_to,
                section_path, char_from, char_to, text, content_hash)
             values (gen_random_uuid(), '${chunk!.tenantId}', '${chunk!.projectId}',
                     '${chunk!.versionId}', 9999, '${kind}', ${from}, ${to}, ${path},
                     0, 10, 'texto', 'hash')`,
          ),
        );
      } catch (error) {
        constraint = (error as { cause?: { constraint?: string } }).cause?.constraint ?? "";
      }
      expect(constraint, kind).toBe("document_chunk_locator_consistent");
    }
  });
});

/**
 * Handing somebody the original file (ADR-034).
 *
 * The interesting assertions are the refusals and the audit line, not the happy path: a download
 * link is a bearer credential for five minutes, and what must never happen is that one is minted
 * for a caller who could not read the row, or that the log of it carries the filename.
 */
describe("downloading an original", () => {
  let versionId: string;

  beforeAll(async () => {
    const delivered = await deliver("DOC-DL1", buildPdf([prose(6)]), "pdf");
    versionId = delivered.versionId;
  });

  it("mints a signed link the provider honours, and the bytes come back", async () => {
    const ctx = await contextFor(coordinator);
    const link = await issueDocumentDownload(db.runtime, ctx, storage, versionId);

    expect(link.filename).toBe("doc-dl1.pdf");
    expect(link.sizeBytes).toBeGreaterThan(0);

    /*
     * The URL **does** contain the object key, because that is what a presigned S3 GET is: the
     * path addresses the object and the query string carries the signature. There is no way to
     * sign a fetch of an object without naming it.
     *
     * What makes that acceptable is ADR-031's key design, and this is the assertion that keeps it
     * true: the key is a namespace and four UUIDs, so a link pasted into a chat discloses *that a
     * document exists* and nothing about whose it is. No filename, no document code, no date, no
     * person. SECURITY.md §7's rule — "the UI never receives raw keys of other objects" — is met
     * by the page, which holds a route and not a key.
     */
    const path = new URL(link.url).pathname;
    expect(path).toMatch(/\/t\/[0-9a-f-]{36}\/p\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/);
    expect(path).not.toContain("doc-dl1");
    expect(path).not.toContain(".pdf");

    const response = await fetch(link.url);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("%PDF");
    // The delivered name is restored on the link rather than carried in the key.
    expect(response.headers.get("content-disposition")).toContain("doc-dl1.pdf");
  });

  it("records the issuance without the filename, the key or the hash", async () => {
    const ctx = await contextFor(coordinator);
    await issueDocumentDownload(db.runtime, ctx, storage, versionId);

    const rows = await db.migrator.execute(
      sql`select action::text as action, details from audit.log
           where object_id = ${versionId} and action = 'document.version.download_issued'
           order by occurred_at desc limit 1`,
    );
    const entry = rows.rows[0] as { action: string; details: Record<string, unknown> } | undefined;
    expect(entry?.action).toBe("document.version.download_issued");
    // The document, the version and the privacy claim — what a reviewer of this log needs.
    expect(entry?.details).toMatchObject({ document: "DOC-DL1", versionLabel: "v1" });
    const serialised = JSON.stringify(entry?.details ?? {});
    expect(serialised).not.toContain("doc-dl1.pdf");
    expect(serialised).not.toMatch(/t\/[0-9a-f-]{36}\/p\//);
    expect(serialised).not.toMatch(/[0-9a-f]{64}/);
  });

  it("refuses a caller without documents.read, and says nothing about the version", async () => {
    // A technician holds `media.upload` and no `documents.read`. The refusal must not distinguish
    // "you may not" from "it is not there".
    const error = await attempt(
      issueDocumentDownload(db.runtime, await contextFor(technician), storage, versionId),
    );
    expect(error).toMatch(/permission|denied|documents\.read/i);
  });

  it("refuses a version of another project, as a not-found", async () => {
    const error = await attempt(
      issueDocumentDownload(db.runtime, await otherProjectContext(), storage, versionId),
    );
    expect(error).toMatch(/document version|not found/i);
  });

  it("refuses a version that has no file, rather than offering a dead link", async () => {
    // Every transcribed excerpt in the pilot corpus is one of these: text read by hand, no PDF.
    const ctx = await contextFor(coordinator);
    const [excerpt] = await db.migrator
      .select({ id: documentsSchema.documentVersion.id })
      .from(documentsSchema.documentVersion)
      .where(isNull(documentsSchema.documentVersion.storedObjectId))
      .limit(1);
    if (!excerpt) return;
    const error = await attempt(issueDocumentDownload(db.runtime, ctx, storage, excerpt.id));
    expect(error).toMatch(/document version|not found/i);
  });

  it("the link stops working once it expires", async () => {
    // Signed for a bounded life by the provider, not by us (SECURITY.md §12: TTL ≤ 15 minutes).
    // Asked for one second, the provider refuses it a moment later — which is the property, and
    // the only way to observe it without waiting five minutes.
    const briefly = await storage.presignDownload(
      (
        await db.migrator
          .select({ key: storageSchema.storedObject.objectKey })
          .from(storageSchema.storedObject)
          .limit(1)
      )[0]!.key,
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const response = await fetch(briefly.url);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
