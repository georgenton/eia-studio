import { randomUUID } from "node:crypto";

import { appSchema, fieldSchema, storageSchema, type Database } from "@eia/db";
import {
  assertVisitMediaWithinLimit,
  InvalidInput,
  NotFound,
  parseFieldMediaDeclaration,
  PermissionDenied,
  requireCapability,
  requirePermission,
  type FieldMediaKind,
  type RequestContext,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "./context";

/**
 * A photograph becomes evidence of a visit (ADR-032).
 *
 * ## What this use-case is, and what it deliberately is not
 *
 * It is the **declaration**: these already-verified bytes are a photograph of this kind, taken at
 * this moment, belonging to this visit. The bytes reached the provider through the ordinary upload
 * path (`createUploadIntent` → PUT → `finalizeUpload`, ADR-031), which is what checked the format,
 * the size and the magic bytes and computed the hash. Nothing here reads an image.
 *
 * It is **not** an upload endpoint, and the split is what makes a retry safe: by the time this
 * runs, the expensive, failure-prone half is already done and recorded as a `stored_object`.
 *
 * ## The no-duplicate guarantee, twice
 *
 * `localId` is minted on the device when the shutter closes and never regenerated. This use-case
 * looks it up first and replays rather than inserting, and a unique index on
 * `(tenant_id, visit_id, local_id)` says the same thing in the database. Two layers, because the
 * failures differ: the lookup handles the ordinary retry, and the index handles the race between
 * two pushes that a single-row lookup cannot see.
 *
 * The sync receipt would also catch a retried `media.declare`. This does not rely on it: a device
 * that lost its outbox but kept its gallery still cannot produce a second row.
 */
export interface DeclaredFieldMedia {
  readonly mediaId: string;
  readonly visitId: string;
  /** `stored` — a new row. `already_declared` — this photograph was already here. */
  readonly outcome: "stored" | "already_declared";
}

export async function declareFieldMedia(
  db: Database,
  ctx: RequestContext,
  raw: unknown,
): Promise<DeclaredFieldMedia> {
  requireCapability(ctx, "field.surveys");
  // The grant a technician holds. Not `field.write`: filing evidence of a visit is capture work,
  // and a coordinator who never went to the parcel has nothing to declare about it.
  requirePermission(ctx, "media.upload");
  const projectId = requireProject(ctx);
  const input = parseFieldMediaDeclaration(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const visit = await resolveOwnVisit(tx, ctx, projectId, input.visitId, input.assignmentId);

    const [existing] = await tx
      .select({ id: fieldSchema.fieldMedia.id })
      .from(fieldSchema.fieldMedia)
      .where(
        and(
          eq(fieldSchema.fieldMedia.visitId, visit.id),
          eq(fieldSchema.fieldMedia.localId, input.localId),
        ),
      );
    if (existing) {
      return { mediaId: existing.id, visitId: visit.id, outcome: "already_declared" as const };
    }

    // The object must be this project's, and it must be a photograph rather than a document. A
    // namespace is what a file *is*: the same check `uploadDocumentVersion` makes in the other
    // direction, so neither surface can file the other's uploads (ADR-031 §7).
    const [object] = await tx
      .select({
        id: storageSchema.storedObject.id,
        namespace: storageSchema.storedObject.namespace,
        uploadedByUserId: storageSchema.storedObject.uploadedByUserId,
      })
      .from(storageSchema.storedObject)
      .where(
        and(
          eq(storageSchema.storedObject.id, input.storedObjectId),
          eq(storageSchema.storedObject.projectId, projectId),
        ),
      );
    if (!object) throw new NotFound("no such uploaded file in this project");
    if (object.namespace !== "field-media") {
      throw new InvalidInput("that file was uploaded as a document, not as field media");
    }
    if (object.uploadedByUserId !== ctx.userId) {
      // Somebody else's upload, declared in this caller's name. RLS would refuse the insert
      // anyway; refusing here says why.
      throw new InvalidInput("that file was uploaded by another person");
    }

    if (!visit.open) {
      await assertBytesPredateTheClose(tx, ctx, projectId, input.storedObjectId, visit.id);
    }

    const counted = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(fieldSchema.fieldMedia)
      .where(eq(fieldSchema.fieldMedia.visitId, visit.id));
    assertVisitMediaWithinLimit(Number(counted[0]?.count ?? 0));

    const provenanceId = await createMediaProvenance(tx, ctx, projectId, visit.demo);
    const mediaId = randomUUID();

    await tx.insert(fieldSchema.fieldMedia).values({
      id: mediaId,
      tenantId: ctx.tenantId,
      projectId,
      visitId: visit.id,
      assignmentId: visit.assignmentId,
      capturedByUserId: ctx.userId,
      localId: input.localId,
      storedObjectId: object.id,
      kind: input.kind,
      capturedAt: new Date(input.capturedAt),
      note: input.note,
      // Where the technician stood, in EPSG:4326 like every other geometry (ADR-017). Null when
      // the device had no fix — never a point somebody assumed.
      location:
        input.location === null
          ? null
          : sql`ST_SetSRID(ST_MakePoint(${input.location.longitude}, ${input.location.latitude}), 4326)`,
      locationAccuracyM:
        input.location?.accuracyM == null ? null : String(input.location.accuracyM),
      provenanceId,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.media.declared",
        objectKind: "field_media",
        objectId: mediaId,
        // The visit and the kind. Never the note, which a technician wrote in free text, and never
        // the coordinates: an audit line is read by more people than the row is.
        details: { visitId: visit.id, kind: input.kind },
      },
    );

    return { mediaId, visitId: visit.id, outcome: "stored" as const };
  });
}

