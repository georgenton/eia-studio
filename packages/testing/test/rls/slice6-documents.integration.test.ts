import { documentsSchema } from "@eia/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createProjectMembership,
  createProvenanceRecord,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Isolation of the document layer, and the one test this slice exists to pass.
 *
 * **Cross-tenant retrieval leakage is the critical failure.** A retriever is a query that takes
 * free text and returns document content; if its scope can be lost, the product hands one
 * consultancy another's study. So it is checked three ways: the tenant predicate, the project
 * predicate, and — the one that matters — the *same full-text query the retriever runs*, executed
 * under tenant A's context against text that only tenant B has.
 *
 * The second half is citation integrity. A chunk is what a citation points at, so it is never
 * updated and never deleted while its version stands.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provA: string;
let provB: string;
let versionA: string;
let versionB: string;

const DOCUMENT_TABLES = ["source_document", "document_version", "document_chunk"] as const;

/** The distinctive words each tenant's document contains, and the other's does not. */
const SECRET_A = "hidrocarburos";
const SECRET_B = "geotermia";

async function seedDocument(input: {
  tenantId: string;
  projectId: string;
  provenanceId: string;
  code: string;
  secret: string;
}): Promise<string> {
  const documentId = randomUUID();
  const versionId = randomUUID();
  await db.migrator.insert(documentsSchema.sourceDocument).values({
    id: documentId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    code: input.code,
    title: `Informe ${input.code}`,
    kind: "report",
  });
  await db.migrator.insert(documentsSchema.documentVersion).values({
    id: versionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    documentId,
    versionLabel: "v1",
    textSource: "RECONSTRUCTED_EXCERPT",
    sourceNote: "Extracto de prueba.",
    contentHash: `hash-${input.code}`,
    pageCount: 1,
    chunkCount: 1,
    chunkingStrategy: "paragraph-merge@1",
    provenanceId: input.provenanceId,
  });
  await db.migrator.insert(documentsSchema.documentChunk).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    projectId: input.projectId,
    versionId,
    ordinal: 0,
    pageFrom: 1,
    pageTo: 1,
    charFrom: 0,
    charTo: 60,
    text: `El estudio analiza el componente de ${input.secret} en el área de influencia.`,
    contentHash: `chunk-${input.code}`,
  });
  await db.migrator.execute(sql`
    update app.source_document set current_version_id = ${versionId}
     where tenant_id = ${input.tenantId} and id = ${documentId}
  `);
  return versionId;
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  provA = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantA.id, projectId: w.projectX.id })
  ).id;
  provB = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantB.id, projectId: w.projectZ.id })
  ).id;
  versionA = await seedDocument({
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provA,
    code: "DOC-001",
    secret: SECRET_A,
  });
  versionB = await seedDocument({
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provB,
    code: "DOC-001",
    secret: SECRET_B,
  });

  // A second project inside tenant A, so "project scope" is tested against a project the caller
  // *is* a member of the tenant of — the case a tenant predicate alone would not catch.
  await createProvenanceRecord(db.migrator, { tenantId: w.tenantA.id, projectId: w.projectY.id });
});
afterAll(() => db.close());

const ctxA = (projectId: string | null = w.projectX.id) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});

/** The retriever's own query, run under an arbitrary context. */
async function retrieve(
  ctx: { userId: string | null; tenantId: string | null; projectId: string | null },
  question: string,
  scope: { tenantId: string; projectId: string },
): Promise<ReadonlyArray<string>> {
  return asContext(db.runtime, ctx, async (tx) => {
    const result = await tx.execute(sql`
      with q as (select websearch_to_tsquery('spanish', ${question}) as tsq)
      select c.text
        from app.document_chunk c
        join q on true
        join app.document_version v on v.tenant_id = c.tenant_id and v.id = c.version_id
        join app.source_document d on d.tenant_id = v.tenant_id and d.id = v.document_id
       where c.tenant_id = ${scope.tenantId} and c.project_id = ${scope.projectId}
         and d.current_version_id = v.id and c.search @@ q.tsq
    `);
    return (result.rows as Array<{ text: string }>).map((row) => row.text);
  });
}

