import { reportsSchema } from "@eia/db";
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
 * Isolation and immutability of the report tables.
 *
 * A chapter is the most portable artefact this product makes — it leaves as a Word file — so the
 * two questions are whose data it can contain, and whether what it said can change afterwards.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provA: string;
let provB: string;
let versionA: string;

const REPORT_TABLES = [
  "generated_report",
  "report_section",
  "report_section_source",
  "report_version",
] as const;

const snapshotFor = (project: string) => ({
  kind: "social_chapter",
  computedAt: new Date().toISOString(),
  projectName: project,
  surveyVersionLabel: "v1",
  regimes: ["HISTORICAL_OBSERVED"],
  sections: [
    {
      key: "universe",
      title: "Universo y cobertura",
      ordinal: 0,
      summary: "Cobertura del levantamiento.",
      facts: [
        {
          key: "submitted",
          label: "Fichas enviadas",
          value: "70",
          basis: null,
          source: { kind: "metric", metric: "field.instances_submitted", method: "Conteo." },
        },
      ],
    },
  ],
});

async function seedReport(input: {
  tenantId: string;
  projectId: string;
  provenanceId: string;
  userId: string;
  projectName: string;
}): Promise<string> {
  const reportId = randomUUID();
  const versionId = randomUUID();
  const sectionId = randomUUID();
  await db.migrator.insert(reportsSchema.generatedReport).values({
    id: reportId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    kind: "social_chapter",
    title: `Capítulo social — ${input.projectName}`,
  });
  await db.migrator.insert(reportsSchema.reportVersion).values({
    id: versionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    reportId,
    versionLabel: "v1",
    snapshot: snapshotFor(input.projectName),
    snapshotDigest: `digest-${input.projectName}`,
    surveyVersionLabel: "v1",
    generatedByUserId: input.userId,
    provenanceId: input.provenanceId,
  });
  await db.migrator.insert(reportsSchema.reportSection).values({
    id: sectionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    versionId,
    key: "universe",
    title: "Universo y cobertura",
    ordinal: 0,
    summary: "Cobertura del levantamiento.",
  });
  await db.migrator.insert(reportsSchema.reportSectionSource).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    projectId: input.projectId,
    sectionId,
    kind: "metric",
    factKey: "submitted",
    locator: { kind: "metric", metric: "field.instances_submitted", method: "Conteo." },
    ordinal: 0,
  });
  await db.migrator.execute(sql`
    update app.generated_report set current_version_id = ${versionId}
     where tenant_id = ${input.tenantId} and id = ${reportId}
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
  versionA = await seedReport({
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provA,
    userId: w.memberA.id,
    projectName: "Proyecto A",
  });
  await seedReport({
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provB,
    userId: w.ownerB.id,
    projectName: "Proyecto B",
  });
});
afterAll(() => db.close());

const ctxA = (projectId: string | null = w.projectX.id) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});

describe("1 · a chapter never contains another tenant's data", () => {
  it("every report table is empty for a tenant that owns none of it", async () => {
    for (const table of REPORT_TABLES) {
      const visible = await asContext(db.runtime, ctxA(), async (tx) => {
        const result = await tx.execute(
          sql`select count(*)::int as n from ${sql.raw(`app.${table}`)} where tenant_id = ${w.tenantB.id}`,
        );
        return (result.rows[0] as { n: number }).n;
      });
      expect(visible, table).toBe(0);
    }
  });

  it("the other tenant's snapshot is not readable, even by name", async () => {
    const found = await asContext(db.runtime, ctxA(), async (tx) => {
      const result = await tx.execute(sql`
        select count(*)::int as n from app.report_version
         where snapshot->>'projectName' = 'Proyecto B'
      `);
      return (result.rows[0] as { n: number }).n;
    });
    expect(found).toBe(0);
  });

  it("a forged tenant_id on insert is refused", async () => {
    expect(
      await attempt(
        asContext(db.runtime, ctxA(), (tx) =>
          tx.insert(reportsSchema.generatedReport).values({
            id: randomUUID(),
            tenantId: w.tenantB.id,
            projectId: w.projectZ.id,
            kind: "social_chapter",
            title: "Smuggled",
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
  });

  it("no context at all sees nothing", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    for (const table of REPORT_TABLES) {
      expect(await countVisible(db.runtime, none, `app.${table}`), table).toBe(0);
    }
  });

  it("a user with no project membership sees no chapter", async () => {
    const outsider = await createUser(db.migrator, "report-outsider");
    const membership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: outsider.id,
      role: "MEMBER",
    });
    const ctx = { userId: outsider.id, tenantId: w.tenantA.id, projectId: w.projectX.id };
    for (const table of REPORT_TABLES) {
      expect(await countVisible(db.runtime, ctx, `app.${table}`), table).toBe(0);
    }
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: membership.id,
      role: "COORDINATOR",
    });
    expect(await countVisible(db.runtime, ctx, "app.report_version")).toBe(1);
  });
});

describe("2 · a version keeps saying what it said", () => {
  it("the runtime role cannot update a version, a section or a source", async () => {
    for (const statement of [
      sql`update app.report_version set survey_version_label = 'x' where tenant_id = ${w.tenantA.id}`,
      sql`update app.report_section set narrative = 'x' where tenant_id = ${w.tenantA.id}`,
      sql`update app.report_section_source set fact_key = 'x' where tenant_id = ${w.tenantA.id}`,
    ]) {
      const error = await attempt(asContext(db.runtime, ctxA(), (tx) => tx.execute(statement)));
      expect(error).toMatch(/permission denied|report_version_immutable/i);
    }
  });

  it("the runtime role cannot delete one either", async () => {
    for (const statement of [
      sql`delete from app.report_version where tenant_id = ${w.tenantA.id}`,
      sql`delete from app.report_section where tenant_id = ${w.tenantA.id}`,
      sql`delete from app.report_section_source where tenant_id = ${w.tenantA.id}`,
    ]) {
      const error = await attempt(asContext(db.runtime, ctxA(), (tx) => tx.execute(statement)));
      expect(error).toMatch(/permission denied|report_version_immutable/i);
    }
  });

  it("not even the owning role can, because the trigger has no role condition", async () => {
    expect(
      await attempt(
        db.migrator.execute(
          sql`update app.report_version set snapshot_digest = 'tampered' where id = ${versionA}`,
        ),
      ),
    ).toMatch(/report_version_immutable/);
    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.report_version where id = ${versionA}`),
      ),
    ).toMatch(/report_version_immutable/);
  });

  it("deleting the report takes its versions with it, which is the one legitimate route", async () => {
    const scratchProv = await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
    });
    await seedReport({
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      provenanceId: scratchProv.id,
      userId: w.memberA.id,
      projectName: "Proyecto efímero",
    });
    expect(
      await attempt(
        db.migrator.execute(sql`
          delete from app.generated_report
           where tenant_id = ${w.tenantA.id} and project_id = ${w.projectY.id}
        `),
      ),
    ).toBeNull();
    const left = await db.migrator.execute(sql`
      select count(*)::int as n from app.report_version where project_id = ${w.projectY.id}
    `);
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("3 · uniqueness, provenance and forced RLS", () => {
  it("a project has one chapter of each kind; its history is its versions", async () => {
    expect(
      await attempt(
        db.migrator.insert(reportsSchema.generatedReport).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          kind: "social_chapter",
          title: "Duplicate",
        }),
      ),
    ).toMatch(/generated_report_project_kind_key/);
  });

  it("a version cannot borrow another tenant's provenance record", async () => {
    const reportId = (
      await db.migrator.execute(
        sql`select id from app.generated_report where tenant_id = ${w.tenantA.id} limit 1`,
      )
    ).rows[0]!.id as string;
    expect(
      await attempt(
        db.migrator.insert(reportsSchema.reportVersion).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          reportId,
          versionLabel: "v9",
          snapshot: snapshotFor("Proyecto A"),
          snapshotDigest: "x",
          surveyVersionLabel: "v1",
          generatedByUserId: w.memberA.id,
          provenanceId: provB,
        }),
      ),
    ).toMatch(/report_version_provenance_fk|violates foreign key/);
  });

  it("every report table forces row level security", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = any(${sql.raw(
         `ARRAY[${REPORT_TABLES.map((t) => `'${t}'`).join(",")}]`,
       )})
       order by 1
    `);
    const rows = result.rows as Array<{ table: string; enabled: boolean; forced: boolean }>;
    expect(rows).toHaveLength(REPORT_TABLES.length);
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
    }
  });
});
