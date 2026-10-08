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
  EditorialContentRefused,
  findEditorialViolations,
  sanitiseEditorialText,
  buildObjectKey,
  InvalidInput,
  NotFound,
  requireCapability,
  requirePermission,
  type EditorialAsset,
  type EditorialPayload,
  type RequestContext,
  type StoragePort,
} from "@eia/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import { buildPublishableImage } from "./editorial-image";

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
 *
 * The comparison is **inside** the write, for the reason `updateEditorialTenantProfile` gives at
 * length: a `SELECT` that matches, followed by an unconditional `UPDATE`, is passed by both of
 * two concurrent transactions and the second still overwrites the first. This one's counter did
 * at least move, so two saves one after another were caught; two at the same moment were not.
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

    /** What the row says now, so a conflict can name the number the editor should have had. */
    const currentRevision = async (): Promise<number> => {
      const [row] = await tx
        .select({ revision: portalSchema.editorialDraft.revision })
        .from(portalSchema.editorialDraft)
        .where(eq(portalSchema.editorialDraft.projectId, projectId));
      return row?.revision ?? 0;
    };

    if (input.expectedRevision === 0) {
      const created = await tx
        .insert(portalSchema.editorialDraft)
        .values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          projectId,
          revision: 1,
          schemaVersion: EDITORIAL_SCHEMA_VERSION,
          payload,
          updatedBy: ctx.userId,
        })
        // One draft per project, by unique index; two first saves cannot both succeed.
        .onConflictDoNothing({
          target: [portalSchema.editorialDraft.tenantId, portalSchema.editorialDraft.projectId],
        })
        .returning({ revision: portalSchema.editorialDraft.revision });
      if (created[0] === undefined) {
        throw new EditorialRevisionConflict(input.expectedRevision, await currentRevision());
      }
      return { revision: created[0].revision };
    }

    const updated = await tx
      .update(portalSchema.editorialDraft)
      .set({
        revision: sql`${portalSchema.editorialDraft.revision} + 1`,
        payload,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(portalSchema.editorialDraft.projectId, projectId),
          eq(portalSchema.editorialDraft.revision, input.expectedRevision),
        ),
      )
      .returning({ revision: portalSchema.editorialDraft.revision });
    if (updated[0] === undefined) {
      throw new EditorialRevisionConflict(input.expectedRevision, await currentRevision());
    }
    return { revision: updated[0].revision };
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

  /*
   * A photograph must be a **derivative**, never the upload.
   *
   * This is where "the public page never serves the original" stops being a convention. The
   * uploaded file keeps whatever EXIF the camera wrote — where, when, with what — and the
   * derivative has none, because it was encoded from pixels. Checking the role against the
   * derivative table means a page cannot reference the original even by pasting its id.
   */
  const photoIds = [
    ...new Set(assets.filter((a) => a.role === "photo").map((a) => a.storedObjectId)),
  ];
  if (photoIds.length === 0) return;
  const derivatives = await tx
    .select({ id: portalSchema.editorialImageDerivative.derivativeObjectId })
    .from(portalSchema.editorialImageDerivative)
    .where(inArray(portalSchema.editorialImageDerivative.derivativeObjectId, photoIds));
  const known = new Set(derivatives.map((d) => d.id));
  for (const id of photoIds) {
    if (!known.has(id)) {
      throw new InvalidInput(
        "a photograph must be the published derivative, not the uploaded original",
      );
    }
  }
}

/** Editorial media is its own namespace, apart from `documents` and from `field-media`. */
export const EDITORIAL_NAMESPACE = "portal-editorial" as const;

/* ---------------------------------------------------------------------------------------------
 * A photograph the page may carry
 * ------------------------------------------------------------------------------------------ */

export interface EditorialPhoto {
  readonly storedObjectId: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
}

/**
 * Turn an uploaded photograph into one that may be published.
 *
 * The upload itself goes through the ordinary path — intent, PUT, finalize — so the original is
 * validated, hashed and stored exactly like every other file. This is the step after: decode,
 * apply orientation, bound the size, encode again, and store the result as its **own** object
 * with its own SHA-256. The original stays where it is and is never referenced by a publication.
 *
 * Idempotent by original. Asking twice returns the first derivative rather than making a second,
 * so a double submit costs nothing and the page keeps pointing at one file.
 */