type Tx = Parameters<Parameters<typeof withFieldContext>[2]>[0];

interface ResolvedVisit {
  readonly id: string;
  readonly assignmentId: string;
  readonly demo: boolean;
  /** `IN_PROGRESS`. A closed visit is decided by `assertBytesPredateTheClose`, not here. */
  readonly open: boolean;
}

/**
 * The visit must be open, this caller's own, and on the assignment the device named.
 *
 * The visit, and whether it is still open. A closed one is not refused here — see
 * `assertBytesPredateTheClose`, which needs the file before it can decide.
 */
async function resolveOwnVisit(
  tx: Tx,
  ctx: RequestContext,
  projectId: string,
  visitId: string,
  assignmentId: string,
): Promise<ResolvedVisit> {
  const rows = await tx.execute(sql`
    select v.id, v.assignment_id, v.status, v.technician_user_id,
           p.regime = 'DEMO_SIMULATION' as demo
      from app.field_visit v
      join app.provenance_record p on p.tenant_id = v.tenant_id and p.id = v.provenance_id
     where v.tenant_id = ${ctx.tenantId} and v.project_id = ${projectId} and v.id = ${visitId}
     limit 1
  `);
  const row = rows.rows[0] as unknown as
    | {
        id: string;
        assignment_id: string;
        status: string;
        technician_user_id: string;
        demo: boolean;
      }
    | undefined;
  // 404 rather than a denial: a distinguishable error would confirm the visit exists, which is
  // what somebody editing ids wants to learn (SECURITY.md §10b).
  if (!row) throw new NotFound("field visit");
  if (row.technician_user_id !== ctx.userId) {
    throw new PermissionDenied({
      role: ctx.projectRole ?? ctx.tenantRole,
      restrictedData: "media.upload",
    });
  }
  if (row.assignment_id !== assignmentId) {
    throw new InvalidInput("that visit does not belong to the assignment named");
  }
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    demo: row.demo,
    open: row.status === "IN_PROGRESS",
  };
}

/**
 * A closed visit still takes a photograph **this server already knew about before it closed**.
 *
 * ## Why the rule had to change at all
 *
 * `media.declare` names a `storedObjectId` that only this server issues, so the command cannot be
 * formed without signal. A technician working offline queues `survey.submit` first, that completes
 * the visit, and the declaration arrives behind it on the first bar of signal. Refusing it made
 * the ordinary offline capture impossible: the bytes sat in storage belonging to nothing, the
 * device kept the local file for ever, and the parcel showed a photograph nobody could open.
 * Reproduced end to end on an Android emulator on 19 November 2026 (predio 102).
 *
 * ## Why not the time the device says it took the picture
 *
 * Because that is the device's clock, declared by the same person the rule constrains, and the
 * contract says as much. A phone an hour fast, an hour slow, or simply set by hand would decide
 * whether evidence is admissible. `capturedAt` is worth recording and worthless as proof.
 *
 * ## What the server can actually vouch for
 *
 * Its own clock, twice. `upload_intent.issued_at` is written when **this server** mints the
 * presigned URL for these exact bytes; `field_visit.completed_at` is written when **this server**
 * applies the command that closes the visit. If the first precedes the second, the device was
 * already holding this photograph, for this project, before the visit closed — and no statement
 * by the device is involved in either timestamp.
 *
 * That ordering is not luck: `uploadPendingMedia` runs before the outbox is drained, so the
 * legitimate offline flow always asks for the URL before the submit is applied. A photograph taken
 * **after** the close asks for its URL after the close, and is refused — which is what the
 * original rule was protecting.
 *
 * Deliberately not `started_at`: a visit that begins offline is recorded when the device syncs, so
 * a perfectly good photograph can predate that row.
 */
async function assertBytesPredateTheClose(
  tx: Tx,
  ctx: RequestContext,
  projectId: string,
  storedObjectId: string,
  visitId: string,
): Promise<void> {
  const rows = await tx.execute(sql`
    select ui.issued_at < v.completed_at as before_close
      from app.stored_object so
      join app.upload_intent ui
        on ui.tenant_id = so.tenant_id and ui.object_key = so.object_key
      join app.field_visit v
        on v.tenant_id = so.tenant_id and v.project_id = so.project_id and v.id = ${visitId}
     where so.tenant_id = ${ctx.tenantId}
       and so.project_id = ${projectId}
       and so.id = ${storedObjectId}
       and v.completed_at is not null
     order by ui.issued_at asc
     limit 1
  `);
  const beforeClose = (rows.rows[0] as unknown as { before_close: boolean } | undefined)
    ?.before_close;
  if (beforeClose !== true) {
    throw new InvalidInput(
      "that visit is finished, and this file was not uploaded before it closed",
    );
  }
}

