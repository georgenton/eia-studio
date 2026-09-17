import { storageSchema, templatesSchema } from "@eia/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createProvenanceRecord,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Isolation and immutability of the template library (ADR-036).
 *
 * A template is a consulting firm's own deliverable format — the thing that makes their report
 * look like theirs — and a generated document is a draft carrying that firm's client's figures.
 * Neither may be visible across a tenant or a project, and neither may be rewritten after the fact.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

const TEMPLATE_TABLES = [
  "report_template",
  "report_template_version",
  "generated_document",
] as const;

interface Seeded {
  readonly templateId: string;
  readonly versionId: string;
  readonly generatedId: string;
}

async function seedTemplates(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  code: string;
}): Promise<Seeded> {
  const provenance = await createProvenanceRecord(db.migrator, {
    tenantId: input.tenantId,
    projectId: input.projectId,
  });
  const templateId = randomUUID();
  await db.migrator.insert(templatesSchema.reportTemplate).values({
    id: templateId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    code: input.code,
    name: `Plantilla ${input.code}`,
    kind: "cover",
    purpose: "La portada que la consultora entrega con cada estudio de este programa.",
    createdByUserId: input.userId,
  });

  const templateObjectId = randomUUID();
  await db.migrator.insert(storageSchema.storedObject).values({
    id: templateObjectId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    namespace: "templates",
    objectKey: `t/${input.tenantId}/p/${input.projectId}/templates/${templateObjectId}`,
    originalFilename: `${input.code.toLowerCase()}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 4096,
    sha256: "a".repeat(64),
    uploadedByUserId: input.userId,
  });

  const versionId = randomUUID();
  await db.migrator.insert(templatesSchema.reportTemplateVersion).values({
    id: versionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    templateId,
    versionLabel: "v1",
    locale: "es-EC",
    state: "ACTIVE",
    storedObjectId: templateObjectId,
    fileSha256: "a".repeat(64),
    originalFilename: `${input.code.toLowerCase()}.docx`,
    sizeBytes: 4096,
    manifest: {
      supported: ["project.name", "generation.draft_banner"],
      unknown: [],
      required: ["project.name", "generation.draft_banner"],
      containers: [],
      tagCount: 2,
    },
    validatedAt: new Date(),
    activatedAt: new Date(),
    activatedByUserId: input.userId,
    uploadedByUserId: input.userId,
    provenanceId: provenance.id,
  });

  const generatedObjectId = randomUUID();
  await db.migrator.insert(storageSchema.storedObject).values({
    id: generatedObjectId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    namespace: "generated",
    objectKey: `t/${input.tenantId}/p/${input.projectId}/generated/${generatedObjectId}`,
    originalFilename: `${input.code}-v1-es-EC.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 5120,
    sha256: "b".repeat(64),
    uploadedByUserId: input.userId,
  });

  const generatedId = randomUUID();
  await db.migrator.insert(templatesSchema.generatedDocument).values({
    id: generatedId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    templateVersionId: versionId,
    reportVersionId: null,
    snapshotDigest: null,
    locale: "es-EC",
    storedObjectId: generatedObjectId,
    fileSha256: "b".repeat(64),
    sizeBytes: 5120,
    declaredAbsent: ["territory.corridor_length_km"],
    generatedByUserId: input.userId,
    provenanceId: provenance.id,
  });

  return { templateId, versionId, generatedId };
}

let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  a = await seedTemplates({
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    userId: w.memberA.id,
    code: "TPL-A",
  });
  b = await seedTemplates({
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    userId: w.ownerB.id,
    code: "TPL-B",
  });
});
afterAll(() => db.close());

const ctxA = (projectId: string | null = w.projectX.id) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});