export async function createEditorialPhoto(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  input: { originalStoredObjectId: string },
): Promise<EditorialPhoto> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.editorial.write");
  const projectId = requireProject(ctx);

  /*
   * Idempotent by original: asking twice returns the first derivative. A double submit from the
   * editor therefore costs nothing and the page keeps pointing at one file.
   */
  const existing = await withDbContext(db, ctx, (tx) =>
    tx
      .select({
        derivativeObjectId: portalSchema.editorialImageDerivative.derivativeObjectId,
        width: portalSchema.editorialImageDerivative.width,
        height: portalSchema.editorialImageDerivative.height,
        mimeType: storageSchema.storedObject.mimeType,
      })
      .from(portalSchema.editorialImageDerivative)
      .innerJoin(
        storageSchema.storedObject,
        eq(storageSchema.storedObject.id, portalSchema.editorialImageDerivative.derivativeObjectId),
      )
      .where(
        eq(portalSchema.editorialImageDerivative.originalObjectId, input.originalStoredObjectId),
      ),
  );
  const already = existing[0];
  if (already !== undefined) {
    return {
      storedObjectId: already.derivativeObjectId,
      width: already.width,
      height: already.height,
      mimeType: already.mimeType ?? "image/jpeg",
    };
  }

  const source = await withDbContext(db, ctx, async (tx) => {
    const [row] = await tx
      .select({
        objectKey: storageSchema.storedObject.objectKey,
        namespace: storageSchema.storedObject.namespace,
      })
      .from(storageSchema.storedObject)
      .where(
        and(
          eq(storageSchema.storedObject.id, input.originalStoredObjectId),
          eq(storageSchema.storedObject.projectId, projectId),
        ),
      );
    // Another project's object was filtered out by RLS, so "missing" is also the answer for it.
    if (row === undefined) throw new NotFound("the uploaded photograph");
    if (row.namespace !== (EDITORIAL_NAMESPACE as string)) {
      throw new InvalidInput("only an editorial upload becomes a published photograph");
    }
    return row;
  });

  const derivative = await buildPublishableImage(await storage.get(source.objectKey));
  const objectId = randomUUID();
  const objectKey = buildObjectKey({
    tenantId: ctx.tenantId,
    projectId,
    namespace: EDITORIAL_NAMESPACE,
    objectId,
  });
  await storage.put(objectKey, derivative.bytes, derivative.mimeType);

  return withDbContext(db, ctx, async (tx) => {
    await tx.insert(storageSchema.storedObject).values({
      id: objectId,
      tenantId: ctx.tenantId,
      projectId,
      namespace: EDITORIAL_NAMESPACE,
      objectKey,
      // A name a visitor may be offered. Never the uploaded filename, which can be a person's.
      originalFilename: `imagen-${derivative.width}x${derivative.height}.${derivative.format}`,
      mimeType: derivative.mimeType,
      sizeBytes: derivative.bytes.byteLength,
      sha256: derivative.sha256,
      uploadedByUserId: ctx.userId,
    });
    await tx.insert(portalSchema.editorialImageDerivative).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId,
      originalObjectId: input.originalStoredObjectId,
      derivativeObjectId: objectId,
      width: derivative.width,
      height: derivative.height,
      createdBy: ctx.userId,
    });
    return {
      storedObjectId: objectId,
      width: derivative.width,
      height: derivative.height,
      mimeType: derivative.mimeType,
    };
  });
}

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

/* ---------------------------------------------------------------------------------------------
 * The consultancy's public landing
 * ------------------------------------------------------------------------------------------ */

export interface PublicEditorialIndexEntry {
  readonly projectSlug: string;
  readonly headline: string;
  readonly subheadline: string | null;
  readonly publishedAt: Date;
}

export interface PublicEditorialIndex {
  readonly tenantName: string;
  readonly engagementLabel: string | null;
  readonly projects: ReadonlyArray<PublicEditorialIndexEntry>;
}

