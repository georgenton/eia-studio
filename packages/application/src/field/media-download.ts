import { withDbContext, type Database } from "@eia/db";
import {
  NotFound,
  requireCapability,
  DOWNLOAD_LINK_TTL_SECONDS,
  type RequestContext,
  type StoragePort,
} from "@eia/domain";
import { sql } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "./context";

/**
 * Opening a photograph of a visit (ADR-032, ADR-034).
 *
 * ## Why this did not exist until now, and why that was a defect
 *
 * The parcel workspace listed a photograph's kind, its capture time, whether it carried a point
 * and its size — and offered no way to see it. The note under the table said *«Descargar una es
 * una acción deliberada y queda registrada»*, describing a control the product did not have. A
 * coordinator could therefore read that a technician had photographed a parcel and never look at
 * it, which makes the evidence unusable for the one purpose it was captured for.
 *
 * ## The door, which is the row-level policy rather than a permission check
 *
 * A photograph of a parcel can hold a house, a vehicle, a face. It is the same datum a household's
 * answers are, so it goes through the same door (SECURITY.md §10b, TENANCY.md §3.1): a GIS
 * specialist who may see *that a parcel was visited* may not see what was photographed there, and
 * a technician reaches their own through the row-level policy's first branch rather than through
 * this permission.
 *
 * That is why the lookup runs inside `withFieldContext`: the policy on `field_media` is
 * `survey_instance`'s — *this row is mine, or I hold `field.responses.read`* — and it is applied
 * by the transaction rather than by this function.
 *
 * ## What the link discloses, stated exactly
 *
 * A presigned GET contains the object key, because a signature over an object must name it. The
 * key is `t/{tenantId}/p/{projectId}/field-media/{objectId}` — a namespace and four UUIDs
 * (ADR-031 §1) — so a link pasted somewhere discloses that a photograph exists and nothing about
 * whose parcel it is: no filename, no parcel code, no technician, no coordinate. It is a bearer
 * credential for five minutes, which is why it is minted one at a time, after the row has been
 * read under the caller's own RLS, and why the issuance is audited.
 *
 * ## What this is not
 *
 * It is not a publication. Field media still never reaches the client portal, a model provider,
 * the document corpus or the map (ADR-032 §3): this hands one file to one authorized reader, once,
 * and writes down that it did.
 */
export interface FieldMediaDownloadLink {
  readonly url: string;
  readonly expiresAt: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

interface Row {
  id: string;
  visit_id: string;
  kind: string;
  object_key: string;
  original_filename: string;
  /** `bigint` over the wire, so the driver hands it back as a string. */
  size_bytes: string | number;
  mime_type: string;
  namespace: string;
}

export async function issueFieldMediaDownload(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  mediaId: string,
): Promise<FieldMediaDownloadLink> {
  requireCapability(ctx, "field.surveys");
  /*
   * No `requirePermission` here, and that is deliberate — the same decision `loadVisitMedia`
   * makes. The row-level policy on `field_media` already decides, and it decides correctly for
   * both readers: a technician reaches their own photographs through its first branch, and a
   * coordinator reaches the project's through `field.responses.read`. A permission check at this
   * layer would lock a technician out of the photograph they took ten minutes ago.
   *
   * The consequence is that every refusal arrives as a not-found rather than as a denial, which is
   * the answer this product gives when telling somebody *why* would confirm the row exists
   * (ADR-016).
   */
  const projectId = requireProject(ctx);

  const media = await withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select m.id, m.visit_id, m.kind::text as kind,
             o.object_key, o.original_filename, o.size_bytes, o.mime_type, o.namespace::text
        from app.field_media m
        join app.stored_object o on o.tenant_id = m.tenant_id and o.id = m.stored_object_id
       where m.tenant_id = ${ctx.tenantId} and m.project_id = ${projectId}
         and m.id = ${mediaId}
       limit 1
    `);
    return (rows.rows[0] as unknown as Row | undefined) ?? null;
  });

  /*
   * One 404 for every reason: the photograph does not exist, it belongs to another project, the
   * row-level policy excluded it, or the object is not in the field-media namespace. A caller
   * editing identifiers must not be able to tell those apart (ADR-016).
   */
  if (!media) throw new NotFound("field media");
  if (media.namespace !== "field-media") throw new NotFound("field media");

  const link = await storage.presignDownload(
    media.object_key,
    DOWNLOAD_LINK_TTL_SECONDS,
    media.original_filename,
  );

  await withDbContext(db, ctx, async (tx) => {
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.media.download_issued",
        objectKind: "field_media",
        objectId: media.id,
        /*
         * The visit and what the photograph is of. Never the filename, never the key, never the
         * link, never the technician's note and never the coordinate — the same list ADR-032 §10e.1
         * keeps out of `field.media.declared`.
         */
        details: { visitId: media.visit_id, kind: media.kind },
      },
    );
  });

  return {
    url: link.url,
    expiresAt: link.expiresAt.toISOString(),
    filename: media.original_filename,
    sizeBytes: Number(media.size_bytes),
    mimeType: media.mime_type,
  };
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}
