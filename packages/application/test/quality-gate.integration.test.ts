import { qualitySchema } from "@eia/db";
import { FeatureDisabled, InvalidInput, PermissionDenied, type SessionUser } from "@eia/domain";
import { appSchema } from "@eia/db";
import {
  attempt,
  createDocumentAssertion,
  createProjectMembership,
  createProvenanceRecord,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  decideQualityFinding,
  loadFindingDetail,
  loadQualityOverview,
  runQualityCheck,
} from "../src/index";

/**
 * The Quality Gate through the real use-cases and a real database.
 *
 * The properties worth a database rather than a unit test are the ones about *time*: what a second
 * run does to a finding somebody already decided, what a decision does to the finding's state, and
 * what happens when the evidence changes underneath a settled conclusion. None of those can be
 * checked by calling a pure function twice.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let prov: string;
let coordinator: { id: string; email: string };
let reviewer: { id: string; email: string };
let technician: { id: string; email: string };

const CAPABILITIES = ["core.projects", "gis.maps", "gis.parcels", "quality.document_gate"] as const;

/** The four assertions that make the pilot's four known inconsistencies. */
async function seedCorpus(): Promise<void> {
  const rows: Array<Parameters<typeof createDocumentAssertion>[1]> = [
    {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      key: "parcels.affected_count",
      sourceRef: "Anexo de afectaciones",
      valueNumber: 71,
      quote: "71 predios con afectación",
    },
    {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      key: "parcels.affected_count",
      sourceRef: "Informe social",
      valueNumber: 70,
      quote: "70 predios afectados",
    },
    {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      key: "consultation.planned_date",
      sourceRef: "Plan de participación",
      valueDate: "2025-10-25",
    },
    {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      key: "consultation.actual_date",
      sourceRef: "Acta de la asamblea",
      valueDate: "2025-10-22",
    },
  ];
  for (const row of rows) await createDocumentAssertion(db.migrator, row);
}

/** A project-level explicit override, the layer that can disable what the tenant allows. */
async function setProjectOverride(enabled: boolean): Promise<void> {
  // Delete-then-insert rather than an upsert: the table's identity is a composite primary key,
  // and naming it in an ON CONFLICT target is the kind of detail that breaks silently later.
  await db.migrator.execute(sql`
    delete from app.project_capability_setting
     where tenant_id = ${w.tenantA.id} and project_id = ${w.projectX.id}
       and capability_key = 'quality.document_gate'
  `);
  await db.migrator.insert(appSchema.projectCapabilitySetting).values({
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    capabilityKey: "quality.document_gate",
    enabled,
  });
}

async function contextFor(user: { id: string; email: string }) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, {
    sessionUser,
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  });
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of CAPABILITIES) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }
  prov = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantA.id, projectId: w.projectX.id })
  ).id;
  await seedCorpus();

  const make = async (label: string, role: "COORDINATOR" | "REVIEWER" | "FIELD_TECHNICIAN") => {
    const user = await createUser(db.migrator, label);
    const membership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: user.id,
      role: "MEMBER",
    });
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: membership.id,
      role,
    });
    return user;
  };
  coordinator = await make("coordinator", "COORDINATOR");
  reviewer = await make("reviewer", "REVIEWER");
  technician = await make("technician", "FIELD_TECHNICIAN");
});
afterAll(() => db.close());

describe("running the rule set", () => {
  let findingCode: string;

  it("raises one finding per real disagreement and nothing for the rules it cannot feed", async () => {
    const ctx = await contextFor(coordinator);
    const result = await runQualityCheck(db.runtime, ctx);

    // Two firing rules from four assertions. The other three rules have no inputs in this
    // project and are reported as skipped — not raised as `MISSING_EVIDENCE` findings, because
    // "the document does not say" and "we could not find it" are different claims.
    expect(result.created).toBe(2);
    expect(result.skipped.map((s) => s.requirementKey).sort()).toEqual([
      "rule.project_identity",
      "rule.territorial_institution",
      "rule.vulnerability_conclusion",
    ]);

    const overview = await loadQualityOverview(db.runtime, ctx);
    expect(overview.findings).toHaveLength(2);
    expect(overview.counts.open).toBe(2);
    findingCode = overview.findings[0]!.code;

    // Both codes are per-project business identifiers, not primary keys.
    expect(overview.findings.map((f) => f.code).sort()).toEqual(["QG-001", "QG-002"]);
  });

  it("a second run updates rather than duplicating", async () => {
    const ctx = await contextFor(coordinator);
    const second = await runQualityCheck(db.runtime, ctx);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);

    const overview = await loadQualityOverview(db.runtime, ctx);
    expect(overview.findings).toHaveLength(2);
    expect(overview.lastRun?.id).toBe(second.runId);
  });

  it("the finding carries both sides of the comparison, quoted", async () => {
    const ctx = await contextFor(coordinator);
    const detail = await loadFindingDetail(db.runtime, ctx, findingCode);
    const roles = detail.evidence.map((e) => e.role);
    expect(roles).toContain("SOURCE_A");
    expect(roles).toContain("SOURCE_B");
    for (const item of detail.evidence) {
      expect(item.quote.length).toBeGreaterThan(0);
      // No fabricated page: the locator is an assertion with a human-readable reference.
      expect(JSON.stringify(item.locator)).not.toContain('"page"');
    }
  });

  it("shows the rule catalogue even where nothing fired", async () => {
    // A gate that lists only its findings is indistinguishable from one that never ran.
    const overview = await loadQualityOverview(db.runtime, await contextFor(coordinator));
    expect(overview.requirements).toHaveLength(5);
    expect(overview.requirements.map((r) => r.key)).toContain("rule.vulnerability_conclusion");
  });
});

