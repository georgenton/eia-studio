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
 * The management plan: isolation, the one-active-run rule, and the shape the document forced
 * (ADR-024).
 *
 * A PGAS chapter names institutions and roles — *Contratista*, *Fiscalizador*, *GAD Municipal* —
 * and no individuals, so it is tempting to treat these three tables as public reference data. They
 * are not: what a firm proposes to do about an impact is its work product, and it gets the same
 * three-part predicate as every other project-scoped table.
 *
 * The rest of this file tests what the delivered document made true: a plan with no code is stored,
 * a `N°` that repeats is stored twice, a revision supersedes rather than overwrites, and nothing
 * anywhere can record that a measure was complied with.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provA: string;
let provB: string;
let runA: string;
let planA: string;

const ctxA = (projectId: string | null = null) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId: projectId ?? w.projectX.id,
});

/** `sql` interpolates a JS array as a tuple, so an array column needs a literal and a cast. */
const pgArray = (values: ReadonlyArray<string>): string =>
  `{${values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

const HEADINGS = [
  "N°",
  "ASPECTO AMBIENTAL",
  "IMPACTO IDENTIFICADO",
  "MEDIDAS PROPUESTAS",
  "INDICADORES",
  "MEDIO DE VERIFICACIÓN",
  "RESPONSABLE",
  "FRENCUENCIA",
  "PLAZO",
];

async function insertRun(
  tenantId: string,
  projectId: string,
  provenanceId: string,
  sha256: string,
  isActive = true,
) {
  const id = randomUUID();
  await db.migrator.execute(sql`
    insert into app.pgas_import_run
      (id, tenant_id, project_id, source_file, source_sha256, plan_count, measure_count,
       imported_at, is_active, provenance_id)
    values (${id}, ${tenantId}, ${projectId}, 'cap-11-pgas.docx', ${sha256}, 1, 1, now(),
            ${isActive}, ${provenanceId})
  `);
  return id;
}

async function insertPlan(
  tenantId: string,
  projectId: string,
  runId: string,
  over: { ordinal?: number; code?: string | null; title?: string } = {},
) {
  const id = randomUUID();
  await db.migrator.execute(sql`
    insert into app.pgas_plan
      (id, tenant_id, project_id, import_run_id, ordinal, code, title, objective, place,
       column_headings)
    values (${id}, ${tenantId}, ${projectId}, ${runId}, ${over.ordinal ?? 1},
            ${over.code === undefined ? "PPMI-01" : over.code},
            ${over.title ?? "PLAN DE PREVENCIÓN Y MITIGACIÓN DE IMPACTOS"},
            'OBJETIVO: Implementar acciones y medidas de prevención.', null,
            ${pgArray(HEADINGS)}::text[])
  `);
  return id;
}

async function insertMeasure(
  tenantId: string,
  projectId: string,
  planId: string,
  over: { ordinal?: number; code?: string; statedNumber?: string } = {},
) {
  const id = randomUUID();
  await db.migrator.execute(sql`
    insert into app.pgas_measure
      (id, tenant_id, project_id, plan_id, ordinal, measure_code, stated_number, programme_title,
       programme_ordinal, aspect, impact, measure, indicator, verification, responsible,
       frequency, deadline)
    values (${id}, ${tenantId}, ${projectId}, ${planId}, ${over.ordinal ?? 1},
            ${over.code ?? "PPMI-01.01.01"}, ${over.statedNumber ?? "01"},
            'PROGRAMA DE MANEJO DE PRODUCTOS QUÍMICOS', 1,
            'Uso de productos químicos', 'Alteración de la calidad del suelo',
            'Almacenar en área impermeabilizada y con cubeto de contención.',
            '(áreas con cubeto / áreas de almacenamiento) × 100',
            'Registro fotográfico', 'Contratista', 'Mensual', '1 año')
  `);
  return id;
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

  runA = await insertRun(w.tenantA.id, w.projectX.id, provA, "a".repeat(64));
  planA = await insertPlan(w.tenantA.id, w.projectX.id, runA);
  await insertMeasure(w.tenantA.id, w.projectX.id, planA);

  const runB = await insertRun(w.tenantB.id, w.projectZ.id, provB, "b".repeat(64));
  const planB = await insertPlan(w.tenantB.id, w.projectZ.id, runB);
  await insertMeasure(w.tenantB.id, w.projectZ.id, planB);
});

afterAll(() => db.close());

describe("the management plan is isolated like every other project-scoped table", () => {
  it("a member of tenant A sees A's plan and none of B's", async () => {
    for (const table of ["app.pgas_import_run", "app.pgas_plan", "app.pgas_measure"]) {
      expect(await countVisible(db.runtime, ctxA(), table), table).toBe(1);
    }
    const asB = { userId: w.memberA.id, tenantId: w.tenantB.id, projectId: w.projectZ.id };
    for (const table of ["app.pgas_import_run", "app.pgas_plan", "app.pgas_measure"]) {
      expect(await countVisible(db.runtime, asB, table), table).toBe(0);
    }
  });

  it("no context at all sees nothing", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    for (const table of ["app.pgas_import_run", "app.pgas_plan", "app.pgas_measure"]) {
      expect(await countVisible(db.runtime, none, table), table).toBe(0);
    }
  });

  it("a forged tenant_id is refused on write, not merely hidden on read", async () => {
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.pgas_import_run
            (id, tenant_id, project_id, source_file, source_sha256, plan_count, measure_count,
             imported_at, is_active, provenance_id)
          values (${randomUUID()}, ${w.tenantB.id}, ${w.projectZ.id}, 'robado.docx',
                  ${"c".repeat(64)}, 1, 1, now(), false, ${provB})
        `),
      ),
    );
    expect(probe).toMatch(RLS_VIOLATION);
  });

  it("a measure cannot be attached to another tenant's plan", async () => {
    const foreignPlan = (
      await db.migrator.execute(sql`
        select id from app.pgas_plan where tenant_id = ${w.tenantB.id} limit 1
      `)
    ).rows[0] as { id: string };
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.pgas_measure
            (id, tenant_id, project_id, plan_id, ordinal, measure_code, programme_ordinal, measure)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${foreignPlan.id}, 9,
                  'PPMI-01.09.09', 1, 'Medida robada')
        `),
      ),
    );
    // The composite foreign key refuses it before RLS has to; either answer is a refusal.
    expect(probe).toMatch(/pgas_measure_plan_fk|row-level security/i);
  });

  it("row level security is enabled and FORCEd on all three tables", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r' and c.relname like 'pgas\\_%'
       order by 1
    `);
    expect(result.rows).toEqual([
      { table: "pgas_import_run", enabled: true, forced: true, policies: 2 },
      { table: "pgas_measure", enabled: true, forced: true, policies: 2 },
      { table: "pgas_plan", enabled: true, forced: true, policies: 2 },
    ]);
  });
});

