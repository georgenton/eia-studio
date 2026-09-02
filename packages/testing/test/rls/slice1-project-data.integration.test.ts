import { appSchema } from "@eia/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  affectedRows,
  asContext,
  attempt,
  countVisible,
  createMetricSnapshot,
  createProvenanceRecord,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Isolation of the Slice 1 project-data tables (metric snapshots, forecasts, attention, activity
 * and provenance). These carry operational data, so their policies use `has_project_access`:
 * explicit project membership or OWNER implicit access. A tenant ADMIN administers the project
 * but must not read its data (D-015) — that rule is asserted here at the database level, where
 * no application bug can weaken it.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provA: string;
let provB: string;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  provA = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "HISTORICAL_OBSERVED",
      title: "Cifra histórica del proyecto X",
    })
  ).id;
  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provA,
  });
  provB = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantB.id, projectId: w.projectZ.id })
  ).id;
  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provB,
  });
  // Project Y belongs to tenant A but memberA is not assigned to it.
  const provY = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
    })
  ).id;
  await createMetricSnapshot(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectY.id,
    provenanceId: provY,
  });
});
afterAll(() => db.close());

const memberA = (projectId: string | null) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});
const adminA = (projectId: string | null) => ({
  userId: w.adminA.id,
  tenantId: w.tenantA.id,
  projectId,
});
const ownerA = (projectId: string | null) => ({
  userId: w.ownerA.id,
  tenantId: w.tenantA.id,
  projectId,
});

const TABLES = ["app.provenance_record", "app.metric_snapshot"] as const;

describe("Slice 1 · cross-tenant isolation of project data", () => {
  it("a member of tenant A sees no row of tenant B in any new table", async () => {
    for (const table of TABLES) {
      expect(
        await countVisible(db.runtime, memberA(w.projectX.id), table, {
          column: "tenant_id",
          value: w.tenantB.id,
        }),
        table,
      ).toBe(0);
    }
  });

  it("a member sees the data of the project they are assigned to", async () => {
    expect(
      await countVisible(db.runtime, memberA(w.projectX.id), "app.metric_snapshot"),
    ).toBeGreaterThan(0);
  });

  it("a member sees no data of a project in the same tenant they are not assigned to", async () => {
    // Tenant-scope listing (the Portfolio): policies still re-check access per row.
    expect(
      await countVisible(db.runtime, memberA(null), "app.metric_snapshot", {
        column: "project_id",
        value: w.projectY.id,
      }),
    ).toBe(0);
    expect(await countVisible(db.runtime, memberA(w.projectY.id), "app.metric_snapshot")).toBe(0);
  });

  it("D-015: a tenant ADMIN without a project membership reads no project data", async () => {
    expect(await countVisible(db.runtime, adminA(null), "app.metric_snapshot")).toBe(0);
    expect(await countVisible(db.runtime, adminA(null), "app.provenance_record")).toBe(0);
    expect(await countVisible(db.runtime, adminA(w.projectX.id), "app.metric_snapshot")).toBe(0);
  });

  it("D-015: a tenant OWNER reads project data through implicit access", async () => {
    expect(
      await countVisible(db.runtime, ownerA(w.projectX.id), "app.metric_snapshot"),
    ).toBeGreaterThan(0);
    expect(
      await countVisible(db.runtime, ownerA(w.projectY.id), "app.metric_snapshot"),
    ).toBeGreaterThan(0);
  });

  it("a forged project_id in the context does not widen access", async () => {
    // memberA claims project Y (not assigned) while its tenant context is genuine.
    expect(await countVisible(db.runtime, memberA(w.projectY.id), "app.provenance_record")).toBe(0);
    // …and claims a project of tenant B.
    expect(await countVisible(db.runtime, memberA(w.projectZ.id), "app.metric_snapshot")).toBe(0);
  });

  it("without any context every new table is empty", async () => {
    for (const table of TABLES) {
      expect(
        await countVisible(db.runtime, { userId: null, tenantId: null, projectId: null }, table),
        table,
      ).toBe(0);
    }
  });
});

