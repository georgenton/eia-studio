import { createHash, randomUUID } from "node:crypto";

import {
  appSchema,
  portalSchema,
  storageSchema,
  withDbContext,
  type Database,
  type DbTx,
} from "@eia/db";
import {
  assertPublishableEditorial,
  can,
  EDITORIAL_SCHEMA_VERSION,
  InvalidInput,
  NotFound,
  requireCapability,
  requirePermission,
  type EditorialAsset,
  type EditorialPayload,
  type RequestContext,
} from "@eia/domain";
import { and, desc, eq, inArray } from "drizzle-orm";

import { recordAudit } from "../audit/record";

/**
 * Writing, previewing, publishing and withdrawing a project's public editorial page.
 *
 * ## The three acts, and why they are three permissions
 *
 * `portal.editorial.write` edits the draft. `portal.preview` reads it before anybody outside can.
 * `portal.publish` decides it goes out, and decides it comes back. The split is the one the
 * Quality Gate already makes between running a check and settling a finding, and it is the reason
 * saving is not publishing: a specialist can write the whole page and change nothing a visitor
 * sees.
 *
 * ## What publishing copies, and why it copies
 *
 * A publication is a **snapshot**. Editing the draft afterwards changes nothing that is public,
 * because the published row holds its own copy of the payload and its own list of authorised
 * attachments. That is not an optimisation: it is the difference between "the page as the firm
 * approved it" and "whatever the page happens to say right now".
 */

/* ---------------------------------------------------------------------------------------------
 * Reading and writing the draft
 * ------------------------------------------------------------------------------------------ */

export interface EditorialDraftView {
  readonly revision: number;
  readonly payload: EditorialPayload;
  readonly updatedAt: Date;
  /** The sequence a visitor currently sees, or `null` when nothing is public. */
  readonly publishedSequence: number | null;
  readonly publishedAt: Date | null;
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

/** An empty page, so a project that has never been edited opens rather than 404s. */
function blankPayload(locale: "es-EC" | "en", headline: string): EditorialPayload {
  return assertPublishableEditorial({
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    locale,
    headline,
    subheadline: null,
    executiveSummary: null,
    sections: [],
    team: [],
  });
}

export async function loadEditorialDraft(
  db: Database,
  ctx: RequestContext,
  fallbackHeadline: string,
): Promise<EditorialDraftView> {
  requireCapability(ctx, "client.portal");
  /*
   * Either permission opens the draft, and that is not a loosening. Reading back what you just
   * wrote is part of writing it; `portal.preview` is for somebody who will *not* write — a
   * reviewer looking before anyone outside can. Requiring preview alone would have given an
   * author a page they could save and never reopen.
   */
  if (!can(ctx, "portal.preview") && !can(ctx, "portal.editorial.write")) {
    requirePermission(ctx, "portal.preview");
  }
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const [draft] = await tx
      .select()
      .from(portalSchema.editorialDraft)
      .where(eq(portalSchema.editorialDraft.projectId, projectId));
    const current = await currentPublication(tx, projectId);
    return {
      revision: draft?.revision ?? 0,
      payload: draft
        ? assertPublishableEditorial(draft.payload)
        : blankPayload(ctx.locale === "en" ? "en" : "es-EC", fallbackHeadline),
      updatedAt: draft?.updatedAt ?? new Date(0),
      publishedSequence: current?.sequence ?? null,
      publishedAt: current?.publishedAt ?? null,
    };
  });
}

export class EditorialRevisionConflict extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `the page was saved by somebody else: you have revision ${expected}, it is now ${actual}`,
    );
    this.name = "EditorialRevisionConflict";
  }
}

/**
 * Save the draft. Never publishes, and says so by changing nothing a visitor can reach.
 *
 * `expectedRevision` is how two editors stop overwriting one another. The second save is refused
 * with both numbers rather than merged: a silent merge of two people's prose produces a paragraph
 * neither of them wrote.
 */
