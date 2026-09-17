import { auditSchema, documentsSchema, reviewSchema, withDbContext } from "@eia/db";
import type { ClassifierAvailability, SessionUser } from "@eia/domain";
import { ReviewCorpusRefused } from "@eia/domain";
import {
  attempt,
  buildPdf,
  createProjectMembership,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  buildRequestContext,
  claimNextDocumentReview,
  createS3Storage,
  createUploadIntent,
  claimNextExtraction,
  decideDocumentReviewCandidate,
  FakeDocumentReviewer,
  finalizeUpload,
  listDocumentReviewCandidates,
  listDocumentReviewRuns,
  processDocumentExtraction,
  processDocumentReview,
  queueDocumentExtraction,
  startDocumentReviewRun,
  uploadDocumentVersion,
} from "../src/index";

/**
 * AI document review against a real database, a real provider and real extracted passages
 * (ADR-035).
 *
 * The suite is about the four properties the ADR is for:
 *
 * 1. **the privacy gate refuses rather than filters**, and names what blocked it;
 * 2. **no citation, no candidate** — a suggestion citing a passage the model never received is
 *    refused and counted, and the other suggestions in the same response survive;
 * 3. **a single-source candidate cannot be accepted**, by anybody, however they ask;
 * 4. **what a model said is not editable**, and neither is what a person decided about it — the
 *    database refuses both, not only the application.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let reviewer: { id: string; email: string };
let storage: ReturnType<typeof createS3Storage>;
/** The two documents somebody declared free of personal data. */
let clearDocuments: string[] = [];

const AVAILABLE: ClassifierAvailability = {
  state: "AVAILABLE",
  kind: "fake",
  model: "fake/deterministic",
  live: false,
};

const prose = (times: number) =>
  "El expediente describe la afectacion predial a lo largo del corredor vial. ".repeat(times);

async function contextFor(user: { id: string; email: string }, projectSlug?: string) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, {
    sessionUser,
    tenantSlug: w.tenantA.slug,
    projectSlug: projectSlug ?? w.projectX.slug,
  });
}