describe("Slice 1 · cross-tenant mutation is rejected", () => {
  it("inserting a provenance record into another tenant is denied by WITH CHECK", async () => {
    const error = await attempt(
      asContext(db.runtime, memberA(w.projectX.id), (tx) =>
        tx.insert(appSchema.provenanceRecord).values({
          id: randomUUID(),
          tenantId: w.tenantB.id,
          projectId: w.projectZ.id,
          regime: "DEMO_SIMULATION",
          origin: "SYSTEM_GENERATED",
          transformations: ["ORIGINAL"],
          granularity: "AGGREGATE",
          title: "forged",
          note: "forged",
          validationState: "PENDING",
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it("inserting a metric into an unassigned project of the same tenant is denied", async () => {
    const error = await attempt(
      asContext(db.runtime, memberA(w.projectX.id), (tx) =>
        tx.insert(appSchema.metricSnapshot).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectY.id,
          key: "parcels_pending",
          numericValue: "1",
          displayOrder: 0,
          provenanceId: provA,
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it("updating or deleting another tenant's rows affects nothing", async () => {
    expect(
      await affectedRows(
        db.runtime,
        memberA(w.projectX.id),
        sql`update app.metric_snapshot set note = 'tampered' where tenant_id = ${w.tenantB.id}`,
      ),
    ).toBe(0);
    expect(
      await affectedRows(
        db.runtime,
        memberA(w.projectX.id),
        sql`delete from app.provenance_record where id = ${provB}`,
      ),
    ).toBe(0);
  });
});

describe("Slice 1 · provenance integrity", () => {
  it("a provenance record must carry at least one transformation", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        insert into app.provenance_record
          (id, tenant_id, project_id, regime, origin, transformations, title, note, validation_state)
        values (gen_random_uuid(), ${w.tenantA.id}, ${w.projectX.id}, 'DEMO_SIMULATION',
                'SYSTEM_GENERATED', '{}', 'no transformation', 'note', 'PENDING')
      `),
    );
    expect(error).toMatch(/transformations_not_empty/i);
  });

  it("a metric is a number or a date, never both and never neither", async () => {
    const both = await attempt(
      db.migrator.execute(sql`
        insert into app.metric_snapshot
          (id, tenant_id, project_id, key, numeric_value, date_value, display_order, provenance_id)
        values (gen_random_uuid(), ${w.tenantA.id}, ${w.projectX.id}, 'parcels_pending',
                1, '2026-01-01', 0, ${provA})
      `),
    );
    expect(both).toMatch(/metric_snapshot_single_value/i);
    const neither = await attempt(
      db.migrator.execute(sql`
        insert into app.metric_snapshot
          (id, tenant_id, project_id, key, display_order, provenance_id)
        values (gen_random_uuid(), ${w.tenantA.id}, ${w.projectX.id}, 'parcels_pending', 0, ${provA})
      `),
    );
    expect(neither).toMatch(/metric_snapshot_single_value/i);
  });

  it("a metric cannot reference a provenance record of another tenant", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        insert into app.metric_snapshot
          (id, tenant_id, project_id, key, numeric_value, display_order, provenance_id)
        values (gen_random_uuid(), ${w.tenantA.id}, ${w.projectX.id}, 'parcels_pending',
                1, 0, ${provB})
      `),
    );
    expect(error).toMatch(/metric_snapshot_provenance_fk|foreign key/i);
  });

  it("the metric key vocabulary is closed by the database", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        insert into app.metric_snapshot
          (id, tenant_id, project_id, key, numeric_value, display_order, provenance_id)
        values (gen_random_uuid(), ${w.tenantA.id}, ${w.projectX.id}, 'hallazgos_abiertos',
                1, 0, ${provA})
      `),
    );
    expect(error).toMatch(/invalid input value for enum/i);
  });

  it("lineage cannot point a record at itself", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        insert into app.provenance_input (tenant_id, project_id, provenance_id, input_provenance_id)
        values (${w.tenantA.id}, ${w.projectX.id}, ${provA}, ${provA})
      `),
    );
    expect(error).toMatch(/no_self_edge/i);
  });
});