async function createMediaProvenance(
  tx: Tx,
  ctx: RequestContext,
  projectId: string,
  demo: boolean,
): Promise<string> {
  const id = randomUUID();
  await tx.insert(appSchema.provenanceRecord).values({
    id,
    tenantId: ctx.tenantId,
    projectId,
    // The capture really happened; whether the campaign it belongs to is a demonstration is the
    // campaign's fact, and the record carries it rather than the flattering half.
    regime: demo ? "DEMO_SIMULATION" : "LIVE_OPERATIONAL",
    origin: "FIELD_CAPTURE",
    transformations: ["ORIGINAL"],
    granularity: "INDIVIDUAL",
    title: "Fotografía de campo",
    note:
      "Fotografía tomada por el técnico asignado durante la visita. La ubicación, cuando existe, " +
      "es la del técnico en ese momento; nunca se inventa una.",
    method:
      "Captura en EIA Field; el archivo se verificó contra el proveedor antes de registrarse.",
    capturedAt: new Date(),
    validationState: "PENDING",
  });
  return id;
}

/* ---------------------------------------------------------------------------------------------
 * Reading
 * ------------------------------------------------------------------------------------------ */

export interface VisitMedia {
  readonly id: string;
  readonly visitId: string;
  readonly storedObjectId: string;
  readonly kind: FieldMediaKind;
  readonly capturedAt: string;
  readonly note: string | null;
  readonly hasLocation: boolean;
  readonly provenanceId: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

/**
 * The photographs of one parcel's visits, for the Parcel Workspace.
 *
 * It returns **descriptions, not links**: a link is a short-lived signature and is minted one at a
 * time by `presignStoredObjectDownload`, after the row has been read under the caller's own
 * context. A list that carried forty signed URLs would be forty grants issued because somebody
 * opened a tab.
 */
export async function loadParcelMedia(
  db: Database,
  ctx: RequestContext,
  parcelId: string,
): Promise<ReadonlyArray<VisitMedia>> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.responses.read");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select m.id, m.visit_id, m.stored_object_id, m.kind::text as kind, m.captured_at,
             m.note, m.location is not null as has_location, m.provenance_id,
             o.size_bytes, o.mime_type
        from app.field_media m
        join app.stored_object o on o.tenant_id = m.tenant_id and o.id = m.stored_object_id
        join app.field_assignment a on a.tenant_id = m.tenant_id and a.id = m.assignment_id
       where m.tenant_id = ${ctx.tenantId} and m.project_id = ${projectId}
         and a.parcel_id = ${parcelId}
       order by m.captured_at
    `);
    return (rows.rows as unknown as RawMedia[]).map(toVisitMedia);
  });
}

/** The photographs of one visit, for the field inbox's response detail. */
export async function loadVisitMedia(
  db: Database,
  ctx: RequestContext,
  visitId: string,
): Promise<ReadonlyArray<VisitMedia>> {
  requireCapability(ctx, "field.surveys");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    // No permission check beyond the capability: the row-level policy already decides, and it
    // decides correctly for both readers — a technician sees their own, and a coordinator holding
    // `field.responses.read` sees the project's. A `requirePermission` here would lock a
    // technician out of the photographs they just took.
    const rows = await tx.execute(sql`
      select m.id, m.visit_id, m.stored_object_id, m.kind::text as kind, m.captured_at,
             m.note, m.location is not null as has_location, m.provenance_id,
             o.size_bytes, o.mime_type
        from app.field_media m
        join app.stored_object o on o.tenant_id = m.tenant_id and o.id = m.stored_object_id
       where m.tenant_id = ${ctx.tenantId} and m.project_id = ${projectId}
         and m.visit_id = ${visitId}
       order by m.captured_at
    `);
    return (rows.rows as unknown as RawMedia[]).map(toVisitMedia);
  });
}

interface RawMedia {
  id: string;
  visit_id: string;
  stored_object_id: string;
  kind: FieldMediaKind;
  captured_at: Date | string;
  note: string | null;
  has_location: boolean;
  provenance_id: string;
  size_bytes: number | string;
  mime_type: string;
}

function toVisitMedia(row: RawMedia): VisitMedia {
  return {
    id: row.id,
    visitId: row.visit_id,
    storedObjectId: row.stored_object_id,
    kind: row.kind,
    capturedAt:
      row.captured_at instanceof Date
        ? row.captured_at.toISOString()
        : new Date(row.captured_at).toISOString(),
    note: row.note,
    // Whether there is a point, never the point: a coordinate on a list is a coordinate in a
    // screenshot, and this one is a person's position at a moment.
    hasLocation: row.has_location,
    provenanceId: row.provenance_id,
    sizeBytes: Number(row.size_bytes),
    mimeType: row.mime_type,
  };
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}
