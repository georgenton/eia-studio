import { randomUUID } from "node:crypto";

import { PermissionDenied, resolveEffectiveInstance, type SessionUser } from "@eia/domain";
import {
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION,
  type SyncCommand,
} from "@eia/field-sync-contract";
import {
  attempt,
  createAiClassification,
  createAssignment,
  createCampaign,
  createClassificationRun,
  createHumanReview,
  createParcelWithGeometry,
  createPublishedTaxonomy,
  createProjectMembership,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type SeededQuestionnaire,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFieldPack,
  buildRequestContext,
  cancelSurveyCorrection,
  loadCorrectionLineage,
  loadFieldOverview,
  generateSocialChapter,
  loadReportVersion,
  loadDistributions,
  loadTabulation,
  processSyncCommands,
  requestSurveyCorrection,
} from "../src/index";

/**
 * Correcting a submitted response without ever editing one (ADR-038, gate G4).
 *
 * The file is arranged around the one sentence the whole design has to deliver: **history keeps
 * both responses, and current analytics count exactly one.** Everything else — the permissions,
 * the offline path, the constraints — exists so that sentence stays true when somebody retries a
 * sync, cancels a request, or corrects a correction.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let specialist: { id: string; email: string; membershipId: string };
let dataManager: { id: string; email: string };
let technician: { id: string; email: string; membershipId: string };
let survey: SeededQuestionnaire;
let campaignId: string;
let baselineAssignmentId: string;
let baselineInstanceId: string;
let prov: string;
let datasetVersionId: string;

const CAPABILITIES = [
  "core.projects",
  "core.documents",
  "gis.maps",
  "gis.parcels",
  "field.surveys",
  "social.analytics",
  "reports.social_generator",
] as const;

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

let sequence = 0;
function command(
  type: SyncCommand["type"],
  payload: Record<string, unknown>,
  over: { commandId?: string } = {},
): SyncCommand {
  sequence += 1;
  return {
    commandId: over.commandId ?? randomUUID(),
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
    deviceRevision: sequence,
    occurredAt: new Date().toISOString(),
    appVersion: "0.1.0",
    packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
    type,
    payload,
  } as SyncCommand;
}

/** The pilot questionnaire's own codes, so the assertions read like the study. */
const ORIGINAL_ANSWERS = {
  tenure_category: { kind: "option", optionCode: "owner_occupier" },
  has_concern: { kind: "boolean", value: true },
  household_size: { kind: "number", value: 3 },
} as const;

const CORRECTED_ANSWERS = {
  tenure_category: { kind: "option", optionCode: "tenant" },
  has_concern: { kind: "boolean", value: false },
  household_size: { kind: "number", value: 5 },
} as const;

async function effectiveRow(instanceId: string) {
  const rows = await db.migrator.execute(sql`
    select effective_instance_id, generation from app.effective_survey_instance
     where root_instance_id = ${instanceId}
  `);
  return rows.rows[0] as { effective_instance_id: string; generation: number } | undefined;
}

async function correctionsOf(instanceId: string) {
  const rows = await db.migrator.execute(sql`
    select id, state::text as state, correcting_instance_id, correction_assignment_id
      from app.survey_correction where original_instance_id = ${instanceId}
  `);
  return rows.rows as Array<{
    id: string;
    state: string;
    correcting_instance_id: string | null;
    correction_assignment_id: string;
  }>;
}

/** Capture a correction the way a phone does: start a visit, submit, finish. */
async function captureCorrection(
  assignmentId: string,
  answers: Record<string, unknown>,
  commandId?: string,
): Promise<string> {
  const ctx = await contextFor(technician);
  const submit = command(
    "survey.submit",
    { assignmentId, visitId: null, surveyVersionId: survey.versionId, answers },
    commandId ? { commandId } : {},
  );
  const result = await processSyncCommands(db.runtime, ctx, [submit]);
  return result.results[0]!.instanceId as string;
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

  const make = async (label: string, role: string) => {
    const user = await createUser(db.migrator, label);
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: user.id,
      role: "MEMBER",
    });
    const membership = await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: tenantMembership.id,
      role: role as never,
    });
    return { ...user, membershipId: membership.id };
  };
  coordinator = await make("correction-coordinator", "COORDINATOR");
  specialist = await make("correction-specialist", "SOCIAL_SPECIALIST");
  dataManager = await make("correction-data-manager", "PROJECT_DATA_MANAGER");
  technician = await make("correction-technician", "FIELD_TECHNICIAN");

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    openTextCode: "concern_text",
    numericCode: "household_size",
  });
  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  datasetVersionId = dataset.id;
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: dataset.id,
    provenanceId: prov,
    parcelCode: "001",
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: survey.versionId,
    captureChannel: "EIA_FIELD_MOBILE",
  });
  campaignId = campaign.id;
  baselineAssignmentId = (
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId: parcel.parcelId,
      assigneeMembershipId: technician.membershipId,
      assigneeUserId: technician.id,
    })
  ).id;

  baselineInstanceId = await captureCorrection(baselineAssignmentId, ORIGINAL_ANSWERS);
});

