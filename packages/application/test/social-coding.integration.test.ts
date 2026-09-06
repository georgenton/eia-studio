import { randomUUID } from "node:crypto";

import { appSchema, fieldSchema, socialSchema } from "@eia/db";
import {
  AiProcessingNotAuthorized,
  AiUnavailable,
  FeatureDisabled,
  PermissionDenied,
  type ClassificationInput,
  type ClassifierCallOptions,
  type ClassifierResult,
  type OpenTextClassifier,
  type SessionUser,
} from "@eia/domain";
import {
  attempt,
  createAssignment,
  createCampaign,
  createParcelWithGeometry,
  createProjectMembership,
  createProvenanceRecord,
  createPublishedSurvey,
  createPublishedTaxonomy,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  createVisitWithInstance,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type SeededTaxonomy,
  type TwoTenantWorld,
} from "@eia/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  claimNextClassification,
  FakeClassifier,
  loadDistributions,
  loadOpenResponses,
  loadSocialMetrics,
  loadTabulation,
  processClassification,
  startClassificationRun,
  submitHumanReview,
  type ClassificationRunConfig,
} from "../src/index";

/**
 * The whole Social journey, through the real use-cases and the real database.
 *
 * The assertions that matter most are the negative ones. A model must never see an answer that is
 * not synthetic demonstration data, whoever asks; a technician must not reach the project's
 * codings; a proposal must survive its own correction unchanged. Each of those is checked here
 * against a classifier that records every call, so "the model was not invoked" is an assertion
 * rather than an inference.
 */
const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

/** A classifier that answers deterministically and remembers what it was asked. */
class RecordingClassifier implements OpenTextClassifier {
  readonly kind = "fake";
  readonly calls: Array<{ text: string; model: string }> = [];
  constructor(private readonly inner = new FakeClassifier()) {}
  async classify(
    input: ClassificationInput,
    options: ClassifierCallOptions,
  ): Promise<ClassifierResult> {
    this.calls.push({ text: input.text, model: options.model });
    return this.inner.classify(input, options);
  }
}

const db = getTestDatabase();
let w: TwoTenantWorld;
let taxonomy: SeededTaxonomy;
let specialist: { id: string; email: string };
let technician: { id: string; email: string };
let surveyVersionId: string;
let openQuestionId: string;
const demoAnswers: string[] = [];
let historicalAnswerId: string;
let historicalVersionId: string;
let historicalQuestionId: string;
let prov: string;

/** Explicit, as every environment must now be (IG4-001): a test selects the fake, nothing defaults. */
const RUN_CONFIG = {
  classifier: { state: "AVAILABLE", kind: "fake", model: "fake/deterministic", live: false },
} as const satisfies ClassificationRunConfig;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);

  for (const key of [
    "core.projects",
    "gis.maps",
    "gis.parcels",
    "field.surveys",
    "social.analytics",
    "social.ai_coding",
  ] as const) {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({ tenantId: w.tenantA.id, capabilityKey: key, entitled: true, enabled: true })
      .onConflictDoUpdate({
        target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
        set: { entitled: true, enabled: true },
      });
  }

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  const historicalProv = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "HISTORICAL_OBSERVED",
    })
  ).id;

  specialist = await createUser(db.migrator, "social-specialist");
  technician = await createUser(db.migrator, "field-tech");
  const specialistMembership = await memberOf(specialist, "SOCIAL_SPECIALIST");
  const technicianMembership = await memberOf(technician, "FIELD_TECHNICIAN");

  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  surveyVersionId = survey.versionId;

  // An open-text question, added to the draft before publication is impossible (the version is
  // already published), so this suite publishes its own version with one.
  const openSurvey = await publishSurveyWithOpenQuestion(prov);
  surveyVersionId = openSurvey.versionId;
  openQuestionId = openSurvey.questionId;

  const datasetVersion = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId,
  });

  // Two demo responses with open text, and one historical response with open text: the gate must
  // refuse the third even though everything else about it is identical.
  for (const [index, text] of [
    "Preocupa el polvo y el acceso al predio durante la obra.",
    "Consulta por el cruce peatonal cerca de la escuela.",
  ].entries()) {
    demoAnswers.push(
      await captureResponse({
        parcelCode: `PRED-SOC-${index}`,
        lon: -78.9 - index / 100,
        datasetVersionId: datasetVersion.id,
        campaignId: campaign.id,
        membershipId: technicianMembership,
        userId: technician.id,
        provenanceId: prov,
        text,
      }),
    );
  }
  // The historical response lives on its own published version, so a run can be aimed at it
  // deliberately. Deleting a submitted answer to get it out of the way is not an option — and
  // rightly so: the field triggers refuse it.
  const historicalSurvey = await publishSurveyWithOpenQuestion(historicalProv, "historical_survey");
  historicalVersionId = historicalSurvey.versionId;
  historicalQuestionId = historicalSurvey.questionId;
  const historicalCampaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: historicalProv,
    surveyVersionId: historicalVersionId,
  });
  historicalAnswerId = await captureResponse({
    parcelCode: "PRED-SOC-HIST",
    lon: -78.95,
    datasetVersionId: datasetVersion.id,
    campaignId: historicalCampaign.id,
    membershipId: technicianMembership,
    userId: technician.id,
    provenanceId: historicalProv,
    text: "Una respuesta que no es de demostración.",
    surveyVersionId: historicalVersionId,
    questionId: historicalQuestionId,
  });

  taxonomy = await createPublishedTaxonomy(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    versionLabel: "v1",
    codes: ["COMMUNICATION_INFORMATION", "ACCESS_PROPERTY_FENCES", "LOCAL_EMPLOYMENT"],
  });

  void specialistMembership;
});
afterAll(() => db.close());

