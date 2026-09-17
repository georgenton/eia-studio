import { createHash, randomUUID } from "node:crypto";

import { storageSchema, withDbContext, type Database } from "@eia/db";
import {
  assertBytesMatchFormat,
  assertDeclaredUploadAllowed,
  assertObjectKeyBelongsTo,
  buildObjectKey,
  DOCUMENT_FORMATS,
  FIELD_MEDIA_FORMATS,
  formatForMimeType,
  InvalidInput,
  PermissionDenied,
  requirePermission,
  DOWNLOAD_LINK_TTL_SECONDS,
  UPLOAD_INTENT_TTL_SECONDS,
  type ProjectPermission,
  type RequestContext,
  type StorageNamespace,
  type StoragePort,
  type UploadIntent,
  type UploadFormat,
} from "@eia/domain";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";

/**
 * Asking to upload, and proving that you did.
 *
 * ## Two steps, because the bytes do not come through here
 *
 * A 90 MB environmental study should not be streamed through a serverless request to be streamed
 * out again. The client asks for an **intent**, uploads directly to the provider, then asks the
 * server to **finalize**. Everything that decides whether the upload is allowed happens in step
 * one; everything that decides whether it *worked* happens in step three, against the provider
 * rather than against the client's word.
 *
 * ## What the client never chooses
 *
 * The key. It is built here from the tenant, the project, the namespace and a UUID this product
 * mints — a client that could name a key could name another tenant's, and no amount of checking
 * afterwards recovers from having asked.
 *
 * ## What "finalized" means
 *
 * The provider has the object; its size is within the ceiling the intent signed for; its first
 * bytes are the format the declared type claims; and this product has read it and computed a
 * SHA-256 from the bytes it read. Not: the client said 200.
 */
const NAMESPACE_RULES: Readonly<
  Record<StorageNamespace, { formats: ReadonlyArray<UploadFormat>; permission: ProjectPermission }>
> = {
  documents: { formats: DOCUMENT_FORMATS, permission: "documents.write" },
  // A photograph is captured by whoever captures the work it belongs to.
  "field-media": { formats: FIELD_MEDIA_FORMATS, permission: "media.upload" },
};

export const uploadIntentInputSchema = z
  .object({
    namespace: z.enum(["documents", "field-media"]),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(3).max(200),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export interface IssuedUploadIntent extends UploadIntent {
  readonly intentId: string;
}

export async function createUploadIntent(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  rawInput: unknown,
): Promise<IssuedUploadIntent> {
  const parsed = uploadIntentInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  const projectId = requireProject(ctx);
  const rules = NAMESPACE_RULES[input.namespace];
  requirePermission(ctx, rules.permission);

  // Refused before a URL exists, so an unacceptable upload never gets one.
  const descriptor = assertDeclaredUploadAllowed({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    allowed: rules.formats,
  });

  const objectId = randomUUID();
  const objectKey = buildObjectKey({
    tenantId: ctx.tenantId,
    projectId,
    namespace: input.namespace,
    objectId,
  });
  const intent = await storage.presignUpload({
    key: objectKey,
    contentType: descriptor.mimeTypes[0]!,
    maxBytes: descriptor.maxBytes,
    ttlSeconds: UPLOAD_INTENT_TTL_SECONDS,
  });

  const intentId = randomUUID();
  await withDbContext(db, ctx, async (tx) => {
    await tx.insert(storageSchema.uploadIntent).values({
      id: intentId,
      tenantId: ctx.tenantId,
      projectId,
      namespace: input.namespace,
      objectKey,
      declaredFilename: input.filename,
      declaredMimeType: descriptor.mimeTypes[0]!,
      declaredSizeBytes: input.sizeBytes,
      maxBytes: descriptor.maxBytes,
      issuedByUserId: ctx.userId,
      expiresAt: intent.expiresAt,
    });
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "storage.upload.intent_issued",
        objectKind: "upload_intent",
        objectId: intentId,
        // The namespace and the size, never the filename: an audit line is read by more people
        // than the row is, and a filename can name a person.
        details: { namespace: input.namespace, sizeBytes: input.sizeBytes },
      },
    );
  });

  return { ...intent, intentId };
}

export interface FinalizedUpload {
  readonly storedObjectId: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly mimeType: string;
  readonly originalFilename: string;
  /** True when this exact content is already stored on this project (ADR-031 §6). */
  readonly duplicateOfObjectId: string | null;
}

export const finalizeUploadInputSchema = z
  .object({ intentId: z.uuid(), objectKey: z.string().min(1).max(400) })
  .strict();

/**
 * Prove the upload happened, and record what is actually there.
 *
 * Four checks, in this order, because each one makes the next meaningful: the intent is ours and
 * unconsumed; the key is the one we issued, for this tenant and project; the provider has an
 * object of an allowed size; and the bytes begin the way the declared format does. Only then is a
 * row written — and the hash on it is computed here, from the bytes, not taken from an `ETag`.
 */