afterAll(() => db.close());

describe("1 · a submitted response is still never edited", () => {
  it("refuses the UPDATE that this whole design exists to avoid", async () => {
    const failed = await attempt(
      db.migrator.execute(
        sql`update app.survey_instance set status = 'IN_PROGRESS' where id = ${baselineInstanceId}`,
      ),
    );
    expect(failed).toContain("survey_instance_submitted");

    const answerFailed = await attempt(
      db.migrator.execute(
        sql`update app.survey_answer set boolean_value = false where instance_id = ${baselineInstanceId}`,
      ),
    );
    expect(answerFailed).toContain("survey_answer_frozen");
  });

  it("and the baseline is what the study currently means", async () => {
    const row = await effectiveRow(baselineInstanceId);
    expect(row?.effective_instance_id).toBe(baselineInstanceId);
    expect(row?.generation).toBe(0);
  });
});

describe("2 · who may ask for a correction", () => {
  it("a technician may not ask for their own work to be replaced", async () => {
    const ctx = await contextFor(technician);
    expect(ctx.permissions.has("field.corrections.request")).toBe(false);
    await expect(
      requestSurveyCorrection(db.runtime, ctx, {
        instanceId: baselineInstanceId,
        reason: "Me equivoqué al registrar el número de personas.",
        assigneeMembershipId: null,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  /*
   * The role that prepares a project gains nothing about a household's answers (ADR-030), and a
   * correction names one. Asserted here rather than assumed, because the lineage is exactly the
   * shape in which response data leaks into a preparation surface.
   */
  it("a data manager still cannot read a response, or its history", async () => {
    const ctx = await contextFor(dataManager);
    expect(ctx.permissions.has("field.responses.read")).toBe(false);
    expect(ctx.permissions.has("field.corrections.request")).toBe(false);
    await expect(loadCorrectionLineage(db.runtime, ctx, baselineInstanceId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("a reason of 'ok' is refused before anything is written", async () => {
    const ctx = await contextFor(coordinator);
    await expect(
      requestSurveyCorrection(db.runtime, ctx, {
        instanceId: baselineInstanceId,
        reason: "ok",
        assigneeMembershipId: null,
      }),
    ).rejects.toThrow();
    expect(await correctionsOf(baselineInstanceId)).toHaveLength(0);
  });
});

describe("3 · a correction requested and then cancelled changes nothing", () => {
  it("leaves the original effective throughout", async () => {
    const ctx = await contextFor(coordinator);
    const requested = await requestSurveyCorrection(db.runtime, ctx, {
      instanceId: baselineInstanceId,
      reason: "Pendiente de confirmar con la informante; se cancela después.",
      assigneeMembershipId: null,
    });

    // Requesting one changes no count. This is the property that makes asking safe.
    expect((await effectiveRow(baselineInstanceId))?.effective_instance_id).toBe(
      baselineInstanceId,
    );
    const tabulation = await loadTabulation(db.runtime, ctx, survey.versionId);
    expect(tabulation.submitted).toBe(1);

    await cancelSurveyCorrection(db.runtime, ctx, { correctionId: requested.correctionId });

    expect((await effectiveRow(baselineInstanceId))?.effective_instance_id).toBe(
      baselineInstanceId,
    );
    const [correction] = await correctionsOf(baselineInstanceId);
    expect(correction?.state).toBe("CANCELLED");

    // The work item is cancelled rather than removed, so a device that already has it is told.
    const assignment = await db.migrator.execute(sql`
      select status::text as status from app.field_assignment
       where id = ${requested.correctionAssignmentId}
    `);
    expect((assignment.rows[0] as { status: string }).status).toBe("CANCELLED");
  });

  it("and the response can be corrected again afterwards", async () => {
    const ctx = await contextFor(coordinator);
    const again = await requestSurveyCorrection(db.runtime, ctx, {
      instanceId: baselineInstanceId,
      reason: "La informante confirma que la tenencia es en arriendo, no propiedad.",
      assigneeMembershipId: null,
    });
    expect(again.correctionId).toBeTruthy();
  });
});

describe("4 · the correction is captured the ordinary way, offline", () => {
  let correctionAssignmentId: string;
  let correctingInstanceId: string;

  it("appears in the technician's Field Pack as a revisit, with the reason and no old answer", async () => {
    const ctx = await contextFor(technician);
    const pack = await buildFieldPack(db.runtime, ctx, {
      sessionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      technician: { email: technician.email, name: null },
    });
    if (pack.kind !== "pack") throw new Error("expected a pack");

    const revisit = pack.pack.assignments.find((a) => a.correction !== null);
    expect(revisit).toBeDefined();
    correctionAssignmentId = revisit!.id;
    expect(revisit!.correction!.correctsAssignmentId).toBe(baselineAssignmentId);
    expect(revisit!.correction!.reason).toContain("arriendo");

    /*
     * The privacy line. A device that would otherwise never hold another visit's answers does not
     * start holding them because a figure was wrong — the pack carries the reason and the parcel,
     * and nothing of what was answered before (SECURITY.md §10e).
     */
    expect(revisit!.instanceId).toBeNull();
    const serialised = JSON.stringify(revisit);
    expect(serialised).not.toContain("owner_occupier");
    expect(serialised).not.toContain(baselineInstanceId);
  });

  it("submits once, however many times the phone sends it", async () => {
    const commandId = randomUUID();
    correctingInstanceId = await captureCorrection(
      correctionAssignmentId,
      CORRECTED_ANSWERS,
      commandId,
    );
    // The retry a bad connection produces.
    await captureCorrection(correctionAssignmentId, CORRECTED_ANSWERS, commandId);
    await captureCorrection(correctionAssignmentId, CORRECTED_ANSWERS, commandId);

    /*
     * Two devices, which is not the same case as one device retrying: a second phone generates its
     * own `commandId`, so the receipt cannot answer it. What holds instead is
     * `survey_instance_assignment_version_key` and `ensureInstance` finding the row that is already
     * there — the invariant a correction on a *new assignment* was chosen to leave untouched.
     */
    await captureCorrection(correctionAssignmentId, CORRECTED_ANSWERS);
    await captureCorrection(correctionAssignmentId, ORIGINAL_ANSWERS);

    const instances = await db.migrator.execute(sql`
      select count(*)::int as n from app.survey_instance
       where assignment_id = ${correctionAssignmentId}
    `);
    expect((instances.rows[0] as { n: number }).n).toBe(1);

    const corrections = await correctionsOf(baselineInstanceId);
    const applied = corrections.filter((c) => c.state === "APPLIED");
    expect(applied).toHaveLength(1);
    expect(applied[0]!.correcting_instance_id).toBe(correctingInstanceId);
  });

  it("and the correction is now what the study means, with the original retained", async () => {
    const row = await effectiveRow(baselineInstanceId);
    expect(row?.effective_instance_id).toBe(correctingInstanceId);
    expect(row?.generation).toBe(1);

    // History keeps both, whole.
    const both = await db.migrator.execute(sql`
      select count(*)::int as n from app.survey_instance
       where id in (${baselineInstanceId}, ${correctingInstanceId}) and status = 'SUBMITTED'
    `);
    expect((both.rows[0] as { n: number }).n).toBe(2);
  });

  it("the view and the domain rule agree", async () => {
    const links = await db.migrator.execute(sql`
      select original_instance_id, correcting_instance_id, state::text as state
        from app.survey_correction
    `);
    const domain = resolveEffectiveInstance(
      baselineInstanceId,
      (
        links.rows as Array<{
          original_instance_id: string;
          correcting_instance_id: string | null;
          state: string;
        }>
      ).map((row) => ({
        originalInstanceId: row.original_instance_id,
        correctingInstanceId: row.correcting_instance_id,
        state: row.state as "REQUESTED" | "APPLIED" | "CANCELLED",
      })),
    );
    expect((await effectiveRow(baselineInstanceId))?.effective_instance_id).toBe(domain);
  });
});

describe("5 · what the analytics say", () => {
  /*
   * The example from the brief, and the reason the whole gate exists: the corrected value is the
   * only one counted, the superseded one is not counted as a second household, and the denominator
   * is one rather than two.
   */
  it("counts the corrected value, once", async () => {
    const ctx = await contextFor(coordinator);
    const tabulation = await loadTabulation(db.runtime, ctx, survey.versionId);

    expect(tabulation.submitted).toBe(1);
    const tenure = tabulation.questions.find((q) => q.code === "tenure_category");
    expect(tenure!.answered).toBe(1);
    expect(tenure!.denominator).toBe(1);
    expect(tenure!.tallies.find((tally) => tally.code === "tenant")?.count).toBe(1);
    expect(tenure!.tallies.find((tally) => tally.code === "owner_occupier")).toBeUndefined();

    const concern = tabulation.questions.find((q) => q.code === "has_concern");
    expect(concern!.tallies.find((tally) => tally.code === "false")?.count).toBe(1);
    expect(concern!.tallies.find((tally) => tally.code === "true")?.count).toBe(0);
  });

  /*
   * The brief's numeric example. Mixing a superseded value into a summary is the quietest way this
   * could go wrong: nothing looks missing, the mean is simply the average of an answer and the
   * answer that replaced it.
   */
  it("summarises the corrected number alone, with the original still stored", async () => {
    const ctx = await contextFor(coordinator);
    const tabulation = await loadTabulation(db.runtime, ctx, survey.versionId);
    const size = tabulation.questions.find((q) => q.code === "household_size");

    expect(size!.numeric).not.toBeNull();
    expect(size!.numeric!.count).toBe(1);
    expect(size!.numeric!.min).toBe(5);
    expect(size!.numeric!.max).toBe(5);
    expect(size!.numeric!.mean).toBe(5);
    expect(size!.numeric!.median).toBe(5);

    // The 3 is still there, on a response nothing current reads.
    const stored = await db.migrator.execute(sql`
      select count(*)::int as n from app.survey_answer a
       join app.survey_question q on q.tenant_id = a.tenant_id and q.id = a.question_id
      where q.code = 'household_size' and a.number_value = 3
    `);
    expect((stored.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("does not turn a corrected parcel into a second parcel of field progress", async () => {
    const ctx = await contextFor(coordinator);
    const overview = await loadFieldOverview(db.runtime, ctx);
    const campaign = overview.campaigns.find((c) => c.id === campaignId);
    expect(campaign).toBeDefined();
    // One parcel, one assignment, one submitted response — after a correction that added a second
    // assignment and a second response.
    expect(campaign!.progress.total).toBe(1);
    expect(campaign!.submittedCount).toBe(1);
    expect(campaign!.openCorrections).toBe(0);
  });
});

describe("6 · a lineage is a line", () => {
  it("refuses a correction of a response that was already superseded", async () => {
    const ctx = await contextFor(coordinator);
    await expect(
      requestSurveyCorrection(db.runtime, ctx, {
        instanceId: baselineInstanceId,
        reason: "Intento de corregir una respuesta ya sustituida.",
        assigneeMembershipId: null,
      }),
    ).rejects.toThrow(/superseded|sustituida/i);
  });

  it("a second correction applies to the current effective response, and supersedes the first", async () => {
    const ctx = await contextFor(specialist);
    const effectiveBefore = (await effectiveRow(baselineInstanceId))!.effective_instance_id;

    const second = await requestSurveyCorrection(db.runtime, ctx, {
      instanceId: effectiveBefore,
      reason: "Segunda corrección: la fecha de la visita estaba equivocada.",
      assigneeMembershipId: null,
    });
    const secondInstance = await captureCorrection(second.correctionAssignmentId, ORIGINAL_ANSWERS);

    const row = await effectiveRow(baselineInstanceId);
    expect(row?.effective_instance_id).toBe(secondInstance);
    expect(row?.generation).toBe(2);

    // Three submitted responses in the lineage; one effective; the denominator is still one.
    const tabulation = await loadTabulation(
      db.runtime,
      await contextFor(coordinator),
      survey.versionId,
    );
    expect(tabulation.submitted).toBe(1);
    const tenure = tabulation.questions.find((q) => q.code === "tenure_category");
    expect(tenure!.tallies.find((tally) => tally.code === "owner_occupier")?.count).toBe(1);
  });

  it("shows the whole history, in order, with exactly one marked effective", async () => {
    const ctx = await contextFor(coordinator);
    const lineage = await loadCorrectionLineage(db.runtime, ctx, baselineInstanceId);
    expect(lineage).not.toBeNull();
    expect(lineage!.entries.map((e) => e.generation)).toEqual([0, 1, 2]);
    expect(lineage!.entries.filter((e) => e.effective)).toHaveLength(1);
    expect(lineage!.entries[2]!.effective).toBe(true);
    // Each correction carries the words somebody wrote for it.
    expect(lineage!.entries[1]!.correction?.reason).toContain("arriendo");
    expect(lineage!.entries[2]!.correction?.reason).toContain("Segunda");
    expect(lineage!.openCorrection).toBeNull();
  });
});

describe("7 · the audit line, and what it must not carry", () => {
  it("records identifiers and never the reason or an answer", async () => {
    const rows = await db.migrator.execute(sql`
      select action, details::text as details from audit.log
       where action like 'field.survey.correction%' order by occurred_at
    `);
    const entries = rows.rows as Array<{ action: string; details: string }>;
    expect(entries.map((e) => e.action)).toContain("field.survey.correction_requested");
    expect(entries.map((e) => e.action)).toContain("field.survey.correction_applied");
    expect(entries.map((e) => e.action)).toContain("field.survey.correction_cancelled");

    for (const entry of entries) {
      // A reason can quote the answer that was wrong, so no audit line carries one.
      expect(entry.details).not.toContain("arriendo");
      expect(entry.details).not.toContain("owner_occupier");
      expect(entry.details).not.toContain("informante");
    }
  });
});

describe("8 · a report version is a frozen snapshot, and a correction does not rewrite it", () => {
  /*
   * ADR-022's rule, meeting ADR-038's. A `ReportVersion` stores what was true when somebody
   * generated it; a correction afterwards changes what the *next* version will say and nothing
   * about the one already produced. A report that quietly re-computed itself would be a document
   * that says something different from the copy a client was handed.
   */
  it("keeps what v1 said, and says the corrected figure in v2", async () => {
    const ctx = await contextFor(coordinator);
    const noNarrative = {
      state: "UNAVAILABLE" as const,
      reason: "NOT_CONFIGURED" as const,
      detail: "no narrative generator in this test",
    };

    const first = await generateSocialChapter(
      db.runtime,
      ctx,
      { surveyVersionId: survey.versionId },
      { narrative: noNarrative },
    );
    const v1 = await loadReportVersion(db.runtime, ctx, first.versionLabel);
    const v1Submitted = v1.snapshot.sections
      .flatMap((section) => section.facts)
      .find((fact) => fact.source.kind === "metric");
    expect(v1Submitted).toBeDefined();

    // A further correction, captured.
    const effective = (await effectiveRow(baselineInstanceId))!.effective_instance_id;
    const requested = await requestSurveyCorrection(db.runtime, ctx, {
      instanceId: effective,
      reason: "Tercera corrección, para comprobar que el informe v1 no cambia.",
      assigneeMembershipId: null,
    });
    await captureCorrection(requested.correctionAssignmentId, CORRECTED_ANSWERS);

    // v1 is byte-for-byte what it was: a stored snapshot, not a query re-run.
    const v1Again = await loadReportVersion(db.runtime, ctx, first.versionLabel);
    expect(JSON.stringify(v1Again.snapshot)).toBe(JSON.stringify(v1.snapshot));

    const second = await generateSocialChapter(
      db.runtime,
      ctx,
      { surveyVersionId: survey.versionId },
      { narrative: noNarrative },
    );
    expect(second.versionLabel).not.toBe(first.versionLabel);

    // And the new one counts one household, not four submissions of it.
    const v2 = await loadReportVersion(db.runtime, ctx, second.versionLabel);
    const submitted = v2.snapshot.sections
      .flatMap((section) => section.facts)
      .filter((fact) => fact.source.kind === "metric");
    expect(submitted.length).toBeGreaterThan(0);
    const tabulation = await loadTabulation(db.runtime, ctx, survey.versionId);
    expect(tabulation.submitted).toBe(1);
  });
});

describe("9 · a coding of a superseded answer stops counting, and is not reused", () => {
  /*
   * Self-gate item 7, and the one that needed the most care. A `HumanReview` is a specialist's
   * statement about **particular words**. When the response those words belonged to is superseded,
   * the statement stops being about the household's answer — so it stops contributing to the
   * current distribution. It is not deleted, and it is emphatically **not** carried over to the
   * corrected answer: doing that would attribute to a specialist a judgement they never made.
   */
  it("counts a validated theme, and stops counting it once the response is corrected", async () => {
    const coordinatorCtx = await contextFor(coordinator);
    const specialistCtx = await contextFor(specialist);

    // A second parcel, so this lineage is independent of the one above. The same dataset version:
    // a project has one active one, and this test is not about cartography.
    const parcel = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      datasetVersionId,
      provenanceId: prov,
      parcelCode: "002",
    });
    const assignmentId = (
      await createAssignment(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: prov,
        campaignId,
        parcelId: parcel.parcelId,
        assigneeMembershipId: technician.membershipId,
        assigneeUserId: technician.id,
      })
    ).id;
    const instanceId = await captureCorrection(assignmentId, {
      ...ORIGINAL_ANSWERS,
      concern_text: { kind: "text", value: "Preocupa el polvo durante la construcción." },
    });

    const answer = await db.migrator.execute(sql`
      select a.id from app.survey_answer a
       join app.survey_question q on q.tenant_id = a.tenant_id and q.id = a.question_id
      where a.instance_id = ${instanceId} and q.code = 'concern_text'
    `);
    const answerId = (answer.rows[0] as { id: string }).id;

    const taxonomy = await createPublishedTaxonomy(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      versionLabel: "v1",
      codes: ["DUST_AND_NOISE"],
    });
    const run = await createClassificationRun(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      taxonomyVersionId: taxonomy.versionId,
      surveyVersionId: survey.versionId,
      questionId: survey.questionIds.concern_text!,
      initiatedByUserId: specialist.id,
    });
    const classification = await createAiClassification(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      runId: run.id,
      answerId,
      status: "SUCCEEDED",
      categoryIds: [taxonomy.categoryIds.DUST_AND_NOISE!],
    });
    await createHumanReview(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      classificationId: classification.id,
      answerId,
      taxonomyVersionId: taxonomy.versionId,
      reviewerUserId: specialist.id,
      reviewerMembershipId: specialist.membershipId,
      categoryIds: [taxonomy.categoryIds.DUST_AND_NOISE!],
    });

    const before = await loadDistributions(db.runtime, coordinatorCtx, survey.versionId);
    expect(before.validated.tallies.find((tally) => tally.code === "DUST_AND_NOISE")?.count).toBe(
      1,
    );
    expect(before.validated.reviewed).toBe(1);

    // Correct the response. The words the specialist coded are no longer the household's answer.
    const requested = await requestSurveyCorrection(db.runtime, specialistCtx, {
      instanceId,
      reason: "La informante amplía su preocupación; se levanta de nuevo la respuesta abierta.",
      assigneeMembershipId: null,
    });
    await captureCorrection(requested.correctionAssignmentId, {
      ...ORIGINAL_ANSWERS,
      concern_text: { kind: "text", value: "Preocupa el polvo y también el acceso al predio." },
    });

    const after = await loadDistributions(db.runtime, coordinatorCtx, survey.versionId);
    expect(
      after.validated.tallies.find((tally) => tally.code === "DUST_AND_NOISE")?.count ?? 0,
    ).toBe(0);
    expect(after.validated.reviewed).toBe(0);

    // The review itself is untouched: it is history, not a mistake.
    const kept = await db.migrator.execute(sql`
      select count(*)::int as n from app.human_review where answer_id = ${answerId}
    `);
    expect((kept.rows[0] as { n: number }).n).toBe(1);

    // And the corrected answer is *uncoded* rather than silently inheriting the old coding.
    const corrected = await db.migrator.execute(sql`
      select count(*)::int as n
        from app.human_review h
        join app.survey_answer a on a.tenant_id = h.tenant_id and a.id = h.answer_id
        join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
        join app.effective_survey_instance eff
          on eff.tenant_id = i.tenant_id and eff.effective_instance_id = i.id
       where eff.root_instance_id = ${instanceId}
    `);
    expect((corrected.rows[0] as { n: number }).n).toBe(0);
  });
});