describe("a revision supersedes; it does not overwrite", () => {
  it("refuses a second active run, so no project has two plans claiming to be the plan", async () => {
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.pgas_import_run
            (id, tenant_id, project_id, source_file, source_sha256, plan_count, measure_count,
             imported_at, is_active, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'cap-11-rev2.docx',
                  ${"d".repeat(64)}, 9, 86, now(), true, ${provA})
        `),
      ),
    );
    expect(probe).toMatch(/pgas_import_run_one_active/);
  });

  it("keeps the superseded run and its measures queryable", async () => {
    const oldRun = await insertRun(
      w.tenantA.id,
      w.projectX.id,
      provA,
      "e".repeat(64),
      /* isActive */ false,
    );
    const oldPlan = await insertPlan(w.tenantA.id, w.projectX.id, oldRun, {
      code: "PPMI-01",
      title: "PLAN DE PREVENCIÓN Y MITIGACIÓN DE IMPACTOS (v1)",
    });
    await insertMeasure(w.tenantA.id, w.projectX.id, oldPlan);

    const counts = await asContext(db.runtime, ctxA(), (tx) =>
      tx.execute(sql`
        select count(*) filter (where is_active)::int as active,
               count(*)::int as total
          from app.pgas_import_run
      `),
    );
    expect(counts.rows[0]).toEqual({ active: 1, total: 2 });
    // A figure quoted from last month's plan must still be explainable.
    expect(await countVisible(db.runtime, ctxA(), "app.pgas_measure")).toBe(2);
  });

  it("refuses a hash that is not a hash, because the hash is what identifies a delivery", async () => {
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.pgas_import_run
            (id, tenant_id, project_id, source_file, source_sha256, plan_count, measure_count,
             imported_at, is_active, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'cap-11.docx',
                  'sin-hash', 1, 1, now(), false, ${provA})
        `),
      ),
    );
    expect(probe).toMatch(/pgas_import_run_sha256_shape/);
  });
});