async function memberOf(user: { id: string }, role: string): Promise<string> {
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: user.id,
    role: "MEMBER",
  });
  const projectMembership = await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: tenantMembership.id,
    role: role as "SOCIAL_SPECIALIST",
  });
  return projectMembership.id;
}

/** A published survey version carrying one LONG_TEXT question, which is what a run codes. */
async function publishSurveyWithOpenQuestion(
  provenanceId: string,
  key = "open_survey",
): Promise<{ versionId: string; questionId: string }> {
  const templateId = randomUUID();
  await db.migrator.insert(fieldSchema.surveyTemplate).values({
    id: templateId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    key,
    name: "Ficha con respuesta abierta",
    description: null,
  });
  const versionId = randomUUID();
  await db.migrator.insert(fieldSchema.surveyVersion).values({
    id: versionId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    templateId,
    versionLabel: "v1",
    status: "DRAFT",
    provenanceId,
  });
  const questionId = randomUUID();
  await db.migrator.insert(fieldSchema.surveyQuestion).values({
    id: questionId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    versionId,
    code: "concern_text",
    ordinal: 0,
    type: "LONG_TEXT",
    prompt: "Describa su preocupación en sus propias palabras.",
    helpText: null,
    required: false,
    sensitivity: "NON_PERSONAL",
  });
  const choiceId = randomUUID();
  await db.migrator.insert(fieldSchema.surveyQuestion).values({
    id: choiceId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    versionId,
    code: "has_concern",
    ordinal: 1,
    type: "BOOLEAN",
    prompt: "¿Tiene alguna preocupación?",
    helpText: null,
    required: false,
    sensitivity: "NON_PERSONAL",
  });
  await db.migrator
    .update(fieldSchema.surveyVersion)
    .set({ status: "PUBLISHED", publishedAt: new Date(), definitionHash: "open-hash" })
    .where(eq(fieldSchema.surveyVersion.id, versionId));
  void choiceId;
  return { versionId, questionId };
}

async function captureResponse(input: {
  parcelCode: string;
  lon: number;
  datasetVersionId: string;
  campaignId: string;
  membershipId: string;
  userId: string;
  provenanceId: string;
  text: string;
  surveyVersionId?: string;
  questionId?: string;
}): Promise<string> {
  const version = input.surveyVersionId ?? surveyVersionId;
  const question = input.questionId ?? openQuestionId;
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: input.provenanceId,
    datasetVersionId: input.datasetVersionId,
    parcelCode: input.parcelCode,
    lon: input.lon,
  });
  const assignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: input.provenanceId,
    campaignId: input.campaignId,
    parcelId: parcel.parcelId,
    assigneeMembershipId: input.membershipId,
    assigneeUserId: input.userId,
  });
  const { instanceId } = await createVisitWithInstance(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: input.provenanceId,
    assignmentId: assignment.id,
    technicianUserId: input.userId,
    surveyVersionId: version,
  });
  const answerId = randomUUID();
  await db.migrator.insert(fieldSchema.surveyAnswer).values({
    id: answerId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    instanceId,
    questionId: question,
    textValue: input.text,
  });
  await db.migrator
    .update(fieldSchema.surveyInstance)
    .set({ status: "SUBMITTED", submittedAt: new Date() })
    .where(eq(fieldSchema.surveyInstance.id, instanceId));
  return answerId;
}

const contextFor = (user: { id: string; email: string }) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
    requestId: randomUUID(),
  });