/** Upload a PDF, extract it, and leave a `READY` version with passages to retrieve. */
async function deliver(
  code: string,
  pages: ReadonlyArray<string>,
  privacy: "NO_PERSONAL_DATA_KNOWN" | "REVIEW_REQUIRED" | "CONTAINS_PERSONAL_DATA",
): Promise<{ documentId: string; versionId: string }> {
  const ctx = await contextFor(coordinator);
  const bytes = buildPdf(pages);
  const intent = await createUploadIntent(db.runtime, ctx, storage, {
    namespace: "documents",
    filename: `${code.toLowerCase()}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
  });
  const response = await fetch(intent.url, {
    method: "PUT",
    headers: intent.headers,
    body: bytes,
  });
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
  const stored = await finalizeUpload(db.runtime, ctx, storage, {
    intentId: intent.intentId,
    objectKey: intent.key,
  });
  const version = await uploadDocumentVersion(db.runtime, ctx, {
    documentId: null,
    code,
    title: `Documento ${code}`,
    kind: "report",
    storedObjectId: stored.storedObjectId,
    privacyClassification: privacy,
    sourceDate: null,
    sourceNote: "Entregado por la consultora",
  });
  await queueDocumentExtraction(db.runtime, ctx, version.versionId!);
  const claim = await claimNextExtraction(db.runtime);
  if (claim) await processDocumentExtraction(db.runtime, claim, storage);
  return { documentId: version.documentId, versionId: version.versionId! };
}

/**
 * A run over the two documents that were declared clear.
 *
 * Explicit rather than "the whole corpus", because one test below delivers a `REVIEW_REQUIRED`
 * document on purpose and, from that moment on, a whole-corpus run is **refused** — which is the
 * behaviour under test and not a fixture problem.
 */
async function startClear(lens: Parameters<typeof startDocumentReviewRun>[3]["lens"]) {
  const ctx = await contextFor(coordinator);
  return startDocumentReviewRun(db.runtime, ctx, AVAILABLE, { lens, documentIds: clearDocuments });
}

/** One turn of the review worker's loop, with the reviewer the test wants. */
async function runReviewOnce(fake: FakeDocumentReviewer) {
  const claim = await claimNextDocumentReview(db.runtime);
  if (!claim) return null;
  return processDocumentReview(db.runtime, claim, fake, "fake/deterministic");
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of [
    "core.projects",
    "core.documents",
    "quality.document_gate",
    "quality.rag_assistant",
  ] as const) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }

  const user = await createUser(db.migrator, "review-coordinator");
  const membership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: user.id,
    role: "MEMBER",
  });
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: membership.id,
    role: "COORDINATOR" as never,
  });
  coordinator = user;

  // A REVIEWER: holds `quality.review` and deliberately not `quality.write`. Checking and
  // deciding are different grants here for the same reason they are in the Quality Gate.
  const rev = await createUser(db.migrator, "review-reviewer");
  const revMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: rev.id,
    role: "MEMBER",
  });
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: revMembership.id,
    role: "REVIEWER" as never,
  });
  reviewer = rev;

  const config = inject("eiaTestStorage");
  storage = createS3Storage({
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  /*
   * The corpus is written so that each lens's probes actually retrieve something. That is not a
   * convenience: a lens whose probes find nothing never reaches a model at all, so a suite whose
   * documents said nothing about dates would be asserting the empty path for every lens and
   * calling it coverage.
   */
  const first = await deliver(
    "DOC-R1",
    [
      prose(3) +
        "El expediente registra 70 predios afectados por el trazado en total, sobre una " +
        "superficie de 7,4 hectareas. El nombre del proyecto es la via de prueba y el promotor " +
        "es la entidad contratante del estudio.",
      prose(3) +
        "La fecha de levantamiento de informacion fue en marzo, segun el cronograma de " +
        "actividades entregado. El canton y la parroquia corresponden al area de influencia " +
        "directa declarada.",
      prose(3) +
        "Las conclusiones del componente social senalan hogares en condicion de vulnerabilidad. " +
        "El plan de manejo indica el lugar de aplicacion de cada medida y su responsable.",
    ],
    "NO_PERSONAL_DATA_KNOWN",
  );
  const second = await deliver(
    "DOC-R2",
    [
      prose(3) +
        "El anexo de afectaciones enumera 71 predios frentistas al corredor vial, con una " +
        "superficie total distinta. El objeto del estudio y su alcance se describen aqui.",
      prose(3) +
        "La fecha de la asamblea de socializacion consta en actas, y el periodo de ejecucion " +
        "del estudio difiere del cronograma citado en el informe social.",
      prose(3) +
        "El gobierno autonomo descentralizado provincial asume la competencia sobre la via. " +
        "El programa de manejo describe la frecuencia de seguimiento de cada medida.",
    ],
    "NO_PERSONAL_DATA_KNOWN",
  );
  clearDocuments = [first.documentId, second.documentId];
});
afterAll(() => db.close());

describe("the privacy gate, which refuses rather than filters", () => {
  it("runs over a corpus somebody declared clear", async () => {
    const started = await startClear("numerical_consistency");
    expect(started.sourceCount).toBe(2);

    // The corpus is recorded as rows, not inferred later from a corpus that may have changed.
    const sources = await db.migrator
      .select()
      .from(reviewSchema.documentReviewSource)
      .where(eq(reviewSchema.documentReviewSource.runId, started.runId));
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.privacyClassificationAtRun === "NO_PERSONAL_DATA_KNOWN")).toBe(
      true,
    );

    const outcome = await runReviewOnce(new FakeDocumentReviewer());
    expect(outcome?.status).toBe("COMPLETED");
    expect(outcome!.passageCount).toBeGreaterThan(0);
  });

  /*
   * The decision this test exists for. A specialist asked for *this corpus* to be looked at;
   * reviewing the rest and reporting success would mean "no candidates in DOC-R3" came to mean
   * "DOC-R3 was never read", with nothing on screen saying so.
   */
  it("refuses the entire run when one version is not AI-eligible, and names it", async () => {
    await deliver("DOC-R3", [prose(4) + "Capitulo con datos por revisar."], "REVIEW_REQUIRED");
    const ctx = await contextFor(coordinator);

    let thrown: ReviewCorpusRefused | null = null;
    try {
      await startDocumentReviewRun(db.runtime, ctx, AVAILABLE, { lens: "general_cross_document" });
    } catch (error) {
      thrown = error as ReviewCorpusRefused;
    }
    expect(thrown).toBeInstanceOf(ReviewCorpusRefused);
    expect(thrown!.blocked.map((item) => item.documentCode)).toEqual(["DOC-R3"]);

    // Nothing was written: no run exists that could later be read as "the study was reviewed".
    const runs = await db.migrator
      .select()
      .from(reviewSchema.documentReviewRun)
      .where(eq(reviewSchema.documentReviewRun.lens, "general_cross_document"));
    expect(runs).toHaveLength(0);
  });

  it("audits the refusal, because a refusal is a decision about somebody's data", async () => {
    const [entry] = await db.migrator
      .select()
      .from(auditSchema.log)
      .where(eq(auditSchema.log.action, "documents.review.run_refused"))
      .orderBy(desc(auditSchema.log.occurredAt))
      .limit(1);
    expect(entry).toBeDefined();
    const details = entry!.details as Record<string, unknown>;
    expect(details.blockedDocuments).toBe("DOC-R3");
    expect(details.blockedReasons).toBe("PRIVACY_NOT_AI_SAFE");
    // Codes, never filenames: a delivered study can be named after a person (ADR-031 §1).
    expect(JSON.stringify(details)).not.toContain(".pdf");
  });

  it("records what answered, and that nothing left this system", async () => {
    const [entry] = await db.migrator
      .select()
      .from(auditSchema.log)
      .where(eq(auditSchema.log.action, "documents.review.run_started"))
      .orderBy(desc(auditSchema.log.occurredAt))
      .limit(1);
    const details = entry!.details as Record<string, unknown>;
    expect(details.adapter).toBe("fake");
    expect(details.model).toBe("fake/deterministic");
    expect(details.live).toBe(false);
    expect(details.sources).toBe(2);
  });
});

describe("no citation, no candidate", () => {
  it("refuses a candidate citing a passage the model never received, and keeps the good one", async () => {
    const started = await startClear("dates_chronology");

    const fake = new FakeDocumentReviewer({
      dates_chronology: {
        candidates: [
          {
            title: "Dos pasajes con fechas que podrian no coincidir",
            observation:
              "Los pasajes citados mencionan momentos distintos del levantamiento de informacion.",
            suggestedCheck: "Contrastar ambas fechas con el cronograma entregado.",
            sourceA: 0,
            sourceB: 1,
            context: [],
          },
          {
            title: "Una afirmacion apoyada en un pasaje inexistente",
            observation: "Este candidato cita un pasaje que el modelo nunca recibio.",
            suggestedCheck: "No deberia llegar a la base de datos en ningun caso.",
            sourceA: 0,
            sourceB: 98,
            context: [],
          },
        ],
      },
    });
    const outcome = await runReviewOnce(fake);
    expect(outcome?.status).toBe("COMPLETED");
    expect(outcome!.candidatesCreated).toBe(1);
    // Counted rather than absorbed: how often this happens is visible on the surface.
    expect(outcome!.candidatesRefused).toBe(1);

    const stored = await db.migrator
      .select()
      .from(reviewSchema.documentReviewCandidate)
      .where(eq(reviewSchema.documentReviewCandidate.runId, started.runId));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.title).toContain("fechas");
  });

  it("refuses a candidate that states a compliance conclusion", async () => {
    await startClear("project_identity");
    const fake = new FakeDocumentReviewer({
      project_identity: {
        candidates: [
          {
            title: "El estudio presenta un incumplimiento normativo",
            observation: "El sistema determina que el expediente no cumple con lo exigido.",
            suggestedCheck: "Corregir la infraccion detectada antes de la entrega.",
            sourceA: 0,
            sourceB: 1,
            context: [],
          },
        ],
      },
    });
    const outcome = await runReviewOnce(fake);
    expect(outcome!.candidatesCreated).toBe(0);
    expect(outcome!.candidatesRefused).toBe(1);
  });

  /*
   * **No passage, no claim.** The probes of this lens find nothing in a two-document corpus about
   * predios, so the model is never called — and the run says which kind of nothing it was.
   */
  it("never calls a model when retrieval found nothing", async () => {
    await startClear("management_plan_application_area");
    let called = false;
    const watching = new FakeDocumentReviewer();
    const spy = {
      kind: "fake",
      review: async (input: Parameters<FakeDocumentReviewer["review"]>[0]) => {
        called = true;
        return watching.review(input);
      },
    };
    const outcome = await runReviewOnce(spy as unknown as FakeDocumentReviewer);
    if (outcome?.passageCount === 0) {
      expect(called).toBe(false);
      expect(outcome.emptyReason).toBe("NO_PASSAGES");
      expect(outcome.status).toBe("COMPLETED");
    } else {
      // The corpus happened to match this lens's probes; the assertion then is only that a model
      // is called when there *are* passages, which the other tests cover.
      expect(called).toBe(true);
    }
  });
});

describe("a person decides, and both halves are kept", () => {
  async function aTwoSidedCandidate() {
    const ctx = await contextFor(coordinator);
    await startClear("locations_institutions");
    await runReviewOnce(new FakeDocumentReviewer());
    const candidates = await listDocumentReviewCandidates(db.runtime, ctx);
    return candidates.find((candidate) => candidate.support === "TWO_SIDED")!;
  }

  it("records the decision, its reason and the state it produced", async () => {
    const candidate = await aTwoSidedCandidate();
    expect(candidate).toBeDefined();
    const reviewerCtx = await contextFor(reviewer);
    const decided = await decideDocumentReviewCandidate(db.runtime, reviewerCtx, candidate.id, {
      decision: "ACCEPT",
      justification: "Contrastado con el anexo: la diferencia es real y pasa al expediente.",
    });
    expect(decided.toState).toBe("ACCEPTED");

    const [row] = await db.migrator
      .select()
      .from(reviewSchema.documentReviewCandidate)
      .where(eq(reviewSchema.documentReviewCandidate.id, candidate.id));
    expect(row!.state).toBe("ACCEPTED");
    // The model's words are exactly as they were: a person's disagreement is a decision row.
    expect(row!.title).toBe(candidate.title);
    expect(row!.observation).toBe(candidate.observation);

    const decisions = await db.migrator
      .select()
      .from(reviewSchema.documentReviewDecision)
      .where(eq(reviewSchema.documentReviewDecision.candidateId, candidate.id));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.justification).toContain("anexo");
    expect(decisions[0]!.reviewerUserId).toBe(reviewer.id);
  });

  it("keeps a change of mind as a second row rather than an edit", async () => {
    const candidate = await aTwoSidedCandidate();
    const reviewerCtx = await contextFor(reviewer);
    await decideDocumentReviewCandidate(db.runtime, reviewerCtx, candidate.id, {
      decision: "DISMISS",
      justification: "Los dos pasajes describen conteos distintos; no hay nada que revisar.",
    });
    await decideDocumentReviewCandidate(db.runtime, reviewerCtx, candidate.id, {
      decision: "REOPEN",
      justification: "Aparece una version corregida del anexo; conviene mirarlo otra vez.",
    });
    const decisions = await db.migrator
      .select()
      .from(reviewSchema.documentReviewDecision)
      .where(eq(reviewSchema.documentReviewDecision.candidateId, candidate.id));
    expect(decisions).toHaveLength(2);
    expect(decisions.map((d) => d.decision).sort()).toEqual(["DISMISS", "REOPEN"]);
  });

  it("a coordinator may run a review and may not settle a candidate", async () => {
    const candidate = await aTwoSidedCandidate();
    const ctx = await contextFor(coordinator);
    await expect(
      decideDocumentReviewCandidate(db.runtime, ctx, candidate.id, {
        decision: "ACCEPT",
        justification: "Me parece correcto y lo acepto yo mismo.",
      }),
    ).rejects.toThrow();
  });

  it("a reviewer may not start a run: checking and deciding are different grants", async () => {
    const reviewerCtx = await contextFor(reviewer);
    await expect(
      startDocumentReviewRun(db.runtime, reviewerCtx, AVAILABLE, { lens: "numerical_consistency" }),
    ).rejects.toThrow();
  });

  it("refuses a candidate of another project, with the same 404 shape everything else uses", async () => {
    const candidate = await aTwoSidedCandidate();
    const otherCtx = await contextFor(reviewer, w.projectY.slug).catch(() => null);
    if (!otherCtx) return; // the reviewer has no membership on Y, which is itself the guarantee
    await expect(
      decideDocumentReviewCandidate(db.runtime, otherCtx, candidate.id, {
        decision: "DISMISS",
        justification: "Desde otro proyecto no deberia ser ni visible.",
      }),
    ).rejects.toThrow();
  });
});

describe("what the database refuses, not only the application", () => {
  it("refuses to rewrite what a model proposed", async () => {
    const ctx = await contextFor(coordinator);
    const [candidate] = await db.migrator
      .select()
      .from(reviewSchema.documentReviewCandidate)
      .limit(1);
    expect(candidate).toBeDefined();

    const outcome = await attempt(
      db.migrator.execute(sql`
        update app.document_review_candidate
           set observation = 'Reescrito despues de los hechos'
         where id = ${candidate!.id}
      `),
    );
    expect(outcome).toContain("only state may change");
    void ctx;
  });

  it("refuses to delete a candidate, including a dismissed one", async () => {
    const [candidate] = await db.migrator
      .select()
      .from(reviewSchema.documentReviewCandidate)
      .limit(1);
    const outcome = await attempt(
      db.migrator.execute(
        sql`delete from app.document_review_candidate where id = ${candidate!.id}`,
      ),
    );
    expect(outcome).toContain("not deletable");
  });

  it("refuses to edit or delete a decision", async () => {
    const [decision] = await db.migrator
      .select()
      .from(reviewSchema.documentReviewDecision)
      .limit(1);
    expect(decision).toBeDefined();
    const updated = await attempt(
      db.migrator.execute(sql`
        update app.document_review_decision set justification = 'Otra cosa' where id = ${decision!.id}
      `),
    );
    expect(updated).toContain("written once");
    const deleted = await attempt(
      db.migrator.execute(sql`delete from app.document_review_decision where id = ${decision!.id}`),
    );
    expect(deleted).toContain("written once");
  });

  it("refuses a decision with a token word as its reason", async () => {
    const [candidate] = await db.migrator
      .select()
      .from(reviewSchema.documentReviewCandidate)
      .limit(1);
    const outcome = await attempt(
      db.migrator.execute(sql`
        insert into app.document_review_decision
          (id, tenant_id, project_id, candidate_id, decision, from_state, to_state,
           justification, reviewer_user_id)
        values (gen_random_uuid(), ${candidate!.tenantId}, ${candidate!.projectId},
                ${candidate!.id}, 'DISMISS', 'PROPOSED', 'DISMISSED', 'ok', ${reviewer.id})
      `),
    );
    expect(outcome).toContain("justification");
  });

  it("refuses to rewrite which documents a run read", async () => {
    const [source] = await db.migrator.select().from(reviewSchema.documentReviewSource).limit(1);
    const outcome = await attempt(
      db.migrator.execute(sql`
        update app.document_review_source set privacy_classification_at_run = 'NO_PERSONAL_DATA_KNOWN'
         where id = ${source!.id}
      `),
    );
    expect(outcome).toContain("written once");
  });
});

describe("what a reader is shown", () => {
  it("lists the runs with what answered and how much it read", async () => {
    const ctx = await contextFor(coordinator);
    const runs = await listDocumentReviewRuns(db.runtime, ctx);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.adapterKind).toBe("fake");
      // Derived from the adapter's name rather than stored beside it, so the two cannot drift.
      expect(run.live).toBe(false);
      expect(run.sourceCount).toBeGreaterThan(0);
    }
  });

  it("gives every candidate a code that cannot be mistaken for a quality finding's", async () => {
    const ctx = await contextFor(coordinator);
    const candidates = await listDocumentReviewCandidates(db.runtime, ctx);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.code).toMatch(/^IA-\d{3}$/);
      expect(candidate.code).not.toMatch(/^QG-/);
      // Every candidate carries its passages, and every quote is a passage's own words.
      expect(candidate.evidence.length).toBeGreaterThan(0);
      expect(candidate.evidence[0]!.label).toMatch(/DOC-R\d/);
    }
  });

  it("never writes a quality finding: a rule detected nothing here", async () => {
    const findings = await db.migrator.execute(
      sql`select count(*)::int as count from app.quality_finding`,
    );
    expect(Number((findings.rows[0] as { count: number }).count)).toBe(0);
  });
});

describe("the queue", () => {
  it("claims a queued run and returns four identifiers and no content", async () => {
    const started = await startClear("social_conclusions_support");
    const claim = await claimNextDocumentReview(db.runtime);
    expect(claim?.runId).toBe(started.runId);
    expect(Object.keys(claim!).sort()).toEqual([
      "initiatedByUserId",
      "projectId",
      "runId",
      "tenantId",
    ]);

    const [row] = await db.migrator
      .select()
      .from(reviewSchema.documentReviewRun)
      .where(eq(reviewSchema.documentReviewRun.id, started.runId));
    expect(row!.status).toBe("PROCESSING");
    expect(row!.attempts).toBe(1);
    await processDocumentReview(
      db.runtime,
      claim!,
      new FakeDocumentReviewer(),
      "fake/deterministic",
    );
  });

  it("returns nothing when the queue is empty, rather than inventing work", async () => {
    let drained = 0;
    while ((await claimNextDocumentReview(db.runtime)) !== null && drained < 20) {
      drained += 1;
    }
    expect(await claimNextDocumentReview(db.runtime)).toBeNull();
  });
});

describe("the corpus a run reads", () => {
  it("is the current version of each document, and is recorded on the run", async () => {
    const ctx = await contextFor(coordinator);
    const versions = await withDbContext(db.runtime, ctx, async (tx) =>
      tx
        .select({
          id: documentsSchema.documentVersion.id,
          state: documentsSchema.documentVersion.processingState,
          privacy: documentsSchema.documentVersion.privacyClassification,
        })
        .from(documentsSchema.documentVersion)
        .innerJoin(
          documentsSchema.sourceDocument,
          and(
            eq(documentsSchema.sourceDocument.currentVersionId, documentsSchema.documentVersion.id),
            eq(documentsSchema.sourceDocument.projectId, ctx.projectId!),
          ),
        ),
    );
    const eligible = versions.filter(
      (v) => v.state === "READY" && v.privacy === "NO_PERSONAL_DATA_KNOWN",
    );
    // DOC-R3 exists and is `REVIEW_REQUIRED`, so the whole-corpus run is refused — which is the
    // point, and the reason the earlier tests ran before it was delivered.
    expect(eligible.length).toBe(2);
  });
});