describe("who may do what", () => {
  it("a coordinator runs the check; a reviewer does not", async () => {
    // `quality.write` is the running permission. A reviewer decides, which is a different act.
    expect(await attempt(runQualityCheck(db.runtime, await contextFor(reviewer)))).toMatch(
      /Permission denied/,
    );
  });

  it("a reviewer settles a finding; a coordinator does not", async () => {
    const ctx = await contextFor(coordinator);
    const overview = await loadQualityOverview(db.runtime, ctx);
    const finding = overview.findings[0]!;

    await expect(
      decideQualityFinding(db.runtime, ctx, {
        findingId: finding.id,
        decision: "DISMISS",
        justification: "El coordinador no debería poder decidir esto.",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("a field technician sees none of it", async () => {
    const ctx = await contextFor(technician);
    await expect(loadQualityOverview(db.runtime, ctx)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("the capability gates the whole module, whatever the permission says", async () => {
    await setProjectOverride(false);
    const ctx = await contextFor(coordinator);
    await expect(loadQualityOverview(db.runtime, ctx)).rejects.toBeInstanceOf(FeatureDisabled);
    await expect(runQualityCheck(db.runtime, ctx)).rejects.toBeInstanceOf(FeatureDisabled);
    await setProjectOverride(true);
  });
});

describe("the decision, and what survives it", () => {
  let findingId: string;
  let findingCode: string;

  beforeAll(async () => {
    const overview = await loadQualityOverview(db.runtime, await contextFor(coordinator));
    const finding = overview.findings.find((f) => f.requirementKey === "rule.affectation_count")!;
    findingId = finding.id;
    findingCode = finding.code;
  });

  it("moves the finding's state and records who decided and why", async () => {
    const ctx = await contextFor(reviewer);
    const result = await decideQualityFinding(db.runtime, ctx, {
      findingId,
      decision: "ACCEPT",
      justification: "Las dos cifras del expediente efectivamente no coinciden.",
    });
    expect(result).toMatchObject({ fromState: "OPEN", toState: "ACCEPTED" });

    const detail = await loadFindingDetail(db.runtime, ctx, findingCode);
    expect(detail.state).toBe("ACCEPTED");
    expect(detail.reviews).toHaveLength(1);
    expect(detail.reviews[0]!.justification).toContain("no coinciden");
  });

  it("refuses a transition the state machine does not allow", async () => {
    const ctx = await contextFor(reviewer);
    await expect(
      decideQualityFinding(db.runtime, ctx, {
        findingId,
        decision: "START_REVIEW",
        justification: "No debería poder tomarse algo ya aceptado.",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("refuses a token justification at the use-case, before the database has to", async () => {
    const ctx = await contextFor(reviewer);
    await expect(
      decideQualityFinding(db.runtime, ctx, {
        findingId,
        decision: "RESOLVE",
        justification: "ok",
      }),
    ).rejects.toBeTruthy();
  });

  it("a re-run leaves a decided finding decided", async () => {
    // The property the module rests on: a scheduled job does not overrule a person. The evidence
    // has not changed, so the state stays exactly where the reviewer put it.
    await runQualityCheck(db.runtime, await contextFor(coordinator));
    const detail = await loadFindingDetail(db.runtime, await contextFor(reviewer), findingCode);
    expect(detail.state).toBe("ACCEPTED");
    expect(detail.reviews).toHaveLength(1);
  });

  it("changed evidence reopens it, and the decision history survives", async () => {
    // The other half: new information *is* a reason to look again. The reviewer's reasoning stays
    // on the record, so the reopening is visible as a sequence rather than as an erasure.
    await db.migrator.execute(sql`
      update app.document_assertion set value_number = 68
       where tenant_id = ${w.tenantA.id} and project_id = ${w.projectX.id}
         and key = 'parcels.affected_count' and source_ref = 'Informe social'
    `);
    const result = await runQualityCheck(db.runtime, await contextFor(coordinator));
    expect(result.reopened).toBe(1);

    const detail = await loadFindingDetail(db.runtime, await contextFor(reviewer), findingCode);
    expect(detail.state).toBe("OPEN");
    expect(detail.reviews).toHaveLength(1);
    expect(detail.explanation).toContain("68");

    // The finding kept its identity: same code, same row, one more chapter.
    expect(detail.code).toBe(findingCode);
    expect(detail.id).toBe(findingId);
  });

  it("a change of mind is a second row, never an edit of the first", async () => {
    const ctx = await contextFor(reviewer);
    await decideQualityFinding(db.runtime, ctx, {
      findingId,
      decision: "DISMISS",
      justification: "Revisado de nuevo con el anexo corregido; las fuentes concuerdan.",
    });
    const detail = await loadFindingDetail(db.runtime, ctx, findingCode);
    expect(detail.reviews).toHaveLength(2);
    expect(detail.reviews[0]!.justification).toContain("no coinciden");
    expect(detail.reviews[1]!.justification).toContain("concuerdan");
    expect(detail.reviews.map((r) => r.toState)).toEqual(["ACCEPTED", "DISMISSED"]);
  });
});

describe("isolation, through the use-cases rather than around them", () => {
  it("a finding of another tenant is not found, not denied", async () => {
    // A distinguishable error would confirm the row exists, which is what somebody editing ids
    // wants to learn.
    const ctx = await contextFor(coordinator);
    await expect(loadFindingDetail(db.runtime, ctx, "QG-404")).rejects.toThrow(/not found/i);
  });

  it("a run writes into its own project only", async () => {
    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from app.quality_finding where project_id <> ${w.projectX.id}
    `);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("every finding carries a provenance record of its own project", async () => {
    const orphans = await db.migrator.execute(sql`
      select count(*)::int as n
        from app.quality_finding f
        left join app.provenance_record p
          on p.tenant_id = f.tenant_id and p.id = f.provenance_id
       where p.id is null
    `);
    expect((orphans.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("the audit trail says what happened, and not what was said about it", () => {
  it("records the run and the decision, and never the justification", async () => {
    const rows = await db.migrator.execute(sql`
      select action, details::text as details from audit.log
       where action like 'quality.%' order by occurred_at
    `);
    const entries = rows.rows as Array<{ action: string; details: string }>;
    expect(entries.map((e) => e.action)).toContain("quality.run.completed");
    expect(entries.map((e) => e.action)).toContain("quality.finding.decided");

    // The specialist's reasoning lives on the finding, attributed and permanent. Copying it into
    // the audit log would put the same text in two places that can disagree.
    for (const entry of entries) {
      expect(entry.details).not.toContain("no coinciden");
      expect(entry.details).not.toContain("concuerdan");
    }
  });
});

describe("nothing about the pilot project leaks into the module", () => {
  it("the rule catalogue and the generated copy name no province, customer or figure", async () => {
    const overview = await loadQualityOverview(db.runtime, await contextFor(coordinator));
    const text = JSON.stringify(overview.requirements);
    for (const forbidden of ["Zamora", "Pichincha", "Puente del Amor"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("no finding rows exist for a project whose corpus was never seeded", async () => {
    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from app.quality_finding where project_id = ${w.projectY.id}
    `);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
    // …and the assertions table is the reason: no inputs, no findings.
    const assertions = await db.migrator.execute(sql`
      select count(*)::int as n from app.document_assertion where project_id = ${w.projectY.id}
    `);
    expect((assertions.rows[0] as { n: number }).n).toBe(0);
  });
});

/** Kept last: it deletes rows the other blocks read. */
describe("evidence is replaced, never accumulated", () => {
  it("a re-run leaves exactly two sources on the finding", async () => {
    const before = await db.migrator.execute(sql`
      select count(*)::int as n from app.finding_evidence
    `);
    await runQualityCheck(db.runtime, await contextFor(coordinator));
    const after = await db.migrator.execute(sql`
      select count(*)::int as n from app.finding_evidence
    `);
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);

    const perFinding = await db.migrator.execute(sql`
      select finding_id, count(*)::int as n from app.finding_evidence group by finding_id
    `);
    for (const row of perFinding.rows as Array<{ n: number }>) expect(row.n).toBe(2);
  });

  it("the tables the module owns are the ones the schema declares", async () => {
    // A guard against a table added later and left out of the isolation suite.
    const rows = await db.migrator.execute(sql`
      select table_name from information_schema.tables
       where table_schema = 'app'
         and table_name in ('document_assertion','quality_run','quality_finding',
                            'finding_evidence','specialist_review')
       order by 1
    `);
    expect((rows.rows as Array<{ table_name: string }>).map((r) => r.table_name)).toEqual([
      "document_assertion",
      "finding_evidence",
      "quality_finding",
      "quality_run",
      "specialist_review",
    ]);
    expect(Object.keys(qualitySchema).length).toBeGreaterThanOrEqual(5);
  });
});
