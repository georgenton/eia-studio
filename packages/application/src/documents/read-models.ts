import { withDbContext, type Database } from "@eia/db";
import {
  NotFound,
  requireCapability,
  requirePermission,
  type ChunkLocatorKind,
  type DocumentKind,
  type DocumentPrivacyClassification,
  type DocumentProcessingState,
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
  readonly versionLabel: string;
  readonly versionId: string;
  readonly textSource: TextSource;
  readonly sourceNote: string;
  readonly pageCount: number;
  readonly chunkCount: number;
  readonly versionCount: number;
  readonly importedAt: string;
  /** Where an uploaded file has got to. A transcribed excerpt has always been `READY`. */
  readonly processingState: DocumentProcessingState;
  /** Why processing stopped, when it did. Operator-facing and bounded; never the file's text. */
  readonly processingNote: string | null;
  readonly privacyClassification: DocumentPrivacyClassification;
  /** Null for the versions that arrived before there was an object store (ADR-031). */
  readonly originalFilename: string | null;
  readonly sizeBytes: number | null;
  readonly storedObjectId: string | null;
  /** The date the document itself bears, when the uploader knew it. */
  readonly sourceDate: string | null;
}

export interface DocumentVersionDetail extends DocumentSummary {
  readonly chunkingStrategy: string;
  readonly provenanceId: string;
  /** True when a newer version exists: an old citation still resolves, and says it is old. */
  readonly superseded: boolean;
  readonly passages: ReadonlyArray<{
    readonly chunkId: string;
    readonly ordinal: number;
    /** `PAGE` for a PDF, `SECTION` for a DOCX, which has no page model (ADR-033). */
    readonly locatorKind: ChunkLocatorKind;
    readonly pageFrom: number | null;
    readonly pageTo: number | null;
    readonly sectionPath: string | null;
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
             v.processing_state::text as processing_state, v.processing_note,
             v.privacy_classification::text as privacy_classification,
             v.original_filename, v.size_bytes, v.stored_object_id, v.source_date,
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
             v.processing_state::text as processing_state, v.processing_note,
             v.privacy_classification::text as privacy_classification,
             v.original_filename, v.size_bytes, v.stored_object_id, v.source_date,
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
      select id, ordinal, locator_kind::text as locator_kind, page_from, page_to, section_path, text
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
          locator_kind: ChunkLocatorKind;
          page_from: number | null;
          page_to: number | null;
          section_path: string | null;
          text: string;
        }>
      ).map((chunk) => ({
        chunkId: chunk.id,
        ordinal: Number(chunk.ordinal),
        locatorKind: chunk.locator_kind,
        pageFrom: chunk.page_from === null ? null : Number(chunk.page_from),
        pageTo: chunk.page_to === null ? null : Number(chunk.page_to),
        sectionPath: chunk.section_path,
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
  processing_state: DocumentProcessingState;
  processing_note: string | null;
  privacy_classification: DocumentPrivacyClassification;
  original_filename: string | null;
  size_bytes: number | string | null;
  stored_object_id: string | null;
  source_date: Date | string | null;
}

function toSummary(row: RawDocument): DocumentSummary {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    kind: row.kind,
    versionId: row.version_id,
    versionLabel: row.version_label,
    textSource: row.text_source,
    sourceNote: row.source_note,
    pageCount: Number(row.page_count),
    chunkCount: Number(row.chunk_count),
    versionCount: Number(row.version_count),
    importedAt: iso(row.imported_at),
    processingState: row.processing_state,
    processingNote: row.processing_note,
    privacyClassification: row.privacy_classification,
    originalFilename: row.original_filename,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    storedObjectId: row.stored_object_id,
    // A calendar date the document bears, not an instant: it keeps the day it was written on
    // whichever side of a timezone the reader is.
    sourceDate:
      row.source_date === null
        ? null
        : row.source_date instanceof Date
          ? row.source_date.toISOString().slice(0, 10)
          : String(row.source_date).slice(0, 10),
  };
}
