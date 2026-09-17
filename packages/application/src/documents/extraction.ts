import { randomUUID } from "node:crypto";

import { documentsSchema, storageSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  chunkDocument,
  CHUNKING_STRATEGY,
  contentHash,
  InvalidInput,
  NotFound,
  requireCapability,
  requirePermission,
  UnsupportedUpload,
  type ChunkLocatorKind,
  type ExtractedUnit,
  type RequestContext,
  type StoragePort,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import { DocxUnreadable, extractDocx } from "./extract-docx";
import { extractPdf, PdfUnreadable } from "./extract-pdf";

/**
 * Reading an uploaded file into passages a citation can name (ADR-033).
 *
 * ## Where this runs, and why not in a request
 *
 * In the worker. A 90 MB study is minutes of work and megabytes of intermediate text, which is not
 * what a request should hold (ARCHITECTURE §9.1: long work is always a job). The queue is the
 * `document_version` table itself — `app.claim_document_extraction`, `FOR UPDATE SKIP LOCKED` —
 * exactly as Slice 4 queued classifications, so there is no broker and no second store that can
 * disagree with the database about what work exists.
 *
 * ## The four outcomes, and the two that are not failures
 *
 * `READY` — the text was read and chunked.
 * `REQUIRES_OCR` — the PDF carries no meaningful native text. **Terminal and honest**: it is a scan,
 *   this product does not guess what the pages say, and the file stays available to read by hand.
 * `FAILED` — the file could not be read at all: corrupt, encrypted, or beyond the limits.
 * and the fourth is the claim itself never completing, which the stale-release returns to the queue.
 *
 * ## What extraction never does
 *
 * It does not repair the document. A delivered study's own spellings, its broken tables and its
 * missing sections survive — the rule Wave C established for the management plan, for the same
 * reason: those are findings to report, not defects to fix on the way in.
 */
export interface ExtractionOutcome {
  readonly versionId: string;
  readonly state: "READY" | "REQUIRES_OCR" | "FAILED";
  readonly chunkCount: number;
  readonly pageCount: number;
  readonly locatorKind: ChunkLocatorKind | null;
  /** Operator-facing and bounded. Never the document's text. */
  readonly note: string | null;
}

/**
 * Ask for a stored version to be read.
 *
 * `UPLOADED → QUEUED`, and nothing else: the worker picks it up. Also the way a `FAILED` or
 * `REQUIRES_OCR` version is retried after a fix, which is why it is a use-case a person can reach
 * rather than something the upload does invisibly.
 */
export async function queueDocumentExtraction(
  db: Database,
  ctx: RequestContext,
  versionId: string,
): Promise<{ queued: boolean; state: string }> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "documents.write");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const [version] = await tx
      .select({
        id: documentsSchema.documentVersion.id,
        state: documentsSchema.documentVersion.processingState,
        storedObjectId: documentsSchema.documentVersion.storedObjectId,
      })
      .from(documentsSchema.documentVersion)
      .where(
        and(
          eq(documentsSchema.documentVersion.id, versionId),
          eq(documentsSchema.documentVersion.projectId, projectId),
        ),
      );
    if (!version) throw new NotFound("document version");
    if (version.storedObjectId === null) {
      // A transcribed excerpt has no file. Nothing to read, and saying so is better than queueing
      // work that would fail at the first fetch.
      throw new InvalidInput("this version has no uploaded file to read");
    }
    if (version.state === "QUEUED" || version.state === "PROCESSING") {
      return { queued: false, state: version.state };
    }
    if (version.state === "READY") {
      // Chunks are immutable: re-reading the same bytes could only produce the same passages, and
      // a second set would make a citation ambiguous. A corrected file is a new version.
      throw new InvalidInput("this version has already been read; a corrected file is a version");
    }

    await tx
      .update(documentsSchema.documentVersion)
      .set({ processingState: "QUEUED", processingNote: null })
      .where(eq(documentsSchema.documentVersion.id, versionId));
    return { queued: true, state: "QUEUED" };
  });
}

export interface ExtractionClaim {
  readonly versionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly importedByUserId: string;
}

