import { appSchema, portalSchema, withDbContext, type Database } from "@eia/db";
import {
  clientPublicationPayloadSchema,
  NotFound,
  publicationVersionLabel,
  requireCapability,
  requirePermission,
  type ClientPublicationPayload,
  type RequestContext,
} from "@eia/domain";
import { and, desc, eq } from "drizzle-orm";

export interface PublicationHistoryEntry {
  readonly sequence: number;
  readonly versionLabel: string;
  readonly publishedAt: Date;
  readonly publishedByName: string;
  readonly contentHash: string;
  readonly figures: number;
}

export interface PortalManagementView {
  readonly history: ReadonlyArray<PublicationHistoryEntry>;
  readonly latest: PublicationHistoryEntry | null;
}

/**
 * What the consulting team sees on `Portal del cliente`: which updates have gone out, when, and
 * who decided. It is a history of decisions, not a client-facing activity feed — the client's page
 * shows one publication and its date, and never a log of the firm's actions.
 */
export async function loadPortalManagement(
  db: Database,
  ctx: RequestContext,
): Promise<PortalManagementView> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.preview");
  if (ctx.projectId === null) throw new Error("loadPortalManagement requires a project context");
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        sequence: portalSchema.clientPublication.sequence,
        publishedAt: portalSchema.clientPublication.publishedAt,
        contentHash: portalSchema.clientPublication.contentHash,
        payload: portalSchema.clientPublication.payload,
        publishedByName: appSchema.user.name,
      })
      .from(portalSchema.clientPublication)
      .leftJoin(appSchema.user, eq(appSchema.user.id, portalSchema.clientPublication.publishedBy))
      .where(
        and(
          eq(portalSchema.clientPublication.tenantId, ctx.tenantId),
          eq(portalSchema.clientPublication.projectId, projectId),
        ),
      )
      .orderBy(desc(portalSchema.clientPublication.sequence));

    const history = rows.map((row) => {
      const payload = clientPublicationPayloadSchema.parse(row.payload);
      return {
        sequence: row.sequence,
        versionLabel: publicationVersionLabel(row.sequence),
        publishedAt: row.publishedAt,
        publishedByName: row.publishedByName ?? "—",
        contentHash: row.contentHash,
        figures:
          payload.summary.facts.length +
          payload.participation.facts.length +
          (payload.managementPlan?.facts.length ?? 0),
      };
    });

    return { history, latest: history[0] ?? null };
  });
}

export interface PublishedClientView {
  readonly sequence: number;
  readonly versionLabel: string;
  readonly publishedAt: Date;
  readonly payload: ClientPublicationPayload;
  /** Sequences that exist, newest first, so an internal reviewer can open an earlier one. */
  readonly available: ReadonlyArray<{ readonly sequence: number; readonly publishedAt: Date }>;
}

/**
 * The client's page, read from the publication and from nothing else (ADR-027, phase invariant).
 *
 * Both statements below touch `portal.client_publication` and no other table. There is no join to
 * a parcel, an answer, a finding, a review, a document or a campaign — not filtered out, absent.
 * That is the defining property of this surface: it does not ask what the operational database
 * says now, it reads what the consultancy published.
 *
 * `requirePermission("portal.preview")` is here because the preview is still internal: there is no
 * external client session in this wave, so the only caller is somebody inside the firm. When
 * `ClientPortalGrant` and `PortalContext` arrive, this function keeps its shape and gains a second
 * caller with its own context type (TD-005).
 */
export async function loadPublishedClientView(
  db: Database,
  ctx: RequestContext,
  options: { readonly sequence?: number } = {},
): Promise<PublishedClientView | null> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.preview");
  if (ctx.projectId === null) throw new Error("loadPublishedClientView requires a project context");
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const scope = and(
      eq(portalSchema.clientPublication.tenantId, ctx.tenantId),
      eq(portalSchema.clientPublication.projectId, projectId),
    );

    const available = await tx
      .select({
        sequence: portalSchema.clientPublication.sequence,
        publishedAt: portalSchema.clientPublication.publishedAt,
      })
      .from(portalSchema.clientPublication)
      .where(scope)
      .orderBy(desc(portalSchema.clientPublication.sequence));
    if (available.length === 0) return null;

    const wanted = options.sequence ?? available[0]!.sequence;
    const rows = await tx
      .select({
        sequence: portalSchema.clientPublication.sequence,
        publishedAt: portalSchema.clientPublication.publishedAt,
        payload: portalSchema.clientPublication.payload,
      })
      .from(portalSchema.clientPublication)
      .where(and(scope, eq(portalSchema.clientPublication.sequence, wanted)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFound(`publicación v${wanted}`);

    return {
      sequence: row.sequence,
      versionLabel: publicationVersionLabel(row.sequence),
      publishedAt: row.publishedAt,
      payload: clientPublicationPayloadSchema.parse(row.payload),
      available,
    };
  });
}
