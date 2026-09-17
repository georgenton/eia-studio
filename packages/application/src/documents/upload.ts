import { randomUUID } from "node:crypto";

import { documentsSchema, storageSchema, withDbContext, type Database } from "@eia/db";
import {
  InvalidInput,
  NotFound,
  nextVersionLabel,
  requireCapability,
  requirePermission,
  type RequestContext,
} from "@eia/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";

/**
 * A delivered file becomes a version of a document (PART G, ADR-031).
 *
 * ## A document is a name; a version is a file
 *
 * `SourceDocument` is the identity a person uses — *Estudio social*, `DOC-002` — and it points at
 * a current version. A corrected delivery is **version 2 of the same document**, not a second
 * document, because every citation made against version 1 has to keep resolving to the words it
 * cited. The v1 object is never overwritten: a new upload is a new key, a new stored object and a
 * new row.
 *
 * ## Why the same file twice is answered rather than duplicated
 *
 * Re-uploading byte-identical content to the same document would create a version whose only
 * difference from its predecessor is its number, and would move "which version is current" under
 * every reader for no observable cause. So the **file** hash decides, and the answer is explicit:
 * the caller is told it is the same content and which version already holds it. A different hash
 * is a new version, always.
 *
 * Deduplication is per document, and never across tenants: whether another firm holds the same
 * file is not a fact this product may reveal.
 *
 * ## What this use-case does not do
 *
 * It does not read the file. The version lands in `UPLOADED` with `PENDING_EXTRACTION` as its text
 * source, no pages and no chunks, and the surface says so — *uploaded* is not *processed*.
 * Extraction is the worker's, and a version that has not been through it has no passages to cite.
 */
export const uploadDocumentVersionInputSchema = z
  .object({
    /** An existing document to add a version to, or null to create one. */
    documentId: z.uuid().nullable(),
    /** Required when `documentId` is null. `DOC-014`, unique per project. */
    code: z.string().trim().min(2).max(40).nullable(),
    title: z.string().trim().min(2).max(300).nullable(),
    kind: z.enum(["report", "annex", "minutes", "plan", "legal", "other"]).nullable(),
    /** The verified upload this version's file came from. */
    storedObjectId: z.uuid(),
    privacyClassification: z.enum([
      "NO_PERSONAL_DATA_KNOWN",
      "CONTAINS_PERSONAL_DATA",
      "REVIEW_REQUIRED",
    ]),
    /** The date the document itself bears, when the uploader knows it. */
    sourceDate: z.string().date().nullable(),
    sourceNote: z.string().trim().min(3).max(400),
  })
  .strict();

export interface UploadedDocumentVersion {
  readonly documentId: string;
  readonly documentCode: string;
  readonly versionId: string | null;
  readonly versionLabel: string;
  /**
   * `stored` — a new version was written.
   * `same_content` — this exact file is already a version of this document; nothing was written,
   * and `versionLabel` names the version that already holds it.
   */
  readonly outcome: "stored" | "same_content";
}

export async function uploadDocumentVersion(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<UploadedDocumentVersion> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "documents.write");
  const projectId = requireProject(ctx);
  const parsed = uploadDocumentVersionInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;

  return withDbContext(db, ctx, async (tx) => {
    // The object must be one this project finalized. RLS already scopes the read; the namespace
    // check is what stops a field photograph being filed as a document.
    const [object] = await tx
      .select()
      .from(storageSchema.storedObject)
      .where(
        and(
          eq(storageSchema.storedObject.id, input.storedObjectId),
          eq(storageSchema.storedObject.projectId, projectId),
        ),
      );
    if (!object) throw new NotFound("no such uploaded file in this project");
    if (object.namespace !== "documents") {
      throw new InvalidInput("that file was uploaded as field media, not as a document");
    }

    const document = await resolveDocument(tx, ctx, projectId, input);

    // Same file, same document: answered rather than duplicated (PART G3).
    const [existing] = await tx
      .select({
        id: documentsSchema.documentVersion.id,
        versionLabel: documentsSchema.documentVersion.versionLabel,
      })
      .from(documentsSchema.documentVersion)
      .where(
        and(
          eq(documentsSchema.documentVersion.documentId, document.id),
          eq(documentsSchema.documentVersion.fileSha256, object.sha256),
        ),
      );
    if (existing) {
      return {
        documentId: document.id,
        documentCode: document.code,
        versionId: existing.id,
        versionLabel: existing.versionLabel,
        outcome: "same_content" as const,
      };
    }

    const labels = await tx
      .select({ versionLabel: documentsSchema.documentVersion.versionLabel })
      .from(documentsSchema.documentVersion)
      .where(eq(documentsSchema.documentVersion.documentId, document.id))
      .orderBy(desc(documentsSchema.documentVersion.importedAt));
    const versionLabel = nextVersionLabel(labels.map((row) => row.versionLabel));
    const versionId = randomUUID();

    await tx.insert(documentsSchema.documentVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      projectId,
      documentId: document.id,
      versionLabel,
      // Nothing has been read from the file yet, and the column says exactly that rather than
      // naming a format whose text nobody has seen.
      textSource: "PENDING_EXTRACTION",
      sourceNote: input.sourceNote,
      // The *text* hash, which does not exist yet: the empty string's digest would be a value
      // that collides with every other unprocessed version, so the file hash stands in until
      // extraction writes the real one, and `file_sha256` beside it says which is which.
      contentHash: object.sha256,
      pageCount: 0,
      chunkCount: 0,
      chunkingStrategy: "pending",
      storageKey: object.objectKey,
      storedObjectId: object.id,
      fileSha256: object.sha256,
      originalFilename: object.originalFilename,
      mimeType: object.mimeType,
      sizeBytes: object.sizeBytes,
      processingState: "UPLOADED",
      privacyClassification: input.privacyClassification,
      sourceDate: input.sourceDate === null ? null : new Date(input.sourceDate),
      importedByUserId: ctx.userId,
      provenanceId: document.provenanceId,
    });

    // The current version moves only when there is something to move to. An uploaded version is
    // current in the sense that it is the newest delivery; what it is not yet is citable.
    await tx
      .update(documentsSchema.sourceDocument)
      .set({ currentVersionId: versionId })
      .where(eq(documentsSchema.sourceDocument.id, document.id));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "document.version.uploaded",
        objectKind: "document_version",
        objectId: versionId,
        details: {
          document: document.code,
          versionLabel,
          privacy: input.privacyClassification,
          sizeBytes: object.sizeBytes,
        },
      },
    );

    return {
      documentId: document.id,
      documentCode: document.code,
      versionId,
      versionLabel,
      outcome: "stored" as const,
    };
  });
}