export async function finalizeUpload(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  rawInput: unknown,
): Promise<FinalizedUpload> {
  const parsed = finalizeUploadInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput("invalid finalize input");
  const input = parsed.data;
  const projectId = requireProject(ctx);

  const intent = await withDbContext(db, ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(storageSchema.uploadIntent)
      .where(
        and(
          eq(storageSchema.uploadIntent.id, input.intentId),
          eq(storageSchema.uploadIntent.projectId, projectId),
        ),
      );
    return row ?? null;
  });
  if (!intent) throw new InvalidInput("this upload was not authorised here");
  requirePermission(ctx, NAMESPACE_RULES[intent.namespace as StorageNamespace].permission);
  if (intent.state !== "ISSUED") {
    throw new InvalidInput("this upload was already finalized or abandoned");
  }
  if (intent.expiresAt.getTime() < Date.now()) {
    throw new InvalidInput("this upload permission has expired; ask for a new one");
  }
  if (intent.objectKey !== input.objectKey) {
    throw new InvalidInput("this is not the object that was authorised");
  }
  // Belt as well as braces: the key we stored is re-parsed against the caller's own scope, so a
  // row written by an older version with a wider key could not be finalized into this project.
  assertObjectKeyBelongsTo(intent.objectKey, {
    tenantId: ctx.tenantId,
    projectId,
    namespace: intent.namespace,
  });

  const head = await storage.head(intent.objectKey);
  if (!head) throw new InvalidInput("nothing was uploaded under this authorisation");
  if (head.sizeBytes <= 0) throw new InvalidInput("the uploaded object is empty");
  if (head.sizeBytes > intent.maxBytes) {
    throw new InvalidInput("the uploaded object is larger than this format allows");
  }

  const format = formatForMimeType(intent.declaredMimeType);
  if (format === null) throw new InvalidInput("the declared type is no longer one we accept");
  const bytes = await storage.get(intent.objectKey);
  // The check a renamed `.exe` fails. It reads the stored bytes, not the type the client declared.
  assertBytesMatchFormat(bytes.subarray(0, 16), format);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storedObjectId = randomUUID();

  const duplicateOfObjectId = await withDbContext(db, ctx, async (tx) => {
    // Per project and per namespace. Never across tenants: whether another firm holds the same
    // file is not a fact this product may reveal (ADR-031 §6).
    const [existing] = await tx
      .select({ id: storageSchema.storedObject.id })
      .from(storageSchema.storedObject)
      .where(
        and(
          eq(storageSchema.storedObject.projectId, projectId),
          eq(storageSchema.storedObject.namespace, intent.namespace),
          eq(storageSchema.storedObject.sha256, sha256),
        ),
      );

    await tx.insert(storageSchema.storedObject).values({
      id: storedObjectId,
      tenantId: ctx.tenantId,
      projectId,
      namespace: intent.namespace,
      objectKey: intent.objectKey,
      originalFilename: intent.declaredFilename,
      mimeType: intent.declaredMimeType,
      sizeBytes: head.sizeBytes,
      sha256,
      uploadedByUserId: ctx.userId,
    });
    await tx
      .update(storageSchema.uploadIntent)
      .set({ state: "FINALIZED", finalizedAt: new Date() })
      .where(eq(storageSchema.uploadIntent.id, intent.id));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "storage.upload.finalized",
        objectKind: "stored_object",
        objectId: storedObjectId,
        details: {
          namespace: intent.namespace,
          sizeBytes: head.sizeBytes,
          duplicate: existing !== undefined,
        },
      },
    );
    return existing?.id ?? null;
  });

  return {
    storedObjectId,
    objectKey: intent.objectKey,
    sizeBytes: head.sizeBytes,
    sha256,
    mimeType: intent.declaredMimeType,
    originalFilename: intent.declaredFilename,
    duplicateOfObjectId,
  };
}

/**
 * A short-lived link to read an object back.
 *
 * Minted only after the row has been read under the caller's own context, so RLS has already
 * decided they may see it. The link itself carries no authorization of ours — it is the provider's
 * signature — which is why its life is measured in minutes (SECURITY.md §12).
 */
export async function presignStoredObjectDownload(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  storedObjectId: string,
): Promise<{ url: string; expiresAt: Date; filename: string }> {
  const projectId = requireProject(ctx);
  const object = await withDbContext(db, ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(storageSchema.storedObject)
      .where(
        and(
          eq(storageSchema.storedObject.id, storedObjectId),
          eq(storageSchema.storedObject.projectId, projectId),
        ),
      );
    return row ?? null;
  });
  if (!object) throw new InvalidInput("no such object in this project");
  // Reading is not writing: a document is read with `documents.read`, and a field photograph with
  // the same grant that put it there — nobody else has a reason to fetch one (ADR-031 §7).
  requirePermission(ctx, object.namespace === "documents" ? "documents.read" : "media.upload");

  const link = await storage.presignDownload(
    object.objectKey,
    DOWNLOAD_LINK_TTL_SECONDS,
    object.originalFilename,
  );
  return { ...link, filename: object.originalFilename };
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) {
    throw new PermissionDenied({ role: ctx.tenantRole, restrictedData: "project" });
  }
  return ctx.projectId;
}
