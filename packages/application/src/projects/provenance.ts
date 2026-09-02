import { appSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  NotFound,
  requireCapability,
  requirePermission,
  type ProvenanceFacets,
  type ProvenanceRecord,
  type ProvenanceView,
  type RequestContext,
} from "@eia/domain";
import { and, eq, inArray } from "drizzle-orm";

type RecordRow = typeof appSchema.provenanceRecord.$inferSelect;

/** Row → domain record. The facets are columns, never a single stored source type (ADR-005). */
export function toProvenanceRecord(row: RecordRow): ProvenanceRecord {
  return {
    id: row.id,
    facets: {
      regime: row.regime,
      origin: row.origin,
      transformations: row.transformations,
      granularity: row.granularity,
    },
    title: row.title,
    note: row.note,
    sourceLabel: row.sourceLabel,
    sourceReference: row.sourceReference,
    sourceVersion: row.sourceVersion,
    method: row.method,
    capturedAt: row.capturedAt,
    recordedAt: row.recordedAt,
    validationState: row.validationState,
    validationNote: row.validationNote,
  };
}

export function facetsOf(row: RecordRow): ProvenanceFacets {
  return {
    regime: row.regime,
    origin: row.origin,
    transformations: row.transformations,
    granularity: row.granularity,
  };
}

/** Load provenance records by id inside an existing transaction (used by the read models). */
export async function loadProvenanceRecords(
  tx: DbTx,
  ctx: RequestContext,
  ids: ReadonlyArray<string>,
): Promise<Map<string, RecordRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(appSchema.provenanceRecord)
    .where(
      and(
        eq(appSchema.provenanceRecord.tenantId, ctx.tenantId),
        inArray(appSchema.provenanceRecord.id, [...new Set(ids)]),
      ),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Provenance drawer read model. Requires `provenance.read` and the project capability, so a
 * record id guessed from another project cannot be opened: RLS hides it, and the explicit
 * tenant/project predicates hide it a second time.
 */
export async function loadProvenanceView(
  db: Database,
  ctx: RequestContext,
  provenanceId: string,
): Promise<ProvenanceView> {
  requireCapability(ctx, "core.projects");
  requirePermission(ctx, "provenance.read");
  if (ctx.projectId === null) throw new NotFound("provenance record");
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(appSchema.provenanceRecord)
      .where(
        and(
          eq(appSchema.provenanceRecord.tenantId, ctx.tenantId),
          eq(appSchema.provenanceRecord.projectId, projectId),
          eq(appSchema.provenanceRecord.id, provenanceId),
        ),
      );
    const row = rows[0];
    if (!row) throw new NotFound("provenance record");

    const edges = await tx
      .select({ inputId: appSchema.provenanceInput.inputProvenanceId })
      .from(appSchema.provenanceInput)
      .where(
        and(
          eq(appSchema.provenanceInput.tenantId, ctx.tenantId),
          eq(appSchema.provenanceInput.projectId, projectId),
          eq(appSchema.provenanceInput.provenanceId, provenanceId),
        ),
      );
    const inputRows = await loadProvenanceRecords(
      tx,
      ctx,
      edges.map((e) => e.inputId),
    );

    return {
      ...toProvenanceRecord(row),
      inputs: [...inputRows.values()].map((input) => ({
        id: input.id,
        title: input.title,
        facets: facetsOf(input),
      })),
    };
  });
}
