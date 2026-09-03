import { documentsSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  assertIngestable,
  chunkDocument,
  CHUNKING_STRATEGY,
  contentHash,
  ingestDocumentSchema,
  InvalidInput,
  nextVersionLabel,
  NotFound,
  requireCapability,
  requirePermission,
  type IngestDocumentInput,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { recordAudit } from "../audit/record";

/**
 * Bringing a document into the project, once.
 *
 * ## What "ingest" means here, and what it deliberately does not
 *
 * It means: take extracted text, write a version, chunk it deterministically, and store the chunks.
 * It does **not** mean file upload, OCR, or a PDF parser. The port that produces the text
 * (`DocumentTextSource`) is one function returning pages; the pilot's adapter reads excerpts from a
 * fixture, and a PDF adapter is a later addition that changes nothing downstream (TD-056).
 *
 * ## Why re-ingesting identical text is a no-op rather than a new version
 *
 * A version is what citations point at. Creating a fresh one for byte-identical text would split a
 * document's history for no reason and orphan nothing — but it would also make "which version is
 * current" change under a reader for no observable cause. So the content hash decides: same text,
 * same version, nothing written. Different text, new version, new chunks, and the old version and
 * its chunks stay exactly where they are.
 */
export interface IngestedVersion {
  readonly documentId: string;
  readonly documentCode: string;
  readonly versionId: string;
  readonly versionLabel: string;
  readonly chunkCount: number;
  /** True when the text was identical to the current version and nothing was written. */
  readonly unchanged: boolean;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

export async function ingestDocumentVersion(
  db: Database,
  ctx: RequestContext,
  input: IngestDocumentInput,
): Promise<IngestedVersion> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "documents.write");
  const projectId = requireProject(ctx);
  return withDbContext(db, ctx, (tx) =>
    ingestDocumentVersionInTx(
      tx,
      { tenantId: ctx.tenantId, projectId, userId: ctx.userId, requestId: ctx.requestId },
      input,
    ),
  );
}

/**
 * The same ingestion, inside a transaction the caller already owns and **without** the
 * authorization checks.
 *
 * The split is deliberate. Chunking, hashing, provenance and the content-hash idempotency are
 * properties of *ingestion* and must be identical however a version arrives — otherwise the seeder
 * would produce rows the product could not have produced. Capability and permission are properties
 * of the *caller*, and the seeder does not have one: it runs as the migrator, outside any request.
 * So authorization lives in the wrapper above, on the path every request takes, and this function
 * is reachable only from inside the package.
 */
export interface IngestScope {
  readonly tenantId: string;
  readonly projectId: string;
  /** Null when no person performed this: the fixture seeder, which is not an actor. */
  readonly userId: string | null;
  readonly requestId?: string;
}

