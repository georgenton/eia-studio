import { type DbTx } from "@eia/db";
import {
  retrievalQuerySchema,
  type DocumentRetriever,
  type RetrievalQuery,
  type RetrievalResult,
  type RetrievedPassage,
} from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * The shipped retriever: PostgreSQL full-text search over `document_chunk` (ADR-021).
 *
 * ## Why the scope is passed in rather than read from the query
 *
 * The tenant and project come from a verified `RequestContext` and are bound into the SQL. The
 * row-level policies apply underneath as well, so a retriever that ignored them would still return
 * nothing from another project — two layers, one failure still safe (TENANCY.md §4). This is the
 * isolation SECURITY.md §8 requires of retrieval, and it is why there is no "search everything"
 * code path to accidentally call.
 *
 * ## Why `websearch_to_tsquery`
 *
 * It takes what a person actually types — words, quoted phrases, `-excluded` — and never throws on
 * malformed input, which `to_tsquery` does. A question is user text; a retriever that can be
 * crashed by a stray parenthesis is a retriever that will be.
 *
 * The score is `ts_rank_cd`, comparable only within one result set. It is never rendered as a
 * percentage and never called relevance: the surface says these passages contain these words.
 */
export class FullTextRetriever implements DocumentRetriever {
  readonly strategy = "full-text" as const;

  constructor(
    private readonly tx: DbTx,
    private readonly scope: { readonly tenantId: string; readonly projectId: string },
  ) {}

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const parsed = retrievalQuerySchema.parse(query);
    const result = await this.tx.execute(sql`
      with q as (select websearch_to_tsquery('spanish', ${parsed.question}) as tsq)
      select c.id            as chunk_id,
             c.ordinal       as ordinal,
             c.page_from     as page_from,
             c.page_to       as page_to,
             c.text          as text,
             v.id            as version_id,
             v.version_label as version_label,
             d.id            as document_id,
             d.code          as document_code,
             d.title         as document_title,
             ts_rank_cd(c.search, q.tsq) as score
        from app.document_chunk c
        join q on true
        join app.document_version v on v.tenant_id = c.tenant_id and v.id = c.version_id
        join app.source_document d on d.tenant_id = v.tenant_id and d.id = v.document_id
       where c.tenant_id = ${this.scope.tenantId}
         and c.project_id = ${this.scope.projectId}
         -- Only the current version of each document is searched. Superseded versions stay
         -- readable so old citations resolve, but a question about the project should not be
         -- answered from text a corrected file replaced.
         and d.current_version_id = v.id
         ${parsed.documentId ? sql`and d.id = ${parsed.documentId}` : sql``}
         and c.search @@ q.tsq
       order by score desc, d.code, c.ordinal
       limit ${parsed.limit}
    `);

    const passages = (result.rows as unknown as RawPassage[]).map(toPassage);
    return { strategy: this.strategy, passages };
  }
}

interface RawPassage {
  chunk_id: string;
  ordinal: number;
  page_from: number;
  page_to: number;
  text: string;
  version_id: string;
  version_label: string;
  document_id: string;
  document_code: string;
  document_title: string;
  score: number | string;
}

function toPassage(row: RawPassage): RetrievedPassage {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentCode: row.document_code,
    documentTitle: row.document_title,
    documentVersionId: row.version_id,
    versionLabel: row.version_label,
    ordinal: Number(row.ordinal),
    pageFrom: Number(row.page_from),
    pageTo: Number(row.page_to),
    text: row.text,
    score: Number(row.score),
  };
}