export async function saveEditorialDraft(
  db: Database,
  ctx: RequestContext,
  input: { expectedRevision: number; payload: unknown },
): Promise<{ revision: number }> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.editorial.write");
  const projectId = requireProject(ctx);
  // Parsed, sanitised and scanned before anything touches the database (ADR-027's shape).
  const payload = assertPublishableEditorial(input.payload);

  return withDbContext(db, ctx, async (tx) => {
    await assertAssetsBelongHere(tx, projectId, collectAssets(payload));

    const [existing] = await tx
      .select({ revision: portalSchema.editorialDraft.revision })
      .from(portalSchema.editorialDraft)
      .where(eq(portalSchema.editorialDraft.projectId, projectId));

    if (existing === undefined) {
      if (input.expectedRevision !== 0)
        throw new EditorialRevisionConflict(input.expectedRevision, 0);
      await tx.insert(portalSchema.editorialDraft).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        revision: 1,
        schemaVersion: EDITORIAL_SCHEMA_VERSION,
        payload,
        updatedBy: ctx.userId,
      });
      return { revision: 1 };
    }

    if (existing.revision !== input.expectedRevision) {
      throw new EditorialRevisionConflict(input.expectedRevision, existing.revision);
    }
    const next = existing.revision + 1;
    await tx
      .update(portalSchema.editorialDraft)
      .set({ revision: next, payload, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(portalSchema.editorialDraft.projectId, projectId));
    return { revision: next };
  });
}

/* ---------------------------------------------------------------------------------------------
 * Attachments
 * ------------------------------------------------------------------------------------------ */

function collectAssets(payload: EditorialPayload): ReadonlyArray<EditorialAsset> {
  const out: EditorialAsset[] = [];
  for (const section of payload.sections) out.push(...section.assets);
  for (const member of payload.team) if (member.photo !== null) out.push(member.photo);
  return out;
}

/**
 * Every referenced object exists, belongs to **this** project, and sits in an editorial namespace.
 *
 * The namespace check is the one that matters. `field-media` is a technician's photograph of
 * somebody's parcel; it is never editorial content, and the separation is enforced here by a
 * query rather than by a rule in a document (ADR-032's property, applied in the other direction).
 */
async function assertAssetsBelongHere(
  tx: DbTx,
  projectId: string,
  assets: ReadonlyArray<EditorialAsset>,
): Promise<void> {
  const ids = [...new Set(assets.map((a) => a.storedObjectId))];
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: storageSchema.storedObject.id, namespace: storageSchema.storedObject.namespace })
    .from(storageSchema.storedObject)
    .where(
      and(
        eq(storageSchema.storedObject.projectId, projectId),
        inArray(storageSchema.storedObject.id, ids),
      ),
    );
  const found = new Map(rows.map((r) => [r.id, r.namespace]));
  for (const id of ids) {
    const namespace = found.get(id);
    if (namespace === undefined) {
      // Also the answer for an object of another project: RLS filtered it out, so it is "missing".
      throw new InvalidInput("an attachment does not belong to this project");
    }
    if (namespace !== (EDITORIAL_NAMESPACE as string)) {
      throw new InvalidInput(
        `an attachment is in the ${namespace} namespace; only ${EDITORIAL_NAMESPACE} may be published`,
      );
    }
  }
}

/** Editorial media is its own namespace, apart from `documents` and from `field-media`. */
export const EDITORIAL_NAMESPACE = "portal-editorial" as const;

/* ---------------------------------------------------------------------------------------------
 * Publishing and withdrawing
 * ------------------------------------------------------------------------------------------ */

/**
 * The publication a visitor can see right now, or `null`.
 *
 * The same definition the policy uses (`portal.visible_editorial_publication`): one event stream
 * per project, and the latest event decides. Asking "is this version withdrawn?" instead would
 * make withdrawing v2 republish v1, which is not what taking a page down means.
 */
async function currentPublication(
  tx: DbTx,
  projectId: string,
): Promise<{ id: string; sequence: number; publishedAt: Date } | null> {
  const [event] = await tx
    .select({
      state: portalSchema.editorialVisibilityEvent.state,
      publicationId: portalSchema.editorialVisibilityEvent.publicationId,
    })
    .from(portalSchema.editorialVisibilityEvent)
    .where(eq(portalSchema.editorialVisibilityEvent.projectId, projectId))
    .orderBy(desc(portalSchema.editorialVisibilityEvent.occurredAt))
    .limit(1);
  if (event === undefined || event.state !== "PUBLISHED") return null;

  const [publication] = await tx
    .select({
      id: portalSchema.editorialPublication.id,
      sequence: portalSchema.editorialPublication.sequence,
      publishedAt: portalSchema.editorialPublication.publishedAt,
    })
    .from(portalSchema.editorialPublication)
    .where(eq(portalSchema.editorialPublication.id, event.publicationId));
  return publication ?? null;
}

export interface PublishedEditorial {
  readonly publicationId: string;
  readonly sequence: number;
  readonly assetCount: number;
}

/**
 * Make the current draft the page a visitor sees.
 *
 * The payload is re-validated here rather than trusted from the draft row: a draft written by an
 * older build, or by a path that skipped the use-case, must not become public on the strength of
 * having been stored once.
 */