/**
 * Take one version off the queue.
 *
 * Returns four identifiers and no content. The worker then builds a context **as the person who
 * uploaded it** and does everything else under their RLS, so this process needs no `BYPASSRLS` and
 * sees exactly what they may see (ARCHITECTURE §6).
 */
export async function claimNextExtraction(
  db: Database,
  maxAttempts = 3,
): Promise<ExtractionClaim | null> {
  const result = await db.execute(
    sql`select * from app.claim_document_extraction(${maxAttempts}::integer)`,
  );
  const row = result.rows[0] as
    | {
        version_id: string;
        tenant_id: string;
        project_id: string;
        imported_by_user_id: string;
      }
    | undefined;
  if (!row) return null;
  return {
    versionId: row.version_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    importedByUserId: row.imported_by_user_id,
  };
}

export async function releaseStaleExtractions(
  db: Database,
  staleAfter = "15 minutes",
): Promise<number> {
  const result = await db.execute(
    sql`select app.release_stale_document_extractions(${staleAfter}::interval) as released`,
  );
  return Number((result.rows[0] as { released: number } | undefined)?.released ?? 0);
}

/**
 * Read one claimed version.
 *
 * The context is the uploader's, built by the caller. Everything below runs under their RLS.
 */
export async function processDocumentExtraction(
  db: Database,
  claim: ExtractionClaim,
  storage: StoragePort,
): Promise<ExtractionOutcome> {
  const { versionId, projectId } = claim;
  /*
   * The uploader's context, in the shape `processClassification` established: the worker holds no
   * identity of its own, opens an ordinary RLS transaction *as them*, and therefore needs no
   * `BYPASSRLS`. `fieldResponsesAccess` is deliberately absent — a document is not anybody's
   * answers, and extraction has no reason to see one.
   */
  const ctx = {
    userId: claim.importedByUserId,
    tenantId: claim.tenantId,
    projectId: claim.projectId,
    surface: "job" as const,
  };

  const version = await withDbContext(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        id: documentsSchema.documentVersion.id,
        documentId: documentsSchema.documentVersion.documentId,
        storedObjectId: documentsSchema.documentVersion.storedObjectId,
        mimeType: documentsSchema.documentVersion.mimeType,
        sizeBytes: documentsSchema.documentVersion.sizeBytes,
        objectKey: storageSchema.storedObject.objectKey,
      })
      .from(documentsSchema.documentVersion)
      .innerJoin(
        storageSchema.storedObject,
        eq(storageSchema.storedObject.id, documentsSchema.documentVersion.storedObjectId),
      )
      .where(
        and(
          eq(documentsSchema.documentVersion.id, versionId),
          eq(documentsSchema.documentVersion.projectId, projectId),
        ),
      );
    return rows[0] ?? null;
  });
  // The claim moved it to PROCESSING; if the row is now invisible, the uploader's access was
  // revoked between the claim and here, and failing safely is the right outcome.
  if (!version) throw new NotFound("document version");

  let extraction;
  try {
    const bytes = await storage.get(version.objectKey);
    extraction = await readBytes(bytes, version.mimeType ?? "");
  } catch (error) {
    return settleFailure(db, ctx, versionId, error);
  }

  if (extraction.kind === "REQUIRES_OCR") {
    return settle(db, ctx, versionId, {
      state: "REQUIRES_OCR",
      chunkCount: 0,
      pageCount: extraction.pageCount,
      locatorKind: null,
      note: extraction.note,
    });
  }

  const chunks = chunkFromUnits(extraction.units, extraction.locatorKind);
  if (chunks.length === 0) {
    // Read successfully and empty: a PDF whose pages are blank, or a DOCX with no paragraphs. Not
    // a failure of ours, and not something to report as readable either.
    return settle(db, ctx, versionId, {
      state: "REQUIRES_OCR",
      chunkCount: 0,
      pageCount: extraction.pageCount,
      locatorKind: null,
      note: "the file was read and carries no text",
    });
  }

  const text = extraction.units.map((unit) => unit.text).join("\n\n");
  return withDbContext(db, ctx, async (tx) => {
    await writeChunks(tx, ctx, versionId, chunks);
    await tx
      .update(documentsSchema.documentVersion)
      .set({
        processingState: "READY",
        processingNote: null,
        textSource: extraction.locatorKind === "PAGE" ? "PDF_TEXT" : "DOCX_TEXT",
        // The text hash, at last: until now `content_hash` held the file's, because the empty
        // string's digest would be a value every unprocessed version shared (ADR-031 §7).
        contentHash: contentHash(text),
        pageCount: extraction.pageCount,
        chunkCount: chunks.length,
        chunkingStrategy: CHUNKING_STRATEGY,
        extractionClaimedAt: null,
      })
      .where(eq(documentsSchema.documentVersion.id, versionId));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "job", requestId: null },
      {
        action: "document.version.extracted",
        objectKind: "document_version",
        objectId: versionId,
        // Counts and a kind. Never a passage: an audit line is read by more people than the row.
        details: {
          locatorKind: extraction.locatorKind,
          pages: extraction.pageCount,
          chunks: chunks.length,
        },
      },
    );

    return {
      versionId,
      state: "READY" as const,
      chunkCount: chunks.length,
      pageCount: extraction.pageCount,
      locatorKind: extraction.locatorKind,
      note: null,
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * Reading the bytes
 * ------------------------------------------------------------------------------------------ */

type ReadResult =
  | {
      kind: "TEXT";
      units: ReadonlyArray<ExtractedUnit>;
      locatorKind: ChunkLocatorKind;
      pageCount: number;
    }
  | { kind: "REQUIRES_OCR"; pageCount: number; note: string };

async function readBytes(bytes: Uint8Array, mimeType: string): Promise<ReadResult> {
  if (mimeType === "application/pdf") {
    const pdf = await extractPdf(bytes);
    if (!pdf.assessment.hasNativeText) {
      return {
        kind: "REQUIRES_OCR",
        pageCount: pdf.pageCount,
        // The numbers, so an operator can see *why* rather than being told a verdict.
        note:
          `${pdf.assessment.reason}: ${pdf.assessment.pagesWithText} of ${pdf.assessment.pageCount} ` +
          `pages carry text, ${pdf.assessment.totalCharacters} characters in total`,
      };
    }
    return { kind: "TEXT", units: pdf.units, locatorKind: "PAGE", pageCount: pdf.pageCount };
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const docx = await extractDocx(bytes);
    return { kind: "TEXT", units: docx.units, locatorKind: "SECTION", pageCount: 0 };
  }

  throw new InvalidInput(`nothing here reads ${mimeType || "a file with no declared type"}`);
}

/* ---------------------------------------------------------------------------------------------
 * Chunking, with the locator the units carry
 * ------------------------------------------------------------------------------------------ */

interface LocatedChunk {
  readonly ordinal: number;
  readonly locatorKind: ChunkLocatorKind;
  readonly pageFrom: number | null;
  readonly pageTo: number | null;
  readonly sectionPath: string | null;
  readonly text: string;
  readonly charFrom: number;
  readonly charTo: number;
  readonly contentHash: string;
}

/**
 * The same deterministic chunker Slice 6 wrote, with the locator carried through.
 *
 * `chunkDocument` takes pages and returns page ranges, which is exactly right for a PDF. For a
 * DOCX its "pages" are paragraph ordinals — used only to find which unit a chunk started in, so
 * the chunk inherits *that paragraph's heading trail* — and the page numbers it returns are
 * discarded rather than stored, because they are not pages.
 */
function chunkFromUnits(
  units: ReadonlyArray<ExtractedUnit>,
  locatorKind: ChunkLocatorKind,
): ReadonlyArray<LocatedChunk> {
  if (locatorKind === "PAGE") {
    // A chunk may span two pages, and a citation of one says so by naming none — the rule Slice 6
    // already set. Pages are contiguous, so one pass over the whole document is right.
    return chunkDocument(units.map((unit) => ({ number: unit.ordinal, text: unit.text }))).map(
      (chunk) => ({
        ordinal: chunk.ordinal,
        locatorKind,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        sectionPath: null,
        text: chunk.text,
        charFrom: chunk.charFrom,
        charTo: chunk.charTo,
        contentHash: chunk.contentHash,
      }),
    );
  }

  /*
   * A **section** is chunked on its own, so no chunk ever spans two of them.
   *
   * The reason is the whole point of a locator: a passage that began under *6.2 Programa de
   * desechos* and ran into *7. Cronograma* has no single place a reader could turn to, and
   * labelling it with whichever heading it started under would be a citation that sends somebody
   * to the wrong part of the document. Pages can be spanned because a page number is a physical
   * fact either way; a heading trail is a claim about *what this passage is part of*.
   */
  const chunks: LocatedChunk[] = [];
  let charOffset = 0;
  for (const group of groupBySection(units)) {
    const inner = chunkDocument(
      group.units.map((unit) => ({ number: unit.ordinal, text: unit.text })),
    );
    for (const chunk of inner) {
      chunks.push({
        ordinal: chunks.length,
        locatorKind,
        pageFrom: null,
        pageTo: null,
        sectionPath: group.sectionPath,
        text: chunk.text,
        charFrom: charOffset + chunk.charFrom,
        charTo: charOffset + chunk.charTo,
        contentHash: chunk.contentHash,
      });
    }
    charOffset += group.units.reduce((sum, unit) => sum + unit.text.length + 2, 0);
  }
  return chunks;
}

/** Consecutive paragraphs that share a heading trail. Order is the document's, always. */
function groupBySection(
  units: ReadonlyArray<ExtractedUnit>,
): ReadonlyArray<{ sectionPath: string | null; units: ReadonlyArray<ExtractedUnit> }> {
  const groups: Array<{ sectionPath: string | null; units: ExtractedUnit[] }> = [];
  for (const unit of units) {
    const last = groups[groups.length - 1];
    if (last && last.sectionPath === unit.sectionPath) last.units.push(unit);
    else groups.push({ sectionPath: unit.sectionPath, units: [unit] });
  }
  return groups;
}

async function writeChunks(
  tx: DbTx,
  ctx: JobContext,
  versionId: string,
  chunks: ReadonlyArray<LocatedChunk>,
): Promise<void> {
  for (const chunk of chunks) {
    await tx.insert(documentsSchema.documentChunk).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId: ctx.projectId,
      versionId,
      ordinal: chunk.ordinal,
      locatorKind: chunk.locatorKind,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      sectionPath: chunk.sectionPath,
      charFrom: chunk.charFrom,
      charTo: chunk.charTo,
      text: chunk.text,
      contentHash: chunk.contentHash,
    });
  }
}

