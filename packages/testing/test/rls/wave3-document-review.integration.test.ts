import { documentsSchema, reviewSchema } from "@eia/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  affectedRows,
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
 * Isolation and immutability of AI document review (ADR-035).
 *
 * The rows here are a model's statements about a consultancy's study and a specialist's judgement
 * of them, so two properties are checked at the database rather than in the application:
 *
 * 1. **nothing crosses a tenant or a project**, including through a forged scope;
 * 2. **nothing is rewritten** — not what a model proposed, not the corpus a run read, not a
 *    decision somebody took, and not the passage a candidate rests on.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

const REVIEW_TABLES = [
  "document_review_run",
  "document_review_source",
  "document_review_candidate",
  "document_review_evidence",
  "document_review_decision",
] as const;

interface Seeded {
  readonly runId: string;
  readonly candidateId: string;
  readonly decisionId: string;
  readonly sourceId: string;
  readonly evidenceId: string;
}

async function seedReview(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  code: string;
}): Promise<Seeded> {
  const provenance = await createProvenanceRecord(db.migrator, {
    tenantId: input.tenantId,
    projectId: input.projectId,
  });
  const documentId = randomUUID();
  const versionId = randomUUID();
  const chunkId = randomUUID();
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
    privacyClassification: "NO_PERSONAL_DATA_KNOWN",
    provenanceId: provenance.id,
  });
  await db.migrator.insert(documentsSchema.documentChunk).values({
    id: chunkId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    versionId,
    ordinal: 0,
    pageFrom: 1,
    pageTo: 1,
    charFrom: 0,
    charTo: 60,
    text: `El expediente ${input.code} registra predios afectados por el trazado.`,
    contentHash: `chunk-${input.code}`,
  });

  const runId = randomUUID();
  await db.migrator.insert(reviewSchema.documentReviewRun).values({
    id: runId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    lens: "numerical_consistency",
    lensRef: "numerical_consistency@1",
    status: "COMPLETED",
    adapterKind: "fake",
    requestedModel: "fake/deterministic",
    promptVersion: "document-review@1",
    initiatedByUserId: input.userId,
    provenanceId: provenance.id,
  });
  const sourceId = randomUUID();
  await db.migrator.insert(reviewSchema.documentReviewSource).values({
    id: sourceId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    runId,
    documentId,
    documentVersionId: versionId,
    privacyClassificationAtRun: "NO_PERSONAL_DATA_KNOWN",
  });
  const candidateId = randomUUID();
  await db.migrator.insert(reviewSchema.documentReviewCandidate).values({
    id: candidateId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    runId,
    candidateCode: "IA-001",
    lens: "numerical_consistency",
    support: "TWO_SIDED",
    state: "PROPOSED",
    title: `Dos cifras de ${input.code} podrían no corresponder`,
    observation: "Los pasajes citados registran conteos distintos del mismo universo.",
    suggestedCheck: "Contrastar ambos pasajes en el expediente.",
    provenanceId: provenance.id,
  });
  const evidenceId = randomUUID();
  await db.migrator.insert(reviewSchema.documentReviewEvidence).values({
    id: evidenceId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    candidateId,
    role: "SOURCE_A",
    ordinal: 0,
    chunkId,
    documentVersionId: versionId,
    label: `${input.code} v1 · p. 1 · pasaje 1`,
    quote: `El expediente ${input.code} registra predios afectados por el trazado.`,
  });
  const decisionId = randomUUID();
  await db.migrator.insert(reviewSchema.documentReviewDecision).values({
    id: decisionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    candidateId,
    decision: "DISMISS",
    fromState: "PROPOSED",
    toState: "DISMISSED",
    justification: "Los dos pasajes describen universos distintos; no hay nada que revisar.",
    reviewerUserId: input.userId,
  });
  return { runId, candidateId, decisionId, sourceId, evidenceId };
}

let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  a = await seedReview({
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    userId: w.memberA.id,
    code: "DOC-A1",
  });
  b = await seedReview({
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    userId: w.ownerB.id,
    code: "DOC-B1",
  });
});
afterAll(() => db.close());

const ctxA = (projectId: string | null = w.projectX.id) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});