export async function publishEditorial(
  db: Database,
  ctx: RequestContext,
  input: { expectedRevision: number },
): Promise<PublishedEditorial> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.publish");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const [draft] = await tx
      .select()
      .from(portalSchema.editorialDraft)
      .where(eq(portalSchema.editorialDraft.projectId, projectId));
    if (draft === undefined) throw new NotFound("there is no page to publish yet");
    if (draft.revision !== input.expectedRevision) {
      throw new EditorialRevisionConflict(input.expectedRevision, draft.revision);
    }

    const payload = assertPublishableEditorial(draft.payload);
    const assets = collectAssets(payload);
    await assertAssetsBelongHere(tx, projectId, assets);

    const [slugs] = await tx
      .select({ projectSlug: appSchema.project.slug, tenantSlug: appSchema.tenant.slug })
      .from(appSchema.project)
      .innerJoin(appSchema.tenant, eq(appSchema.tenant.id, appSchema.project.tenantId))
      .where(eq(appSchema.project.id, projectId));
    if (slugs === undefined) throw new NotFound("project");

    const [previous] = await tx
      .select({ sequence: portalSchema.editorialPublication.sequence })
      .from(portalSchema.editorialPublication)
      .where(eq(portalSchema.editorialPublication.projectId, projectId))
      .orderBy(desc(portalSchema.editorialPublication.sequence))
      .limit(1);
    const sequence = (previous?.sequence ?? 0) + 1;
    const publicationId = randomUUID();

    await tx.insert(portalSchema.editorialPublication).values({
      id: publicationId,
      tenantId: ctx.tenantId,
      projectId,
      tenantSlug: slugs.tenantSlug,
      projectSlug: slugs.projectSlug,
      sequence,
      publishedAt: new Date(),
      publishedBy: ctx.userId,
      schemaVersion: EDITORIAL_SCHEMA_VERSION,
      contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      payload,
    });

    // The authorisation list, written once beside the words it belongs to.
    const objects = new Map(
      (
        await tx
          .select({
            id: storageSchema.storedObject.id,
            objectKey: storageSchema.storedObject.objectKey,
            filename: storageSchema.storedObject.originalFilename,
            mimeType: storageSchema.storedObject.mimeType,
          })
          .from(storageSchema.storedObject)
          .where(
            inArray(storageSchema.storedObject.id, [
              ...new Set(assets.map((a) => a.storedObjectId)),
            ]),
          )
      ).map((row) => [row.id, row]),
    );

    let ordinal = 0;
    const seen = new Set<string>();
    for (const asset of assets) {
      if (seen.has(asset.storedObjectId)) continue;
      seen.add(asset.storedObjectId);
      const object = objects.get(asset.storedObjectId);
      if (object === undefined) throw new NotFound("an attachment has gone missing");
      await tx.insert(portalSchema.editorialPublicationAsset).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        publicationId,
        storedObjectId: asset.storedObjectId,
        role: asset.role,
        caption: asset.caption,
        altText: asset.altText,
        ordinal: ordinal++,
        objectKey: object.objectKey,
        originalFilename: object.filename,
        mimeType: object.mimeType,
      });
    }

    await tx.insert(portalSchema.editorialVisibilityEvent).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId,
      publicationId,
      state: "PUBLISHED",
      decidedBy: ctx.userId,
      reason: null,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "portal.editorial.published",
        objectKind: "editorial_publication",
        objectId: publicationId,
        // Counts and a sequence. Never the page's text.
        details: { sequence, sections: payload.sections.length, assets: seen.size },
      },
    );

    return { publicationId, sequence, assetCount: seen.size };
  });
}

/**
 * Take the page out of public view.
 *
 * Nothing is deleted and no version is lost: a `WITHDRAWN` event is appended, and the public
 * policy stops admitting the row from that moment. What this cannot do — and the surface says so
 * — is reach a copy somebody already downloaded.
 */
export async function withdrawEditorial(
  db: Database,
  ctx: RequestContext,
  input: { reason: string },
): Promise<{ publicationId: string; sequence: number }> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.publish");
  const projectId = requireProject(ctx);
  if (input.reason.trim().length < 8) {
    throw new InvalidInput("say why the page is being withdrawn");
  }

  return withDbContext(db, ctx, async (tx) => {
    const current = await currentPublication(tx, projectId);
    if (current === null) throw new NotFound("there is nothing public to withdraw");
    await tx.insert(portalSchema.editorialVisibilityEvent).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId,
      publicationId: current.id,
      state: "WITHDRAWN",
      decidedBy: ctx.userId,
      reason: input.reason.trim(),
    });
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "portal.editorial.withdrawn",
        objectKind: "editorial_publication",
        objectId: current.id,
        details: { sequence: current.sequence },
      },
    );
    return { publicationId: current.id, sequence: current.sequence };
  });
}

