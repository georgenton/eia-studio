import { qualitySchema } from "@eia/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createDocumentAssertion,
  createProjectMembership,
  createProvenanceRecord,
  createQualityFinding,
  createSpecialistReview,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Isolation and immutability of the Quality Gate tables.
 *
 * The tenancy rule is the ordinary one: a finding is about documents and counts, not about an
 * individual's answers, so it sits behind project access and does **not** inherit the
 * `field.responses.read` door that governs survey responses. That is a deliberate difference from
 * Slice 4, and it is asserted here rather than assumed — a GIS specialist must be able to read a
 * finding about a parcel count.
 *
 * The second half is about permanence. A specialist decision that could be edited afterwards is
 * worse than no decision: the study would carry a conclusion nobody reached, attributed to
 * somebody who did not reach it. The database refuses the UPDATE and the DELETE, and the grant
 * refuses them before the trigger does.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let prov: string;
let provB: string;
let findingA: { id: string; runId: string; findingCode: string };
let reviewId: string;

const QUALITY_TABLES = [
  "document_assertion",
  "quality_run",
  "quality_finding",
  "finding_evidence",
  "specialist_review",
] as const;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  prov = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantA.id, projectId: w.projectX.id })
  ).id;
  provB = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantB.id, projectId: w.projectZ.id })
  ).id;

  await createDocumentAssertion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    key: "parcels.affected_count",
    sourceRef: "Anexo A",
    valueNumber: 71,
  });
  findingA = await createQualityFinding(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    userId: w.memberA.id,
    findingCode: "QG-001",
  });
  reviewId = (
    await createSpecialistReview(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      findingId: findingA.id,
      reviewerUserId: w.memberA.id,
    })
  ).id;

  // Tenant B's own, so "invisible" means invisible rather than absent.
  await createDocumentAssertion(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provB,
    key: "parcels.affected_count",
    sourceRef: "Anexo B",
    valueNumber: 12,
  });
  await createQualityFinding(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provB,
    userId: w.ownerB.id,
    findingCode: "QG-001",
  });
});
afterAll(() => db.close());

const ctxA = (projectId: string | null = w.projectX.id) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});

describe("1 · a tenant never sees another tenant's findings", () => {
  it("every quality table is empty for tenant A when it holds only tenant B's rows", async () => {
    for (const table of QUALITY_TABLES) {
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
        tx.insert(qualitySchema.documentAssertion).values({
          id: randomUUID(),
          tenantId: w.tenantB.id,
          projectId: w.projectZ.id,
          key: "smuggled",
          sourceKind: "RECONSTRUCTED_CORPUS",
          sourceRef: "x",
          valueNumber: "1",
          provenanceId: provB,
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it("no context at all sees nothing, which is what a missing setting must mean", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    for (const table of QUALITY_TABLES) {
      expect(await countVisible(db.runtime, none, `app.${table}`), table).toBe(0);
    }
  });

  it("the same finding code exists in both tenants and neither leaks into the other", async () => {
    // `QG-001` is unique *per project*, so both tenants have one. A query that returned two rows
    // would be the failure this test exists to catch.
    const rows = await asContext(db.runtime, ctxA(), async (tx) => {
      const result = await tx.execute(
        sql`select count(*)::int as n from app.quality_finding where finding_code = 'QG-001'`,
      );
      return (result.rows[0] as { n: number }).n;
    });
    expect(rows).toBe(1);
  });
});

describe("2 · a finding is project data, not response data", () => {
  it("a project member reads findings without holding field.responses.read", async () => {
    // The context deliberately does not set `fieldResponsesAccess`. A GIS specialist must be able
    // to see a finding about a parcel count without being able to read what a household answered.
    const visible = await countVisible(db.runtime, ctxA(), "app.quality_finding");
    expect(visible).toBe(1);
    expect(await countVisible(db.runtime, ctxA(), "app.finding_evidence")).toBe(2);
    expect(await countVisible(db.runtime, ctxA(), "app.specialist_review")).toBe(1);
  });

  it("a user with no membership in the project sees none of it", async () => {
    const outsider = await createUser(db.migrator, "outsider");
    const membership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: outsider.id,
      role: "MEMBER",
    });
    const ctx = { userId: outsider.id, tenantId: w.tenantA.id, projectId: w.projectX.id };
    for (const table of QUALITY_TABLES) {
      expect(await countVisible(db.runtime, ctx, `app.${table}`), table).toBe(0);
    }

    // …and gains access the moment the membership exists, so the denial was about membership and
    // not about something incidental.
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: membership.id,
      role: "GIS_SPECIALIST",
    });
    expect(await countVisible(db.runtime, ctx, "app.quality_finding")).toBe(1);
  });
});

