import { withDbContext, type Database } from "@eia/db";
import {
  DOCUMENT_KIND_LABELS,
  NotFound,
  requireCapability,
  requirePermission,
  TEXT_SOURCE_LABELS,
  type DocumentKind,
  type RequestContext,
  type TextSource,
} from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * What the Documents surface reads.
 *
 * The list is of *documents*, with their current version; the detail is of one *version*, because
 * that is the unit a citation names and the unit whose text is fixed. A reader who has followed a
 * citation into a superseded version is told so, rather than being silently redirected to the
 * current one — the whole point of keeping versions is that an old citation still resolves.
 */
export interface DocumentSummary {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly kindLabel: string;
  readonly versionLabel: string;
  readonly versionId: string;
  readonly textSource: TextSource;
  readonly textSourceLabel: string;
  readonly sourceNote: string;
  readonly pageCount: number;
  readonly chunkCount: number;
  readonly versionCount: number;
  readonly importedAt: string;
}

export interface DocumentVersionDetail extends DocumentSummary {
  readonly chunkingStrategy: string;
  readonly provenanceId: string;
  /** True when a newer version exists: an old citation still resolves, and says it is old. */
  readonly superseded: boolean;
  readonly passages: ReadonlyArray<{
    readonly chunkId: string;
    readonly ordinal: number;
    readonly pageFrom: number;
    readonly pageTo: number;
    readonly text: string;
  }>;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

const iso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export async function loadDocuments(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<DocumentSummary>> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "documents.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const result = await tx.execute(sql`
      select d.id, d.code, d.title, d.kind::text as kind,
             v.id as version_id, v.version_label, v.text_source::text as text_source,
             v.source_note, v.page_count, v.chunk_count, v.imported_at,
             (select count(*)::int from app.document_version av
               where av.tenant_id = d.tenant_id and av.document_id = d.id) as version_count
        from app.source_document d
        join app.document_version v on v.tenant_id = d.tenant_id and v.id = d.current_version_id
       where d.tenant_id = ${ctx.tenantId} and d.project_id = ${projectId}
       order by d.code
    `);
    return (result.rows as unknown as RawDocument[]).map(toSummary);
  });
}

export async function loadDocumentVersion(
  db: Database,
  ctx: RequestContext,
  code: string,
  versionLabel?: string,
): Promise<DocumentVersionDetail> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "documents.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const result = await tx.execute(sql`
      select d.id, d.code, d.title, d.kind::text as kind, d.current_version_id,
             v.id as version_id, v.version_label, v.text_source::text as text_source,
             v.source_note, v.page_count, v.chunk_count, v.imported_at,
             v.chunking_strategy, v.provenance_id,
             (select count(*)::int from app.document_version av
               where av.tenant_id = d.tenant_id and av.document_id = d.id) as version_count
        from app.source_document d
        join app.document_version v on v.tenant_id = d.tenant_id and v.document_id = d.id
       where d.tenant_id = ${ctx.tenantId} and d.project_id = ${projectId} and d.code = ${code}
         and ${versionLabel ? sql`v.version_label = ${versionLabel}` : sql`v.id = d.current_version_id`}
    `);
    const row = result.rows[0] as unknown as
      | (RawDocument & {
          current_version_id: string;
          chunking_strategy: string;
          provenance_id: string;
        })
      | undefined;
    if (!row) throw new NotFound("document version");

    const chunks = await tx.execute(sql`
      select id, ordinal, page_from, page_to, text
        from app.document_chunk
       where tenant_id = ${ctx.tenantId} and version_id = ${row.version_id}
       order by ordinal
    `);

    return {
      ...toSummary(row),
      chunkingStrategy: row.chunking_strategy,
      provenanceId: row.provenance_id,
      superseded: row.current_version_id !== row.version_id,
      passages: (
        chunks.rows as unknown as Array<{
          id: string;
          ordinal: number;
          page_from: number;
          page_to: number;
          text: string;
        }>
      ).map((chunk) => ({
        chunkId: chunk.id,
        ordinal: Number(chunk.ordinal),
        pageFrom: Number(chunk.page_from),
        pageTo: Number(chunk.page_to),
        text: chunk.text,
      })),
    };
  });
}

interface RawDocument {
  id: string;
  code: string;
  title: string;
  kind: DocumentKind;
  version_id: string;
  version_label: string;
  text_source: TextSource;
  source_note: string;
  page_count: number;
  chunk_count: number;
  version_count: number;
  imported_at: Date | string;
}

function toSummary(row: RawDocument): DocumentSummary {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    kind: row.kind,
    kindLabel: DOCUMENT_KIND_LABELS[row.kind] ?? row.kind,
    versionId: row.version_id,
    versionLabel: row.version_label,
    textSource: row.text_source,
    textSourceLabel: TEXT_SOURCE_LABELS[row.text_source] ?? row.text_source,
    sourceNote: row.source_note,
    pageCount: Number(row.page_count),
    chunkCount: Number(row.chunk_count),
    versionCount: Number(row.version_count),
    importedAt: iso(row.imported_at),
  };
}