/* ---------------------------------------------------------------------------------------------
 * The public read
 * ------------------------------------------------------------------------------------------ */

export interface PublicEditorialAsset {
  readonly storedObjectId: string;
  readonly role: string;
  readonly caption: string | null;
  readonly altText: string | null;
}

export interface PublicEditorialPage {
  readonly sequence: number;
  readonly publishedAt: Date;
  readonly payload: EditorialPayload;
  readonly assets: ReadonlyArray<PublicEditorialAsset>;
}

/**
 * What a visitor with no session is served, and the only thing they are served.
 *
 * The transaction runs with `surface: "public"` and **no tenant, project or user**. Two policies
 * admit it — SELECT on the editorial publication and on its assets, and only while the row is
 * visible — and every other table in every schema still denies a transaction with no tenant. So
 * this function cannot reach a draft, another tenant's page, a survey answer or a parcel even if
 * it were written to try: there is no policy that would return the row.
 *
 * A slug pair that matches nothing, a withdrawn page and a page that never existed are the same
 * answer, `null`, for the usual reason: a distinguishable response is an oracle for what a firm
 * is working on.
 */
export async function loadPublicEditorialPage(
  db: Database,
  input: { tenantSlug: string; projectSlug: string },
): Promise<PublicEditorialPage | null> {
  return withDbContext(
    db,
    { userId: null, tenantId: null, projectId: null, surface: "public" },
    async (tx) => {
      const [publication] = await tx
        .select()
        .from(portalSchema.editorialPublication)
        .where(
          and(
            eq(portalSchema.editorialPublication.tenantSlug, input.tenantSlug),
            eq(portalSchema.editorialPublication.projectSlug, input.projectSlug),
          ),
        )
        .orderBy(desc(portalSchema.editorialPublication.sequence))
        .limit(1);
      if (publication === undefined) return null;

      const assets = await tx
        .select({
          storedObjectId: portalSchema.editorialPublicationAsset.storedObjectId,
          role: portalSchema.editorialPublicationAsset.role,
          caption: portalSchema.editorialPublicationAsset.caption,
          altText: portalSchema.editorialPublicationAsset.altText,
        })
        .from(portalSchema.editorialPublicationAsset)
        .where(eq(portalSchema.editorialPublicationAsset.publicationId, publication.id))
        .orderBy(portalSchema.editorialPublicationAsset.ordinal);

      return {
        sequence: publication.sequence,
        // Re-parsed on the way out as well. A row written by an older build does not get to put
        // a shape this version never validated in front of a visitor.
        payload: assertPublishableEditorial(publication.payload),
        publishedAt: publication.publishedAt,
        assets,
      };
    },
  );
}

/**
 * May a visitor fetch this file?
 *
 * Yes only when the object is named by the **currently visible** publication of that exact page.
 * Not "it is in the editorial namespace", not "somebody has the id": the authorisation is the row
 * written beside the words. Withdrawal removes the answer with the page, which is what makes
 * withdrawal mean something for attachments.
 *
 * Returns the storage key for the caller to presign briefly. The bucket itself stays closed.
 */
export async function resolvePublicEditorialAsset(
  db: Database,
  input: { tenantSlug: string; projectSlug: string; storedObjectId: string },
): Promise<{ objectKey: string; filename: string | null; mimeType: string | null } | null> {
  return withDbContext(
    db,
    { userId: null, tenantId: null, projectId: null, surface: "public" },
    async (tx) => {
      const [publication] = await tx
        .select({ id: portalSchema.editorialPublication.id })
        .from(portalSchema.editorialPublication)
        .where(
          and(
            eq(portalSchema.editorialPublication.tenantSlug, input.tenantSlug),
            eq(portalSchema.editorialPublication.projectSlug, input.projectSlug),
          ),
        )
        .orderBy(desc(portalSchema.editorialPublication.sequence))
        .limit(1);
      if (publication === undefined) return null;

      const [authorised] = await tx
        .select({
          objectKey: portalSchema.editorialPublicationAsset.objectKey,
          filename: portalSchema.editorialPublicationAsset.originalFilename,
          mimeType: portalSchema.editorialPublicationAsset.mimeType,
        })
        .from(portalSchema.editorialPublicationAsset)
        .where(
          and(
            eq(portalSchema.editorialPublicationAsset.publicationId, publication.id),
            eq(portalSchema.editorialPublicationAsset.storedObjectId, input.storedObjectId),
          ),
        );
      return authorised ?? null;
    },
  );
}