type Tx = Parameters<Parameters<typeof withDbContext>[2]>[0];

/**
 * The document this version belongs to: an existing one, or a new one the operator meant to make.
 *
 * Creating one is deliberate rather than inferred. A corrected delivery of a document the product
 * already knows is version 2 of it; a genuinely new document is a decision the person makes by
 * giving it a code and a title (PART G1).
 */
async function resolveDocument(
  tx: Tx,
  ctx: RequestContext,
  projectId: string,
  input: z.infer<typeof uploadDocumentVersionInputSchema>,
): Promise<{ id: string; code: string; provenanceId: string }> {
  if (input.documentId !== null) {
    const [existing] = await tx
      .select({
        id: documentsSchema.sourceDocument.id,
        code: documentsSchema.sourceDocument.code,
      })
      .from(documentsSchema.sourceDocument)
      .where(
        and(
          eq(documentsSchema.sourceDocument.id, input.documentId),
          eq(documentsSchema.sourceDocument.projectId, projectId),
        ),
      );
    if (!existing) throw new NotFound("no such document in this project");
    const [anyVersion] = await tx
      .select({ provenanceId: documentsSchema.documentVersion.provenanceId })
      .from(documentsSchema.documentVersion)
      .where(eq(documentsSchema.documentVersion.documentId, existing.id))
      .limit(1);
    if (!anyVersion) {
      throw new InvalidInput("this document has no version to inherit provenance from");
    }
    return { ...existing, provenanceId: anyVersion.provenanceId };
  }

  if (input.code === null || input.title === null || input.kind === null) {
    throw new InvalidInput("a new document needs a code, a title and a kind");
  }

  /*
   * A code already in use is somebody adding a version to a document they did not realise exists,
   * and the honest answer is to say so. Creating a second `DOC-014` would be worse than refusing:
   * every citation naming that code would become ambiguous, and the unique index would refuse it
   * anyway — as a constraint violation nobody can act on rather than a sentence they can.
   */
  const [clash] = await tx
    .select({ id: documentsSchema.sourceDocument.id })
    .from(documentsSchema.sourceDocument)
    .where(
      and(
        eq(documentsSchema.sourceDocument.projectId, projectId),
        eq(documentsSchema.sourceDocument.code, input.code),
      ),
    );
  if (clash) {
    throw new InvalidInput(
      `this project already has a document ${input.code}; add a version to it instead`,
    );
  }

  const documentId = randomUUID();
  await tx.insert(documentsSchema.sourceDocument).values({
    id: documentId,
    tenantId: ctx.tenantId,
    projectId,
    code: input.code,
    title: input.title,
    kind: input.kind,
  });
  /*
   * A delivered file is an imported document observed as it arrived, so the transformation facet
   * is `ORIGINAL` — the opposite of the pilot's transcribed excerpts, whose facet says
   * `RECONSTRUCTED` precisely because nobody uploaded them. The method is left honest too: nothing
   * has been extracted yet, and naming a segmentation strategy here would describe work that has
   * not happened.
   */
  const provenanceId = randomUUID();
  await tx.execute(sql`
    insert into app.provenance_record
      (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
       method, validation_state, captured_at)
    values (${provenanceId}, ${ctx.tenantId}, ${projectId}, 'HISTORICAL_OBSERVED',
            'IMPORTED_DOCUMENT', ARRAY['ORIGINAL']::app.provenance_transformation[],
            'AGGREGATE', ${input.title}, ${input.sourceNote},
            NULL, 'PENDING', now())
  `);
  return { id: documentId, code: input.code, provenanceId };
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}
