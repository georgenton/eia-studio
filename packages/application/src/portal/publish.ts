import { createHash, randomUUID } from "node:crypto";

import { portalSchema, withDbContext, type Database } from "@eia/db";
import {
  assertPublishablePayload,
  CLIENT_PUBLICATION_SCHEMA_VERSION,
  InvalidInput,
  publicationCanonicalForm,
  publicationVersionLabel,
  requireCapability,
  requirePermission,
  type RequestContext,
} from "@eia/domain";
import { and, desc, eq } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import { buildClientPublicationDraft } from "./build";

export interface PublishResult {
  readonly sequence: number;
  readonly versionLabel: string;
  readonly publishedAt: Date;
  /** True when the new version says exactly what the previous one said. */
  readonly unchangedFromPrevious: boolean;
}

/**
 * Publish an update.
 *
 * **The draft is rebuilt here.** The browser previewed a payload and the browser is not asked for
 * it back: a client that could hand this function a payload could publish anything it liked in the
 * consultancy's name. What is published is what the builder produces at this instant, checked
 * again by `assertPublishablePayload` on the way in.
 *
 * **A publication is a new row, always.** v1 is never edited into v2 — the database refuses it by
 * grant and by trigger — because "what did we tell the client in September" must stay answerable.
 * Publishing an unchanged draft is allowed and reported as such: re-stating the same thing on a
 * new date is a legitimate act, and pretending it failed would be confusing.
 */
export async function publishClientPublication(
  db: Database,
  ctx: RequestContext,
): Promise<PublishResult> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.publish");
  if (ctx.projectId === null) {
    throw new Error("publishClientPublication requires a project context");
  }
  const projectId = ctx.projectId;

  const draft = await buildClientPublicationDraft(db, ctx);
  const payload = assertPublishablePayload(draft.payload);
  // A real hash of the canonical form, not the canonical form itself: the payload carries the
  // corridor and four generalised outlines, and storing a second copy of it under the name
  // `content_hash` would be both misleading and tens of kilobytes per version.
  const contentHash = createHash("sha256").update(publicationCanonicalForm(payload)).digest("hex");

  const factCount =
    payload.summary.facts.length +
    payload.participation.facts.length +
    (payload.managementPlan?.facts.length ?? 0);
  if (factCount === 0) {
    throw new InvalidInput(
      "publication_has_nothing_to_say: no publishable figure was found for this project. A " +
        "publication with no verified aggregate is not an update, it is an empty page.",
    );
  }

  return withDbContext(db, ctx, async (tx) => {
    const previous = await tx
      .select({
        sequence: portalSchema.clientPublication.sequence,
        contentHash: portalSchema.clientPublication.contentHash,
      })
      .from(portalSchema.clientPublication)
      .where(
        and(
          eq(portalSchema.clientPublication.tenantId, ctx.tenantId),
          eq(portalSchema.clientPublication.projectId, projectId),
        ),
      )
      .orderBy(desc(portalSchema.clientPublication.sequence))
      .limit(1);

    const sequence = (previous[0]?.sequence ?? 0) + 1;
    const publishedAt = new Date();

    await tx.insert(portalSchema.clientPublication).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId,
      sequence,
      publishedAt,
      publishedBy: ctx.userId,
      schemaVersion: CLIENT_PUBLICATION_SCHEMA_VERSION,
      contentHash,
      payload,
      sourceProvenanceIds: draft.sourceProvenanceIds,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "portal.publication.published",
        objectKind: "client_publication",
        objectId: null,
        details: {
          sequence,
          figures: factCount,
          unchangedFromPrevious: previous[0]?.contentHash === contentHash,
        },
      },
    );

    return {
      sequence,
      versionLabel: publicationVersionLabel(sequence),
      publishedAt,
      unchangedFromPrevious: previous[0]?.contentHash === contentHash,
    };
  });
}