/* ---------------------------------------------------------------------------------------------
 * Settling
 * ------------------------------------------------------------------------------------------ */

async function settle(
  db: Database,
  ctx: JobContext,
  versionId: string,
  outcome: Omit<ExtractionOutcome, "versionId">,
): Promise<ExtractionOutcome> {
  return withDbContext(db, ctx, async (tx) => {
    await tx
      .update(documentsSchema.documentVersion)
      .set({
        processingState: outcome.state,
        processingNote: outcome.note?.slice(0, 400) ?? null,
        pageCount: outcome.pageCount,
        extractionClaimedAt: null,
      })
      .where(eq(documentsSchema.documentVersion.id, versionId));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId: ctx.projectId },
      { userId: ctx.userId, kind: "job", requestId: null },
      {
        action: "document.version.extracted",
        objectKind: "document_version",
        objectId: versionId,
        details: { state: outcome.state, pages: outcome.pageCount },
      },
    );
    return { ...outcome, versionId };
  });
}

/**
 * A file that could not be read.
 *
 * The note is bounded operational text and names the *kind* of failure. It is not the document's
 * content and it is not a stack trace: this string reaches a screen a consultant reads.
 */
async function settleFailure(
  db: Database,
  ctx: JobContext,
  versionId: string,
  error: unknown,
): Promise<ExtractionOutcome> {
  const note =
    error instanceof PdfUnreadable || error instanceof DocxUnreadable
      ? `${error.name}: ${error.message}`
      : error instanceof UnsupportedUpload || error instanceof InvalidInput
        ? error.message
        : "the file could not be read";
  return settle(db, ctx, versionId, {
    state: "FAILED",
    chunkCount: 0,
    pageCount: 0,
    locatorKind: null,
    note,
  });
}

/** The uploader's identity and scope, as the claim reported them. */
interface JobContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly surface: "job";
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}