export async function ingestDocumentVersionInTx(
  tx: DbTx,
  scope: IngestScope,
  input: IngestDocumentInput,
): Promise<IngestedVersion> {
  const parsed = ingestDocumentSchema.parse(input);
  const projectId = scope.projectId;
  const ctx = scope;

  // The gate, before a single row: a document with identified personal data is refused, not
  // redacted, because the deidentification pipeline that would make its text safe to chunk and
  // retrieve does not exist (AI_GOVERNANCE.md §4).
  assertIngestable({ code: parsed.code, containsPii: parsed.containsPii });

  const chunks = chunkDocument(parsed.pages);
  if (chunks.length === 0) throw new InvalidInput("this document produced no chunks");
  const documentHash = contentHash(parsed.pages.map((page) => page.text).join("\n\n"));

  {
    const existing = await tx.execute(sql`
      select d.id, d.current_version_id, v.content_hash
        from app.source_document d
        left join app.document_version v
          on v.tenant_id = d.tenant_id and v.id = d.current_version_id
       where d.tenant_id = ${ctx.tenantId} and d.project_id = ${projectId} and d.code = ${parsed.code}
       for update of d
    `);
    const found = existing.rows[0] as
      { id: string; current_version_id: string | null; content_hash: string | null } | undefined;

    let documentId = found?.id;
    if (!documentId) {
      documentId = randomUUID();
      await tx.insert(documentsSchema.sourceDocument).values({
        id: documentId,
        tenantId: ctx.tenantId,
        projectId,
        code: parsed.code,
        title: parsed.title,
        kind: parsed.kind,
        containsPii: false,
      });
    } else if (found?.content_hash === documentHash) {
      const label = await currentLabel(tx, ctx.tenantId, found.current_version_id);
      return {
        documentId,
        documentCode: parsed.code,
        versionId: found.current_version_id!,
        versionLabel: label,
        chunkCount: chunks.length,
        unchanged: true,
      };
    }

    const labels = await tx.execute(sql`
      select version_label from app.document_version
       where tenant_id = ${ctx.tenantId} and document_id = ${documentId}
    `);
    const versionLabel =
      parsed.versionLabel &&
      !labels.rows.some(
        (r) => (r as { version_label: string }).version_label === parsed.versionLabel,
      )
        ? parsed.versionLabel
        : nextVersionLabel(
            (labels.rows as Array<{ version_label: string }>).map((r) => r.version_label),
          );

    const provenanceId = await createDocumentProvenance(tx, ctx.tenantId, projectId, {
      title: `${parsed.code} ${versionLabel} · ${parsed.title}`,
      note: parsed.sourceNote,
      textSource: parsed.textSource,
    });

    const versionId = randomUUID();
    await tx.insert(documentsSchema.documentVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      projectId,
      documentId,
      versionLabel,
      textSource: parsed.textSource,
      sourceNote: parsed.sourceNote,
      contentHash: documentHash,
      pageCount: parsed.pages.length,
      chunkCount: chunks.length,
      chunkingStrategy: CHUNKING_STRATEGY,
      importedByUserId: ctx.userId,
      provenanceId,
    });

    for (const chunk of chunks) {
      await tx.insert(documentsSchema.documentChunk).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        versionId,
        ordinal: chunk.ordinal,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        charFrom: chunk.charFrom,
        charTo: chunk.charTo,
        text: chunk.text,
        contentHash: chunk.contentHash,
      });
    }

    // The pointer moves; the old version and its chunks do not. A citation made yesterday still
    // resolves to the words it cited.
    await tx.execute(sql`
      update app.source_document
         set current_version_id = ${versionId}, title = ${parsed.title}, kind = ${parsed.kind}::app.source_document_kind
       where tenant_id = ${ctx.tenantId} and id = ${documentId}
    `);

    // Audited when a person did it. The seeder is not a person and writes no audit entry: an
    // actor-shaped row for an action nobody took is worse than the absence of one.
    if (ctx.userId) {
      await recordAudit(
        tx,
        { tenantId: ctx.tenantId, projectId },
        { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
        {
          action: "documents.version.ingested",
          objectKind: "document_version",
          objectId: versionId,
          details: {
            code: parsed.code,
            versionLabel,
            pages: parsed.pages.length,
            chunks: chunks.length,
            textSource: parsed.textSource,
            chunkingStrategy: CHUNKING_STRATEGY,
          },
        },
      );
    }

    return {
      documentId,
      documentCode: parsed.code,
      versionId,
      versionLabel,
      chunkCount: chunks.length,
      unchanged: false,
    };
  }
}

async function currentLabel(tx: DbTx, tenantId: string, versionId: string | null): Promise<string> {
  if (!versionId) throw new NotFound("document version");
  const result = await tx.execute(sql`
    select version_label from app.document_version where tenant_id = ${tenantId} and id = ${versionId}
  `);
  const row = result.rows[0] as { version_label: string } | undefined;
  if (!row) throw new NotFound("document version");
  return row.version_label;
}

/**
 * A version's provenance.
 *
 * `RECONSTRUCTED_EXCERPT` is the pilot's whole corpus: text transcribed by hand from the concluded
 * study's documents, whose originals are external source material and are not in this system.
 * Labelling that as an extraction from an ingested file would be the same fabrication ADR-020
 * refused for page numbers, one layer up — so the transformation facet says `RECONSTRUCTED` and the
 * screen repeats it beside every citation.
 */
async function createDocumentProvenance(
  tx: DbTx,
  tenantId: string,
  projectId: string,
  input: { title: string; note: string; textSource: string },
): Promise<string> {
  const id = randomUUID();
  const reconstructed = input.textSource === "RECONSTRUCTED_EXCERPT";
  await tx.execute(sql`
    insert into app.provenance_record
      (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
       method, validation_state, captured_at)
    values (${id}, ${tenantId}, ${projectId}, 'HISTORICAL_OBSERVED', 'IMPORTED_DOCUMENT',
            ${
              reconstructed
                ? sql`ARRAY['RECONSTRUCTED']::app.provenance_transformation[]`
                : sql`ARRAY['ORIGINAL']::app.provenance_transformation[]`
            },
            'AGGREGATE', ${input.title}, ${input.note},
            ${`Segmentación determinista ${CHUNKING_STRATEGY}`}, 'PARTIAL', now())
  `);
  return id;
}