describe("Slice 4 · the demo-only AI processing gate", () => {
  it("refuses a run over a non-demo answer, and never calls the classifier", async () => {
    const ctx = await contextFor(specialist);
    const classifier = new RecordingClassifier();

    // A run aimed at the historical version: everything about it is ordinary — the specialist has
    // every permission, the capability is on, the question is open text — and the only thing that
    // differs is the regime of the data.
    await expect(
      startClassificationRun(
        db.runtime,
        ctx,
        {
          taxonomyVersionId: taxonomy.versionId,
          surveyVersionId: historicalVersionId,
          questionId: historicalQuestionId,
        },
        RUN_CONFIG,
      ),
    ).rejects.toBeInstanceOf(AiProcessingNotAuthorized);

    expect(classifier.calls).toHaveLength(0);
    const runs = await db.migrator.execute(
      sql`select count(*)::int as n from app.classification_run`,
    );
    expect((runs.rows[0] as { n: number }).n).toBe(0);
  });

  /**
   * IG4-001. A run whose environment has no classifier can never be processed: the queue would
   * show work that never moves, and the only way to find out why would be to read the worker's
   * logs. So nothing is written at all — not the run, not one pending classification.
   */
  it.each([
    ["nothing configured", { state: "UNAVAILABLE", reason: "NOT_CONFIGURED", detail: "d" }],
    [
      "the fake refused in a persistent environment",
      { state: "UNAVAILABLE", reason: "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT", detail: "d" },
    ],
    [
      "the gateway blocked by external configuration",
      { state: "UNAVAILABLE", reason: "BLOCKED_EXTERNAL_CONFIG", detail: "d" },
    ],
  ] as const)(
    "writes no run when the classifier is unavailable: %s",
    async (_label, classifier) => {
      const ctx = await contextFor(specialist);
      await expect(
        startClassificationRun(
          db.runtime,
          ctx,
          { taxonomyVersionId: taxonomy.versionId, surveyVersionId, questionId: openQuestionId },
          { classifier },
        ),
      ).rejects.toBeInstanceOf(AiUnavailable);

      const rows = await db.migrator.execute(sql`
      select (select count(*)::int from app.classification_run) as runs,
             (select count(*)::int from app.ai_classification) as classifications
    `);
      expect(rows.rows[0]).toEqual({ runs: 0, classifications: 0 });
    },
  );

  it("the worker refuses too, even if a pending row somehow names a non-demo answer", async () => {
    // Belt and braces: the run-level gate is not the only one. A row inserted directly — a bug, a
    // migration, a future feature — still cannot reach the model.
    const runId = randomUUID();
    await db.migrator.insert(socialSchema.classificationRun).values({
      id: runId,
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      taxonomyVersionId: taxonomy.versionId,
      sourceSurveyVersionId: surveyVersionId,
      sourceQuestionId: openQuestionId,
      requestedModel: RUN_CONFIG.classifier.model,
      classifierKind: "fake",
      promptVersion: "social-open-coding@1",
      promptHash: "0000000000000000",
      initiatedByUserId: specialist.id,
      provenanceId: prov,
    });
    const classificationId = randomUUID();
    await db.migrator.insert(socialSchema.aiClassification).values({
      id: classificationId,
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      runId,
      answerId: historicalAnswerId,
      status: "PENDING",
      provenanceId: prov,
    });

    const classifier = new RecordingClassifier();
    const claim = await claimNextClassification(db.runtime);
    expect(claim?.classificationId).toBe(classificationId);

    const outcome = await processClassification(db.runtime, claim!, classifier);
    expect(outcome.status).toBe("FAILED");
    expect(outcome.reason).toMatch(/ai_processing_not_authorized/);
    expect(classifier.calls).toHaveLength(0);

    await db.migrator.execute(sql`delete from app.classification_run where id = ${runId}`);
  });
});

