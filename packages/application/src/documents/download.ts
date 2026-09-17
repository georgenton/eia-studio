import { documentsSchema, storageSchema, withDbContext, type Database } from "@eia/db";
import {
  NotFound,
  requireCapability,
  requirePermission,
  DOWNLOAD_LINK_TTL_SECONDS,
  type RequestContext,
  type StoragePort,
} from "@eia/domain";
import { and, eq } from "drizzle-orm";

import { recordAudit } from "../audit/record";

/**
 * Handing somebody the original file (ADR-034).
 *
 * ## Why this is a use-case and not `presignStoredObjectDownload` with a button on it
 *
 * The object-level function answers *may this caller fetch these bytes*. This one answers the
 * question a person actually asks — *give me the file behind DOC-014 v2* — and it does three
 * things the object-level one cannot:
 *
 * - it resolves the **version**, so the caller names a citation rather than a storage row;
 * - it refuses a version that has no file, which is every transcribed excerpt in the pilot corpus;
 * - it **audits the issuance**, which SECURITY.md §9 requires for a presigned URL over an object
 *   that may hold personal data. A delivered study is exactly that: its privacy classification is
 *   a claim somebody made, and `REVIEW_REQUIRED` means nobody has looked yet.
 *
 * ## What the link discloses, stated exactly
 *
 * A presigned S3 GET **contains the object key**: the path addresses the object and the query
 * string carries the signature. There is no way to sign a fetch of an object without naming it,
 * short of streaming the bytes through this application — which is the cost ADR-031 declined for
 * uploads and declines here for the same reason.
 *
 * What makes that acceptable is the key's own design. It is
 * `t/{tenantId}/p/{projectId}/documents/{objectId}` — a namespace and four UUIDs — so a link
 * pasted into a chat discloses *that a document exists* and nothing about whose it is: no
 * filename, no document code, no date, no person (ADR-031 §1). SECURITY.md §7's rule is that
 * **the UI never receives raw keys of other objects**, and the page holds a route, never a key.
 *
 * The link is a bearer credential for five minutes. That is why it is minted one at a time, after
 * the row has been read under the caller's own RLS, and why the issuance is audited.
 */
export interface DocumentDownloadLink {
  readonly url: string;
  readonly expiresAt: string;
  /** What the browser should save it as. Restored on the link, never part of the key. */
  readonly filename: string;
  readonly sizeBytes: number;
}

export async function issueDocumentDownload(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  versionId: string,
): Promise<DocumentDownloadLink> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "documents.read");
  const projectId = requireProject(ctx);

  const version = await withDbContext(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        versionId: documentsSchema.documentVersion.id,
        versionLabel: documentsSchema.documentVersion.versionLabel,
        documentCode: documentsSchema.sourceDocument.code,
        privacy: documentsSchema.documentVersion.privacyClassification,
        objectKey: storageSchema.storedObject.objectKey,
        originalFilename: storageSchema.storedObject.originalFilename,
        sizeBytes: storageSchema.storedObject.sizeBytes,
        namespace: storageSchema.storedObject.namespace,
      })
      .from(documentsSchema.documentVersion)
      .innerJoin(
        documentsSchema.sourceDocument,
        eq(documentsSchema.sourceDocument.id, documentsSchema.documentVersion.documentId),
      )
      .innerJoin(
        storageSchema.storedObject,
        eq(storageSchema.storedObject.id, documentsSchema.documentVersion.storedObjectId),
      )
      .where(
        and(
          eq(documentsSchema.documentVersion.id, versionId),
          eq(documentsSchema.documentVersion.projectId, projectId),
        ),
      );
    return rows[0] ?? null;
  });

  /*
   * 404, and the same 404 for three different situations: the version does not exist, it belongs
   * to another project, or it has no file. A caller editing identifiers must not be able to tell
   * "this version is elsewhere" from "this version has nothing to download" — the non-enumeration
   * rule the workspace routes already follow (ADR-016).
   */
  if (!version) throw new NotFound("document version");
  if (version.namespace !== "documents") throw new NotFound("document version");

  const link = await storage.presignDownload(
    version.objectKey,
    DOWNLOAD_LINK_TTL_SECONDS,
    version.originalFilename,
  );

  await withDbContext(db, ctx, async (tx) => {
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "document.version.download_issued",
        objectKind: "document_version",
        objectId: versionId,
        /*
         * The document, its version and what somebody had claimed about personal data in it —
         * which is the fact a reviewer of this log actually needs. Never the filename (it can name
         * a person), never the key, never the hash, never the link.
         */
        details: {
          document: version.documentCode,
          versionLabel: version.versionLabel,
          privacy: version.privacy,
        },
      },
    );
  });

  return {
    url: link.url,
    expiresAt: link.expiresAt.toISOString(),
    filename: version.originalFilename,
    sizeBytes: version.sizeBytes,
  };
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}