/**
 * What a visitor sees at `/p/:tenant`: the firm, and the roads it has published.
 *
 * ## Why this reads no project table
 *
 * The obvious implementation lists `app.project` and filters to the published ones. That is the
 * wrong shape twice over: it needs a public path into the operational tables, and a filter is a
 * thing that can be forgotten — the day somebody adds a condition in the wrong place, every
 * private project's slug is on the internet.
 *
 * So the query runs over `portal.editorial_publication` alone, under the same public policy as a
 * single page: a row is here **because it is visible**, and a project with no publication, a
 * withdrawn one, an archived one and a private one are all simply absent. There is no list to
 * filter and nothing to forget.
 *
 * ## Where the firm's name comes from
 *
 * The publication itself. Not a constant, not a build-time setting and not the tenant table:
 * every published page carries the headline its author wrote and the tenant slug it belongs to,
 * so "Visión Ambiental" lives in a tenant's own rows rather than anywhere in this codebase. The
 * engagement title is the editorial profile's, when a firm has set one.
 */
export async function loadPublicEditorialIndex(
  db: Database,
  input: { tenantSlug: string },
): Promise<PublicEditorialIndex | null> {
  return withDbContext(
    db,
    { userId: null, tenantId: null, projectId: null, surface: "public" },
    async (tx) => {
      const rows = await tx
        .select({
          projectSlug: portalSchema.editorialPublication.projectSlug,
          payload: portalSchema.editorialPublication.payload,
          publishedAt: portalSchema.editorialPublication.publishedAt,
        })
        .from(portalSchema.editorialPublication)
        .where(eq(portalSchema.editorialPublication.tenantSlug, input.tenantSlug))
        .orderBy(portalSchema.editorialPublication.projectSlug);
      // Every row here is already a visible one; the policy saw to that.
      if (rows.length === 0) return null;

      const projects = rows.map((row) => {
        const payload = assertPublishableEditorial(row.payload);
        return {
          projectSlug: row.projectSlug,
          headline: payload.headline,
          subheadline: payload.subheadline,
          publishedAt: row.publishedAt,
        };
      });

      const [profile] = await tx
        .select({
          name: portalSchema.editorialTenantProfile.name,
          engagementLabel: portalSchema.editorialTenantProfile.engagementLabel,
        })
        .from(portalSchema.editorialTenantProfile)
        .where(eq(portalSchema.editorialTenantProfile.tenantSlug, input.tenantSlug));

      return {
        // With no profile set, the firm is named by its own slug rather than by a guess.
        tenantName: profile?.name ?? input.tenantSlug,
        engagementLabel: profile?.engagementLabel ?? null,
        projects,
      };
    },
  );
}

/* ---------------------------------------------------------------------------------------------
 * How a firm names itself
 * ------------------------------------------------------------------------------------------ */

export interface EditorialTenantProfileView {
  readonly name: string;
  readonly engagementLabel: string | null;
  readonly updatedAt: Date | null;
  /** `0` when no profile has been set; the landing then falls back to the slug. */
  readonly revision: number;
}

/**
 * Read the public profile. `portal.preview` is enough: it is what the landing already shows to
 * anyone with the link, so an internal reader seeing it reveals nothing.
 */
export async function loadEditorialTenantProfile(
  db: Database,
  ctx: RequestContext,
): Promise<EditorialTenantProfileView> {
  requireCapability(ctx, "client.portal");
  if (!can(ctx, "portal.preview") && !can(ctx, "portal.profile.manage")) {
    requirePermission(ctx, "portal.preview");
  }
  return withDbContext(db, { ...ctx, projectId: null }, async (tx) => {
    const [row] = await tx
      .select()
      .from(portalSchema.editorialTenantProfile)
      .where(eq(portalSchema.editorialTenantProfile.tenantId, ctx.tenantId));
    return {
      name: row?.name ?? "",
      engagementLabel: row?.engagementLabel ?? null,
      updatedAt: row?.updatedAt ?? null,
      // `0` is this model's word for *there is no profile*; a stored revision counts from 1.
      revision: row?.revision ?? 0,
    };
  });
}