describe("Slice 4 · a run, its proposals, and a specialist's decisions", () => {
  let runId: string;

  it("queues one pending classification per eligible demo answer", async () => {
    const ctx = await contextFor(specialist);
    const started = await startClassificationRun(
      db.runtime,
      ctx,
      { taxonomyVersionId: taxonomy.versionId, surveyVersionId, questionId: openQuestionId },
      RUN_CONFIG,
    );
    runId = started.runId;
    expect(started.queued).toBe(demoAnswers.length);

    const pending = await db.migrator.execute(sql`
      select count(*)::int as n from app.ai_classification where run_id = ${runId} and status = 'PENDING'
    `);
    expect((pending.rows[0] as { n: number }).n).toBe(demoAnswers.length);
  });

  /**
   * The cost guardrail, wired. The pure decision is `selectAnswersForRun` in the domain; what this
   * asserts is that the use-case obeys it — that a limited run really queues fewer rows, and that
   * the audit says a limit was applied rather than leaving a smaller run looking like a smaller
   * project.
   */
  it("a limited run queues only what was asked for, and records that it was limited", async () => {
    const ctx = await contextFor(specialist);
    const limited = await startClassificationRun(
      db.runtime,
      ctx,
      {
        taxonomyVersionId: taxonomy.versionId,
        surveyVersionId,
        questionId: openQuestionId,
        limit: 1,
      },
      RUN_CONFIG,
    );
    expect(limited.queued).toBe(1);
    expect(demoAnswers.length).toBeGreaterThan(1);

    const queued = await db.migrator.execute(sql`
      select count(*)::int as n from app.ai_classification where run_id = ${limited.runId}
    `);
    expect((queued.rows[0] as { n: number }).n).toBe(1);

    const audit = await db.migrator.execute(sql`
      select details from audit.log
       where object_id = ${limited.runId} and action = 'social.classification_run.started'
    `);
    expect((audit.rows[0] as { details: { limit: number; queued: number } }).details).toMatchObject(
      {
        limit: 1,
        queued: 1,
      },
    );

    await db.migrator.execute(sql`delete from app.classification_run where id = ${limited.runId}`);
  });

  it("records the configuration the run was created with", async () => {
    const rows = await db.migrator.execute(sql`
      select requested_model, classifier_kind, prompt_version, prompt_hash, status::text as status
        from app.classification_run where id = ${runId}
    `);
    expect(rows.rows[0]).toMatchObject({
      requested_model: "fake/deterministic",
      classifier_kind: "fake",
      prompt_version: "social-open-coding@1",
      status: "PENDING",
    });
    // The prompt hash is a real fingerprint, not a placeholder.
    expect((rows.rows[0] as { prompt_hash: string }).prompt_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("the worker processes each one exactly once, and two workers do not collide", async () => {
    const classifier = new RecordingClassifier();

    // Two claims in flight at once: `FOR UPDATE SKIP LOCKED` must hand them different rows.
    const [first, second] = await Promise.all([
      claimNextClassification(db.runtime),
      claimNextClassification(db.runtime),
    ]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.classificationId).not.toBe(second!.classificationId);

    for (const claim of [first!, second!]) {
      const outcome = await processClassification(db.runtime, claim, classifier);
      expect(outcome.status).toBe("SUCCEEDED");
    }
    expect(classifier.calls).toHaveLength(2);

    // Nothing left to claim, and no duplicate proposals.
    expect(await claimNextClassification(db.runtime)).toBeNull();
    const counts = await db.migrator.execute(sql`
      select count(*)::int as total,
             count(*) filter (where status = 'SUCCEEDED')::int as succeeded
        from app.ai_classification where run_id = ${runId}
    `);
    expect(counts.rows[0]).toMatchObject({ total: 2, succeeded: 2 });
  });

  it("stores usage and latency, and marks the run complete", async () => {
    const rows = await db.migrator.execute(sql`
      select model_id, provider, input_tokens, output_tokens, total_tokens, latency_ms
        from app.ai_classification where run_id = ${runId} limit 1
    `);
    const row = rows.rows[0] as Record<string, unknown>;
    expect(row.model_id).toBe("fake:fake/deterministic");
    expect(Number(row.total_tokens)).toBeGreaterThan(0);
    expect(Number(row.latency_ms)).toBeGreaterThanOrEqual(0);

    const run = await db.migrator.execute(sql`
      select status::text as status, resolved_model, completed_at from app.classification_run
       where id = ${runId}
    `);
    expect(run.rows[0]).toMatchObject({
      status: "COMPLETED",
      resolved_model: "fake:fake/deterministic",
    });
  });

  it("a specialist accepts one proposal and corrects another, and the proposal survives", async () => {
    const ctx = await contextFor(specialist);
    const responses = await loadOpenResponses(db.runtime, ctx, { surveyVersionId });
    expect(responses).toHaveLength(2);

    const [first, second] = responses;
    const proposedFirst = first!.proposed.map((c) => c.code);

    const accepted = await submitHumanReview(db.runtime, ctx, {
      classificationId: first!.classificationId!,
      categoryCodes: proposedFirst,
      reviewStartedAt: new Date().toISOString(),
    });
    expect(accepted.decision).toBe("ACCEPTED");

    // The correction from the slice brief: drop one proposed label, add another.
    const corrected = await submitHumanReview(db.runtime, ctx, {
      classificationId: second!.classificationId!,
      categoryCodes: ["COMMUNICATION_INFORMATION", "ACCESS_PROPERTY_FENCES"],
      reviewStartedAt: new Date().toISOString(),
    });
    expect(corrected.decision).toBe("CORRECTED");

    // …and the proposal is exactly what the model said, after the human disagreed with it.
    const proposal = await db.migrator.execute(sql`
      select cat.code from app.ai_classification_category link
        join app.taxonomy_category cat on cat.id = link.category_id
       where link.classification_id = ${second!.classificationId!}
       order by cat.ordinal
    `);
    const stillProposed = (proposal.rows as Array<{ code: string }>).map((r) => r.code);
    expect(stillProposed).toEqual(second!.proposed.map((c) => c.code));
  });

  it("validated metrics count human labels only, and agreement is not called accuracy", async () => {
    const ctx = await contextFor(specialist);
    const metrics = await loadSocialMetrics(db.runtime, ctx, surveyVersionId);
    expect(metrics.reviewed).toBe(2);
    expect(metrics.pendingReview).toBe(0);
    expect(metrics.agreement.exactMatches).toBe(1);
    expect(metrics.agreement.overrides).toBe(1);
    expect(metrics.agreement.agreementRate).toBeCloseTo(0.5);

    const distributions = await loadDistributions(db.runtime, ctx, surveyVersionId);
    expect(distributions.validated.reviewed).toBe(2);
    // The validated distribution is built from review rows; the provisional one from proposals.
    // They are separate objects with separate denominators, and neither borrows the other's.
    expect(distributions.validated.tallies.length).toBeGreaterThan(0);
    expect(distributions.provisional.reviewed).toBe(2);
  });

  it("a second review of the same proposal is refused", async () => {
    const ctx = await contextFor(specialist);
    const responses = await loadOpenResponses(db.runtime, ctx, { surveyVersionId });
    // `attempt` walks the cause chain: drizzle wraps the PostgreSQL error, so the constraint name
    // is not in the top-level message.
    const error = await attempt(
      submitHumanReview(db.runtime, ctx, {
        classificationId: responses[0]!.classificationId!,
        categoryCodes: ["OTHER"],
        reviewStartedAt: null,
      }),
    );
    expect(error).toMatch(/human_review_classification_key|duplicate key/i);
  });
});

describe("Slice 4 · who may see and do what", () => {
  it("a field technician cannot read the project's codings or start a run", async () => {
    const ctx = await contextFor(technician);
    await expect(loadOpenResponses(db.runtime, ctx, { surveyVersionId })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(
      startClassificationRun(
        db.runtime,
        ctx,
        { taxonomyVersionId: taxonomy.versionId, surveyVersionId, questionId: openQuestionId },
        RUN_CONFIG,
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(loadSocialMetrics(db.runtime, ctx, surveyVersionId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("an internal viewer is denied rather than shown a tabulation of zeros", async () => {
    // memberA is a VIEWER on project X: `social.read` yes, `field.responses.read` no.
    //
    // The counts are computed from response rows under RLS, so without that permission every
    // figure would come back zero — a plausible-looking, entirely false tabulation. Denying is the
    // honest outcome, and the surface says which permission is missing (TD-045 records the
    // aggregate projection that would let a viewer see real totals without seeing rows).
    const ctx = await contextFor(w.memberA);
    await expect(loadTabulation(db.runtime, ctx, surveyVersionId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(loadOpenResponses(db.runtime, ctx, { surveyVersionId })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("with social.ai_coding disabled, tabulation still works and runs do not", async () => {
    await db.migrator.execute(sql`
      insert into app.project_capability_setting (tenant_id, project_id, capability_key, enabled)
      values (${w.tenantA.id}, ${w.projectX.id}, 'social.ai_coding', false)
    `);

    const ctx = await contextFor(specialist);
    // Deterministic analytics do not depend on a model being available. That is the whole point of
    // keeping the two capabilities separate.
    const tabulation = await loadTabulation(db.runtime, ctx, surveyVersionId);
    expect(tabulation.questions.length).toBeGreaterThan(0);

    await expect(
      startClassificationRun(
        db.runtime,
        ctx,
        { taxonomyVersionId: taxonomy.versionId, surveyVersionId, questionId: openQuestionId },
        RUN_CONFIG,
      ),
    ).rejects.toBeInstanceOf(FeatureDisabled);

    await db.migrator.execute(sql`
      delete from app.project_capability_setting
       where tenant_id = ${w.tenantA.id} and capability_key = 'social.ai_coding'
    `);
  });
});