describe("1 · a candidate never crosses a tenant", () => {
  it("tenant A sees exactly its own review rows", async () => {
    for (const table of REVIEW_TABLES) {
      expect(await countVisible(db.runtime, ctxA(), `app.${table}`), table).toBe(1);
    }
  });

  it("tenant B's rows are invisible to tenant A, by id and by tenant", async () => {
    expect(
      await countVisible(db.runtime, ctxA(), "app.document_review_candidate", {
        column: "id",
        value: b.candidateId,
      }),
    ).toBe(0);
    for (const table of REVIEW_TABLES) {
      expect(
        await countVisible(db.runtime, ctxA(), `app.${table}`, {
          column: "tenant_id",
          value: w.tenantB.id,
        }),
        table,
      ).toBe(0);
    }
  });

  it("a project inside the same tenant cannot see another project's candidates", async () => {
    const ctx = ctxA(w.projectY.id);
    for (const table of REVIEW_TABLES) {
      expect(await countVisible(db.runtime, ctx, `app.${table}`), table).toBe(0);
    }
  });

  it("no context at all sees nothing", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    for (const table of REVIEW_TABLES) {
      expect(await countVisible(db.runtime, none, `app.${table}`), table).toBe(0);
    }
  });

  it("a forged insert naming another tenant is refused by the policy", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.document_review_run
            (id, tenant_id, project_id, lens, lens_ref, adapter_kind, requested_model,
             prompt_version, initiated_by_user_id, provenance_id)
          select gen_random_uuid(), ${w.tenantB.id}, ${w.projectZ.id}, 'numerical_consistency',
                 'numerical_consistency@1', 'fake', 'fake/deterministic', 'document-review@1',
                 ${w.memberA.id}, r.provenance_id
            from app.document_review_run r where r.id = ${a.runId}
        `),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  /*
   * A decision names who took it. The insert policy adds `reviewer_user_id =
   * app.current_user_id()`, so a caller cannot record somebody else's judgement of a model's
   * suggestion — the same rule `field_media` applies to a technician's declaration.
   */
  it("a decision cannot be recorded in somebody else's name", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.document_review_decision
            (id, tenant_id, project_id, candidate_id, decision, from_state, to_state,
             justification, reviewer_user_id)
          values (gen_random_uuid(), ${w.tenantA.id}, ${w.projectX.id}, ${a.candidateId},
                  'ACCEPT', 'PROPOSED', 'ACCEPTED',
                  'Firmado a nombre de otra persona, que es justo lo que no debe poder hacerse.',
                  ${w.adminA.id})
        `),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });
});

describe("2 · what a model said, and what a person decided, are not rewritten", () => {
  it("a candidate's state may move and its words may not", async () => {
    // The state advances: that is the one thing a decision changes.
    expect(
      await affectedRows(
        db.runtime,
        ctxA(),
        sql`update app.document_review_candidate set state = 'DISMISSED' where id = ${a.candidateId}`,
      ),
    ).toBe(1);

    const rewritten = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          update app.document_review_candidate set observation = 'Otra cosa'
           where id = ${a.candidateId}
        `),
      ),
    );
    expect(rewritten).toContain("only state may change");
  });

  it("a candidate cannot be deleted, so a dismissal cannot be made to disappear", async () => {
    const error = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`delete from app.document_review_candidate where id = ${a.candidateId}`),
      ),
    );
    expect(error).toBeTruthy();
  });

  it("a decision is append-only, by grant and by trigger", async () => {
    const updated = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(
          sql`update app.document_review_decision set justification = 'Otra' where id = ${a.decisionId}`,
        ),
      ),
    );
    expect(updated).toBeTruthy();
    const deleted = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`delete from app.document_review_decision where id = ${a.decisionId}`),
      ),
    );
    expect(deleted).toBeTruthy();
  });

  it("the corpus a run read, and the passage a candidate rests on, are written once", async () => {
    const source = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(
          sql`update app.document_review_source set privacy_classification_at_run = 'X' where id = ${a.sourceId}`,
        ),
      ),
    );
    expect(source).toBeTruthy();
    const evidence = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(
          sql`update app.document_review_evidence set quote = 'Otra' where id = ${a.evidenceId}`,
        ),
      ),
    );
    expect(evidence).toBeTruthy();
  });

  it("the runtime role holds no DELETE on any of the five tables", async () => {
    for (const table of REVIEW_TABLES) {
      const result = await db.migrator.execute(sql`
        select has_table_privilege('eia_app', ${`app.${table}`}, 'DELETE') as allowed
      `);
      expect((result.rows[0] as { allowed: boolean }).allowed, table).toBe(false);
    }
  });

  it("only the run and the candidate may be updated at all", async () => {
    const updatable = new Set(["document_review_run", "document_review_candidate"]);
    for (const table of REVIEW_TABLES) {
      const result = await db.migrator.execute(sql`
        select has_table_privilege('eia_app', ${`app.${table}`}, 'UPDATE') as allowed
      `);
      expect((result.rows[0] as { allowed: boolean }).allowed, table).toBe(updatable.has(table));
    }
  });
});

describe("3 · every review table carries the tenancy contract", () => {
  it("has FORCE row level security and the composite project foreign key", async () => {
    for (const table of REVIEW_TABLES) {
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
});