/**
 * Set it. **Tenant-scoped authorization**, deliberately.
 *
 * The landing's name is one row shared by every project, so a project-scoped permission here
 * would let whoever edits one road rename the whole consultancy. `portal.profile.manage` is a
 * tenant key held by OWNER and ADMIN, and the check is this line rather than a hidden button.
 *
 * ## How a second administrator is noticed
 *
 * `expectedRevision` is `0` for "I believe there is no profile yet" and otherwise the revision
 * the caller read. The check and the write are **one statement** in both branches, because a
 * `SELECT` followed by an unconditional `UPDATE` is not optimistic concurrency at all: two
 * transactions can both pass the read and the second still overwrites the first. That is exactly
 * what this function used to do, with a revision that was `0` or `1` and never moved — so every
 * save after the first one matched, and a lost update was silent (migration 0054).
 *
 * Creating is `INSERT … ON CONFLICT (tenant_id) DO NOTHING RETURNING`, so of two first saves one
 * writes and the other gets no row back and is told it conflicted — rather than a raw unique
 * violation, which is a database error and not an answer a person can act on.
 *
 * Updating is `UPDATE … WHERE tenant_id = ? AND revision = ? RETURNING`, so the loser of a race
 * updates nothing. Only then is the current revision read, and only to say what it is.
 */
export async function updateEditorialTenantProfile(
  db: Database,
  ctx: RequestContext,
  input: { name: string; engagementLabel: string | null; expectedRevision: number },
): Promise<{ revision: number }> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.profile.manage");

  const name = sanitiseEditorialText(input.name).trim();
  const label =
    input.engagementLabel === null ? null : sanitiseEditorialText(input.engagementLabel).trim();
  if (name.length === 0) throw new InvalidInput("the consultancy needs a public name");
  if (name.length > 160) throw new InvalidInput("the public name is too long");
  if (label !== null && label.length > 200)
    throw new InvalidInput("the engagement title is too long");
  // The same content rule the pages follow: a landing is as public as a page.
  const violations = findEditorialViolations({
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    locale: "es-EC",
    headline: name,
    subheadline: label,
    executiveSummary: null,
    sections: [],
    team: [],
  });
  if (violations.length > 0) throw new EditorialContentRefused(violations);

  return withDbContext(db, { ...ctx, projectId: null }, async (tx) => {
    const [slug] = await tx
      .select({ slug: appSchema.tenant.slug })
      .from(appSchema.tenant)
      .where(eq(appSchema.tenant.id, ctx.tenantId));
    if (slug === undefined) throw new NotFound("tenant");

    /** What the row says now, for a conflict that names the number the caller should have had. */
    const currentRevision = async (): Promise<number> => {
      const [row] = await tx
        .select({ revision: portalSchema.editorialTenantProfile.revision })
        .from(portalSchema.editorialTenantProfile)
        .where(eq(portalSchema.editorialTenantProfile.tenantId, ctx.tenantId));
      return row?.revision ?? 0;
    };

    let revision: number;
    if (input.expectedRevision === 0) {
      const created = await tx
        .insert(portalSchema.editorialTenantProfile)
        .values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          tenantSlug: slug.slug,
          name,
          engagementLabel: label,
          updatedBy: ctx.userId,
        })
        // The UNIQUE on `tenant_id` is what makes this a conflict rather than a second row.
        .onConflictDoNothing({ target: portalSchema.editorialTenantProfile.tenantId })
        .returning({ revision: portalSchema.editorialTenantProfile.revision });
      if (created[0] === undefined) {
        throw new EditorialRevisionConflict(input.expectedRevision, await currentRevision());
      }
      revision = created[0].revision;
    } else {
      const updated = await tx
        .update(portalSchema.editorialTenantProfile)
        .set({
          name,
          engagementLabel: label,
          updatedAt: new Date(),
          updatedBy: ctx.userId,
          // Incremented in the statement that checks it: there is no window between the two.
          revision: sql`${portalSchema.editorialTenantProfile.revision} + 1`,
        })
        .where(
          and(
            eq(portalSchema.editorialTenantProfile.tenantId, ctx.tenantId),
            eq(portalSchema.editorialTenantProfile.revision, input.expectedRevision),
          ),
        )
        .returning({ revision: portalSchema.editorialTenantProfile.revision });
      if (updated[0] === undefined) {
        throw new EditorialRevisionConflict(input.expectedRevision, await currentRevision());
      }
      revision = updated[0].revision;
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId: null },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "portal.editorial.profile_set",
        objectKind: "editorial_tenant_profile",
        objectId: ctx.tenantId,
        // Lengths, not the words. An audit line is read by more people than the landing.
        details: { nameLength: name.length, hasEngagementLabel: label !== null, revision },
      },
    );
    return { revision };
  });
}