describe("the document's own shape survives storage", () => {
  it("stores a plan with no code, which the delivered chapter has exactly one of", async () => {
    const probe = await attempt(
      insertPlan(w.tenantA.id, w.projectX.id, runA, {
        ordinal: 5,
        code: null,
        title: "5. PLAN DE SEGURIDAD INDUSTRIAL Y SALUD OCUPACIONAL",
      }),
    );
    expect(probe).toBeNull();
  });

  it("stores the same stated number twice, because the chapter uses 01 in nine plans", async () => {
    const probe = await attempt(
      insertMeasure(w.tenantA.id, w.projectX.id, planA, {
        ordinal: 2,
        code: "PPMI-01.01.02",
        statedNumber: "01",
      }),
    );
    expect(probe).toBeNull();
    const repeated = await db.migrator.execute(sql`
      select count(*)::int as n from app.pgas_measure
       where tenant_id = ${w.tenantA.id} and plan_id = ${planA} and stated_number = '01'
    `);
    expect((repeated.rows[0] as { n: number }).n).toBe(2);
  });

  it("refuses two measures wearing the same minted code, which is ours and must be unique", async () => {
    const probe = await attempt(
      insertMeasure(w.tenantA.id, w.projectX.id, planA, { ordinal: 3, code: "PPMI-01.01.01" }),
    );
    expect(probe).toMatch(/pgas_measure_code_unique/);
  });

  it("refuses a row that states nothing at all, which is a parsing failure, not a measure", async () => {
    const probe = await attempt(
      db.migrator.execute(sql`
        insert into app.pgas_measure
          (id, tenant_id, project_id, plan_id, ordinal, measure_code, programme_ordinal,
           aspect, impact, measure)
        values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${planA}, 90,
                'PPMI-01.01.90', 1, '   ', '', null)
      `),
    );
    expect(probe).toMatch(/pgas_measure_not_entirely_empty/);
  });

  it("refuses a plan with fewer than eight headings, which is not this matrix", async () => {
    const probe = await attempt(
      db.migrator.execute(sql`
        insert into app.pgas_plan
          (id, tenant_id, project_id, import_run_id, ordinal, code, title, column_headings)
        values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${runA}, 91, 'X-01',
                'PLAN CON DOS COLUMNAS', ${pgArray(["N°", "MEDIDA"])}::text[])
      `),
    );
    expect(probe).toMatch(/pgas_plan_headings_present/);
  });
});

/**
 * ADR-024 §7: this chapter proposes measures for a road that has not been built. A column that
 * could hold "cumplida" would let a screen assert that somebody is executing the plan, which is
 * the claim invariant 11 exists to prevent — so the assertion is against the schema itself.
 */
describe("nothing here can record compliance", () => {
  it("no pgas column names execution, evidence or a compliance state", async () => {
    const result = await db.migrator.execute(sql`
      select table_name, column_name from information_schema.columns
       where table_schema = 'app' and table_name like 'pgas_%'
       order by 1, 2
    `);
    const columns = result.rows as Array<{ table_name: string; column_name: string }>;
    expect(columns.length).toBeGreaterThan(20);
    for (const { table_name, column_name } of columns) {
      expect(column_name, `app.${table_name}.${column_name}`).not.toMatch(
        /complian|cumpl|conform|evidence|evidencia|obligation|fulfil|executed|ejecut|verified_at/i,
      );
    }
  });
});