describe("1 · a firm's template never crosses a tenant", () => {
  it("tenant A sees exactly its own rows", async () => {
    for (const table of TEMPLATE_TABLES) {
      expect(await countVisible(db.runtime, ctxA(), `app.${table}`), table).toBe(1);
    }
  });

  it("tenant B's template and its generated draft are invisible to tenant A", async () => {
    expect(
      await countVisible(db.runtime, ctxA(), "app.report_template", {
        column: "id",
        value: b.templateId,
      }),
    ).toBe(0);
    expect(
      await countVisible(db.runtime, ctxA(), "app.generated_document", {
        column: "id",
        value: b.generatedId,
      }),
    ).toBe(0);
  });

  it("a project inside the same tenant cannot see another project's templates", async () => {
    const ctx = ctxA(w.projectY.id);
    for (const table of TEMPLATE_TABLES) {
      expect(await countVisible(db.runtime, ctx, `app.${table}`), table).toBe(0);
    }
  });

  it("no context at all sees nothing", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    for (const table of TEMPLATE_TABLES) {
      expect(await countVisible(db.runtime, none, `app.${table}`), table).toBe(0);
    }
  });

  it("a forged insert naming another tenant is refused by the policy", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.report_template
            (id, tenant_id, project_id, code, name, kind, purpose)
          values (gen_random_uuid(), ${w.tenantB.id}, ${w.projectZ.id}, 'TPL-FORGED',
                  'Plantilla ajena', 'cover', 'No debe poder escribirse en otro inquilino.')
        `),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  /*
   * A generated document names who produced it. The insert policy adds `generated_by_user_id =
   * app.current_user_id()`, so a caller cannot record a draft as somebody else's work.
   */
  it("a generated document cannot be recorded in somebody else's name", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.generated_document
            (id, tenant_id, project_id, template_version_id, locale, stored_object_id,
             file_sha256, size_bytes, generated_by_user_id, provenance_id)
          select gen_random_uuid(), ${w.tenantA.id}, ${w.projectX.id}, ${a.versionId}, 'es-EC',
                 g.stored_object_id, repeat('c', 64), 1024, ${w.adminA.id}, g.provenance_id
            from app.generated_document g where g.id = ${a.generatedId}
        `),
      ),
    );
    expect(error).toBeTruthy();
  });
});

describe("2 · what was produced, and what produced it, are not rewritten", () => {
  it("refuses to change which file a template version is", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(
          sql`update app.report_template_version set version_label = 'v9' where id = ${a.versionId}`,
        ),
      ),
    );
    expect(error).toContain("cannot change");
  });

  it("refuses to re-manifest an activated version", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          update app.report_template_version set manifest = '{"supported":[],"unknown":[],"required":[],"containers":[],"tagCount":0}'::jsonb
           where id = ${a.versionId}
        `),
      ),
    );
    expect(error).toContain("settled");
  });

  it("refuses to edit or delete a generated document", async () => {
    const updated = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(
          sql`update app.generated_document set size_bytes = 1 where id = ${a.generatedId}`,
        ),
      ),
    );
    expect(updated).toBeTruthy();
    const deleted = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`delete from app.generated_document where id = ${a.generatedId}`),
      ),
    );
    expect(deleted).toBeTruthy();
  });

  it("the runtime role holds no DELETE on any of the three tables", async () => {
    for (const table of TEMPLATE_TABLES) {
      const result = await db.migrator.execute(sql`
        select has_table_privilege('eia_app', ${`app.${table}`}, 'DELETE') as allowed
      `);
      expect((result.rows[0] as { allowed: boolean }).allowed, table).toBe(false);
    }
  });

  it("only the version may be updated at all", async () => {
    for (const table of TEMPLATE_TABLES) {
      const result = await db.migrator.execute(sql`
        select has_table_privilege('eia_app', ${`app.${table}`}, 'UPDATE') as allowed
      `);
      expect((result.rows[0] as { allowed: boolean }).allowed, table).toBe(
        table === "report_template_version",
      );
    }
  });
});

describe("3 · the tenancy contract", () => {
  it("has FORCE row level security and the composite project foreign key", async () => {
    for (const table of TEMPLATE_TABLES) {
      const rls = await db.migrator.execute(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app' and c.relname = ${table}
      `);
      const row = rls.rows[0] as { enabled: boolean; forced: boolean };
      expect(row.enabled, table).toBe(true);
      expect(row.forced, table).toBe(true);

      const fk = await db.migrator.execute(sql`
        select count(*)::int as n from pg_constraint
         where conrelid = ${`app.${table}`}::regclass and contype = 'f'
           and confrelid = 'app.project'::regclass
      `);
      expect((fk.rows[0] as { n: number }).n, table).toBeGreaterThan(0);
    }
  });

  /*
   * The namespaces are not mixed: a delivered study, a firm's template and a generated draft are
   * three different things, and a query written for one must not reach another.
   */
  it("keeps templates and generated drafts in their own storage namespaces", async () => {
    const rows = await db.migrator.execute(sql`
      select distinct namespace::text as namespace from app.stored_object order by namespace
    `);
    const namespaces = (rows.rows as Array<{ namespace: string }>).map((row) => row.namespace);
    expect(namespaces).toEqual(["generated", "templates"]);
  });
});