describe("3 · a specialist decision is permanent", () => {
  it("the runtime role cannot update a decision", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(
          sql`update app.specialist_review set justification = 'reescrito' where id = ${reviewId}`,
        ),
      ),
    );
    // The grant refuses it before the trigger would: `eia_app` has SELECT and INSERT only.
    expect(error).toMatch(/permission denied|append_only/i);
  });

  it("the runtime role cannot delete one either", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`delete from app.specialist_review where id = ${reviewId}`),
      ),
    );
    expect(error).toMatch(/permission denied|append_only/i);
  });

  it("not even the owning role can, because the trigger has no role condition", async () => {
    // The privileged path exists — a migration runs as the owner — so the guarantee has to hold
    // there too, or "permanent" would mean "permanent unless somebody uses the other connection".
    expect(
      await attempt(
        db.migrator.execute(
          sql`update app.specialist_review set justification = 'reescrito' where id = ${reviewId}`,
        ),
      ),
    ).toMatch(/specialist_review_append_only/);
    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.specialist_review where id = ${reviewId}`),
      ),
    ).toMatch(/specialist_review_append_only/);
  });

  it("a token justification is refused by the database, not only by the form", async () => {
    expect(
      await attempt(
        createSpecialistReview(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          findingId: findingA.id,
          reviewerUserId: w.memberA.id,
          justification: "ok",
        }),
      ),
    ).toMatch(/justification_present/);
  });
});

describe("4 · a finding always compares exactly two sources", () => {
  it("a finding with one source is refused at commit", async () => {
    const error = await attempt(
      db.migrator.transaction(async (tx) => {
        const runId = randomUUID();
        const findingId = randomUUID();
        await tx.insert(qualitySchema.qualityRun).values({
          id: runId,
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          requirements: ["rule.affectation_count@1"],
          status: "COMPLETED",
          initiatedByUserId: w.memberA.id,
          provenanceId: prov,
        });
        await tx.insert(qualitySchema.qualityFinding).values({
          id: findingId,
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          findingCode: "QG-900",
          fingerprint: `one-sided|${findingId}`,
          firstRunId: runId,
          lastRunId: runId,
          requirementKey: "rule.affectation_count",
          requirementVersion: "1",
          type: "NUMERICAL_MISMATCH",
          severity: "high",
          title: "t",
          explanation: "e",
          whyFlagged: "w",
          suggestedAction: "s",
          provenanceId: prov,
        });
        await tx.insert(qualitySchema.findingEvidence).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          findingId,
          role: "SOURCE_A",
          locator: { kind: "project", field: "locationLabel" },
          label: "l",
          quote: "q",
          ordinal: 0,
        });
      }),
    );
    expect(error).toMatch(/quality_finding_two_sources/);
  });

  it("removing one side of an existing finding is refused too", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        delete from app.finding_evidence
         where tenant_id = ${w.tenantA.id} and finding_id = ${findingA.id} and role = 'SOURCE_B'
      `),
    );
    expect(error).toMatch(/quality_finding_two_sources/);
  });
});

describe("5 · an assertion holds exactly one value, and never a fabricated citation", () => {
  it("two values in one row are refused", async () => {
    expect(
      await attempt(
        db.migrator.insert(qualitySchema.documentAssertion).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          key: "two.values",
          sourceKind: "RECONSTRUCTED_CORPUS",
          sourceRef: "x",
          valueNumber: "1",
          valueText: "uno",
          provenanceId: prov,
        }),
      ),
    ).toMatch(/document_assertion_single_value/);
  });

  it("no values at all is refused as well", async () => {
    expect(
      await attempt(
        db.migrator.insert(qualitySchema.documentAssertion).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          key: "no.value",
          sourceKind: "RECONSTRUCTED_CORPUS",
          sourceRef: "x",
          provenanceId: prov,
        }),
      ),
    ).toMatch(/document_assertion_single_value/);
  });

  it("a date that is not a calendar date is refused", async () => {
    expect(
      await attempt(
        db.migrator.insert(qualitySchema.documentAssertion).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          key: "bad.date",
          sourceKind: "RECONSTRUCTED_CORPUS",
          sourceRef: "x",
          valueDate: "25/10/2025",
          provenanceId: prov,
        }),
      ),
    ).toMatch(/document_assertion_date_shape/);
  });

  it("claiming to come from an ingested document without naming one is refused", async () => {
    // Slice 5 refused the claim outright, because no document version could exist. Slice 6 made one
    // possible, so migration 0021 replaced that CHECK with the rule that now holds: the claim must
    // name a real version. The guarantee is the same one — a citation nobody could follow is a
    // fabrication in the field whose whole purpose is that a finding can be checked.
    expect(
      await attempt(
        db.migrator.execute(sql`
          insert into app.document_assertion
            (id, tenant_id, project_id, key, source_kind, source_ref, value_number, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'fake.citation',
                  'DOCUMENT_VERSION', 'Informe', 1, ${prov})
        `),
      ),
    ).toMatch(/document_assertion_citation_is_real/);
  });
});

describe("6 · uniqueness is per project, and provenance is mandatory", () => {
  it("two findings cannot share a fingerprint in one project", async () => {
    expect(
      await attempt(
        createQualityFinding(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          provenanceId: prov,
          userId: w.memberA.id,
          findingCode: "QG-800",
          fingerprint: `fixture|${findingA.id}`,
        }),
      ),
    ).toMatch(/quality_finding_fingerprint_key/);
  });

  it("two findings cannot share a code in one project", async () => {
    expect(
      await attempt(
        createQualityFinding(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          provenanceId: prov,
          userId: w.memberA.id,
          findingCode: "QG-001",
        }),
      ),
    ).toMatch(/quality_finding_code_key/);
  });

  it("a finding cannot borrow another tenant's provenance record", async () => {
    expect(
      await attempt(
        createQualityFinding(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: w.projectX.id,
          provenanceId: provB,
          userId: w.memberA.id,
          findingCode: "QG-801",
        }),
      ),
    ).toMatch(/quality_finding_provenance_fk|violates foreign key/);
  });
});

describe("7 · every quality table forces row level security", () => {
  it("enabled and forced, so even the table's owner is subject to the policies", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = any(${sql.raw(
         `ARRAY[${QUALITY_TABLES.map((t) => `'${t}'`).join(",")}]`,
       )})
       order by 1
    `);
    const rows = result.rows as Array<{ table: string; enabled: boolean; forced: boolean }>;
    expect(rows).toHaveLength(QUALITY_TABLES.length);
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
    }
  });
});