describe("1 · cross-tenant retrieval leakage", () => {
  it("tenant A retrieves its own document", async () => {
    const found = await retrieve(ctxA(), SECRET_A, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(SECRET_A);
  });

  it("tenant A can never retrieve tenant B's text, even asking for its exact words", async () => {
    // The critical test of this slice. Asking with tenant B's own distinctive term, under tenant
    // A's context, must return nothing — whichever scope the query claims.
    expect(
      await retrieve(ctxA(), SECRET_B, { tenantId: w.tenantA.id, projectId: w.projectX.id }),
    ).toHaveLength(0);
    // …and a forged scope naming tenant B is refused by the policy, not merely by the predicate.
    expect(
      await retrieve(ctxA(), SECRET_B, { tenantId: w.tenantB.id, projectId: w.projectZ.id }),
    ).toHaveLength(0);
  });

  it("a project cannot retrieve another project's text inside its own tenant", async () => {
    // Tenant A, project Y: the caller is in the tenant, so only the project predicate stands
    // between them and project X's documents.
    const ctx = { userId: w.memberA.id, tenantId: w.tenantA.id, projectId: w.projectY.id };
    expect(
      await retrieve(ctx, SECRET_A, { tenantId: w.tenantA.id, projectId: w.projectY.id }),
    ).toHaveLength(0);
    expect(
      await retrieve(ctx, SECRET_A, { tenantId: w.tenantA.id, projectId: w.projectX.id }),
    ).toHaveLength(0);
  });

  it("no context at all retrieves nothing", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    expect(
      await retrieve(none, SECRET_A, { tenantId: w.tenantA.id, projectId: w.projectX.id }),
    ).toHaveLength(0);
    for (const table of DOCUMENT_TABLES) {
      expect(await countVisible(db.runtime, none, `app.${table}`), table).toBe(0);
    }
  });

  it("every document table is empty for a tenant that owns none of it", async () => {
    for (const table of DOCUMENT_TABLES) {
      const visible = await asContext(db.runtime, ctxA(), async (tx) => {
        const result = await tx.execute(
          sql`select count(*)::int as n from ${sql.raw(`app.${table}`)} where tenant_id = ${w.tenantB.id}`,
        );
        return (result.rows[0] as { n: number }).n;
      });
      expect(visible, table).toBe(0);
    }
  });

  it("a forged tenant_id on insert is refused by the write policy", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.insert(documentsSchema.sourceDocument).values({
          id: randomUUID(),
          tenantId: w.tenantB.id,
          projectId: w.projectZ.id,
          code: "DOC-900",
          title: "Smuggled",
          kind: "other",
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it("a user with no project membership sees no documents at all", async () => {
    const outsider = await createUser(db.migrator, "doc-outsider");
    const membership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: outsider.id,
      role: "MEMBER",
    });
    const ctx = { userId: outsider.id, tenantId: w.tenantA.id, projectId: w.projectX.id };
    expect(
      await retrieve(ctx, SECRET_A, { tenantId: w.tenantA.id, projectId: w.projectX.id }),
    ).toHaveLength(0);

    await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: membership.id,
      role: "VIEWER",
    });
    expect(
      await retrieve(ctx, SECRET_A, { tenantId: w.tenantA.id, projectId: w.projectX.id }),
    ).toHaveLength(1);
  });
});

describe("2 · a citation's target never moves", () => {
  it("the runtime role cannot update a chunk", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(
          sql`update app.document_chunk set text = 'reescrito' where tenant_id = ${w.tenantA.id}`,
        ),
      ),
    );
    expect(error).toMatch(/permission denied|document_chunk_immutable/i);
  });

  it("the runtime role cannot delete one", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`delete from app.document_chunk where tenant_id = ${w.tenantA.id}`),
      ),
    );
    expect(error).toMatch(/permission denied|document_chunk_immutable/i);
  });

  it("not even the owning role can, because the trigger has no role condition", async () => {
    expect(
      await attempt(
        db.migrator.execute(
          sql`update app.document_chunk set text = 'reescrito' where tenant_id = ${w.tenantA.id}`,
        ),
      ),
    ).toMatch(/document_chunk_immutable/);
    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.document_chunk where version_id = ${versionA}`),
      ),
    ).toMatch(/document_chunk_immutable/);
  });

  it("deleting the version takes its chunks with it, which is the one legitimate route", async () => {
    // The cascade is how a document is removed wholesale. `pg_trigger_depth() = 0` on the delete
    // trigger is what distinguishes it from someone deleting one passage out from under a citation.
    const scratchProv = await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
    });
    const scratch = await seedDocument({
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: scratchProv.id,
      code: "DOC-777",
      secret: "efimero",
    });
    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.document_version where id = ${scratch}`),
      ),
    ).toBeNull();
    const left = await db.migrator.execute(
      sql`select count(*)::int as n from app.document_chunk where version_id = ${scratch}`,
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("3 · uniqueness, provenance and forced RLS", () => {
  it("a document code is unique per project, and both tenants may use the same one", async () => {
    const both = await db.migrator.execute(
      sql`select count(*)::int as n from app.source_document where code = 'DOC-001'`,
    );
    expect((both.rows[0] as { n: number }).n).toBe(2);
    expect(
      await attempt(
        db.migrator.insert(documentsSchema.sourceDocument).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          code: "DOC-001",
          title: "Duplicate",
          kind: "other",
        }),
      ),
    ).toMatch(/source_document_project_code_key/);
  });

  it("a version cannot borrow another tenant's provenance record", async () => {
    expect(
      await attempt(
        db.migrator.insert(documentsSchema.documentVersion).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          documentId: (
            await db.migrator.execute(
              sql`select id from app.source_document where tenant_id = ${w.tenantA.id} limit 1`,
            )
          ).rows[0]!.id as string,
          versionLabel: "v9",
          textSource: "RECONSTRUCTED_EXCERPT",
          sourceNote: "x",
          contentHash: "x",
          pageCount: 1,
          chunkCount: 0,
          chunkingStrategy: "paragraph-merge@1",
          provenanceId: provB,
        }),
      ),
    ).toMatch(/document_version_provenance_fk|violates foreign key/);
  });

  it("every document table forces row level security", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = any(${sql.raw(
         `ARRAY[${DOCUMENT_TABLES.map((t) => `'${t}'`).join(",")}]`,
       )})
       order by 1
    `);
    const rows = result.rows as Array<{ table: string; enabled: boolean; forced: boolean }>;
    expect(rows).toHaveLength(DOCUMENT_TABLES.length);
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
    }
  });

  it("there is no embedding column and no vec schema (ADR-021)", async () => {
    // A vector filled by a stand-in is indistinguishable from a real one. Asserted here so that
    // adding pgvector later is a deliberate act that has to come past this test.
    const columns = await db.migrator.execute(sql`
      select column_name from information_schema.columns
       where table_schema = 'app' and table_name = 'document_chunk'
    `);
    const names = (columns.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    expect(names).toContain("search");
    expect(names).not.toContain("embedding");

    const schemas = await db.migrator.execute(
      sql`select nspname from pg_namespace where nspname = 'vec'`,
    );
    expect(schemas.rows).toHaveLength(0);
  });
});

describe("4 · a quality assertion may cite a real passage, and only a whole one", () => {
  it("naming a chunk without its version is refused", async () => {
    const chunk = await db.migrator.execute(
      sql`select id from app.document_chunk where tenant_id = ${w.tenantA.id} limit 1`,
    );
    expect(
      await attempt(
        db.migrator.execute(sql`
          insert into app.document_assertion
            (id, tenant_id, project_id, key, source_kind, source_ref, value_number, chunk_id,
             provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'half.citation',
                  'RECONSTRUCTED_CORPUS', 'x', 1, ${(chunk.rows[0] as { id: string }).id}, ${provA})
        `),
      ),
    ).toMatch(/document_assertion_citation_is_real/);
  });

  it("claiming extraction from a document without naming one is refused", async () => {
    expect(
      await attempt(
        db.migrator.execute(sql`
          insert into app.document_assertion
            (id, tenant_id, project_id, key, source_kind, source_ref, value_number, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'unnamed.source',
                  'DOCUMENT_VERSION', 'x', 1, ${provA})
        `),
      ),
    ).toMatch(/document_assertion_citation_is_real/);
  });

  it("a hand transcription that names the version and the passage is allowed", async () => {
    // The pilot's whole corpus. Acquiring a link does not turn a transcription into an extraction,
    // and `source_kind` keeps saying which it was.
    const chunk = await db.migrator.execute(
      sql`select id from app.document_chunk where tenant_id = ${w.tenantA.id} and version_id = ${versionA} limit 1`,
    );
    expect(
      await attempt(
        db.migrator.execute(sql`
          insert into app.document_assertion
            (id, tenant_id, project_id, key, source_kind, source_ref, value_number,
             document_version_id, chunk_id, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'linked.transcription',
                  'RECONSTRUCTED_CORPUS', 'Informe', 1, ${versionA},
                  ${(chunk.rows[0] as { id: string }).id}, ${provA})
        `),
      ),
    ).toBeNull();
  });

  it("an assertion cannot point at another tenant's version", async () => {
    expect(
      await attempt(
        db.migrator.execute(sql`
          insert into app.document_assertion
            (id, tenant_id, project_id, key, source_kind, source_ref, value_number,
             document_version_id, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'foreign.version',
                  'DOCUMENT_VERSION', 'x', 1, ${versionB}, ${provA})
        `),
      ),
    ).toMatch(/document_assertion_version_fk|violates foreign key/);
  });
});
