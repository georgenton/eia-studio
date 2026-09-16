import { randomUUID } from "node:crypto";

import { appSchema, fieldSchema } from "@eia/db";
import { PermissionDenied, type SessionUser } from "@eia/domain";
import {
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION,
  type SyncCommand,
} from "@eia/field-sync-contract";
import {
  createAssignment,
  createCampaign,
  createParcelWithGeometry,
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
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFieldPack,
  buildRequestContext,
  processSyncCommands,
  pullFieldChanges,
} from "../src/index";

/**
 * EIA Field's server half, against a real database.
 *
 * Everything here exists to check one sentence: **the same command, sent any number of times,
 * produces one result and one set of rows.** A phone in a valley retries; a technician taps twice;
 * an application is killed between a request and its answer. None of those may become two visits,
 * two responses or two sets of answers in a study.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let technician: { id: string; email: string; membershipId: string };
let otherTechnician: { id: string; email: string; membershipId: string };
let survey: SeededQuestionnaire;
let campaignId: string;
let assignmentId: string;
let otherAssignmentId: string;
let prov: string;

const CAPABILITIES = ["core.projects", "gis.maps", "gis.parcels", "field.surveys"] as const;

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
  over: { commandId?: string; deviceRevision?: number } = {},
): SyncCommand {
  sequence += 1;
  return {
    commandId: over.commandId ?? randomUUID(),
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
    deviceRevision: over.deviceRevision ?? sequence,
    occurredAt: new Date().toISOString(),
    appVersion: "0.1.0",
    packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
    type,
    payload,
  } as SyncCommand;
}

const COMPLETE_ANSWERS = {
  has_concern: { kind: "boolean" as const, value: true },
};

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

  const make = async (label: string) => {
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
      role: "FIELD_TECHNICIAN",
    });
    return { ...user, membershipId: membership.id };
  };
  technician = await make("field-tech-a");
  otherTechnician = await make("field-tech-b");

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
    translations: {
      locale: "en",
      questions: {
        tenure_category: { prompt: "Relationship to the parcel?" },
        has_concern: { prompt: "Do you have any concern?" },
      },
      options: { owner_occupier: "Owner-occupier" },
    },
  });

  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  const parcelA = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: dataset.id,
    provenanceId: prov,
    parcelCode: "001",
  });
  const parcelB = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    datasetVersionId: dataset.id,
    provenanceId: prov,
    parcelCode: "002",
  });

  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: survey.versionId,
    // The channel that declares offline support; this whole suite is about that claim.
    captureChannel: "EIA_FIELD_MOBILE",
  });
  campaignId = campaign.id;

  assignmentId = (
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId: parcelA.parcelId,
      assigneeMembershipId: technician.membershipId,
      assigneeUserId: technician.id,
    })
  ).id;
  otherAssignmentId = (
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId: parcelB.parcelId,
      assigneeMembershipId: otherTechnician.membershipId,
      assigneeUserId: otherTechnician.id,
    })
  ).id;
});

afterAll(() => db.close());

async function countVisits(): Promise<number> {
  const rows = await db.migrator.execute(
    sql`select count(*)::int as n from app.field_visit where assignment_id = ${assignmentId}`,
  );
  return (rows.rows[0] as { n: number }).n;
}

async function countInstances(): Promise<number> {
  const rows = await db.migrator.execute(
    sql`select count(*)::int as n from app.survey_instance where assignment_id = ${assignmentId}`,
  );
  return (rows.rows[0] as { n: number }).n;
}

async function countAnswers(): Promise<number> {
  const rows = await db.migrator.execute(sql`
    select count(*)::int as n from app.survey_answer a
      join app.survey_instance si on si.id = a.instance_id
     where si.assignment_id = ${assignmentId}
  `);
  return (rows.rows[0] as { n: number }).n;
}

describe("the Field Pack a technician downloads", () => {
  it("carries their own assignments and nobody else's", async () => {
    const ctx = await contextFor(technician);
    const response = await buildFieldPack(db.runtime, ctx, {
      sessionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      technician: { email: technician.email, name: null },
    });
    expect(response.kind).toBe("pack");
    if (response.kind !== "pack") return;

    expect(response.pack.assignments.map((a) => a.id)).toEqual([assignmentId]);
    expect(response.pack.assignments.map((a) => a.id)).not.toContain(otherAssignmentId);
    expect(response.pack.technician.userId).toBe(technician.id);
    expect(response.pack.campaign.surveyVersion.status).toBe("PUBLISHED");
  });

  it("carries the questionnaire and the parcel context, and no owner or geometry", async () => {
    const ctx = await contextFor(technician);
    const response = await buildFieldPack(db.runtime, ctx, {
      sessionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      technician: { email: technician.email, name: null },
    });
    if (response.kind !== "pack") throw new Error("expected a pack");

    expect(response.pack.campaign.surveyVersion.questions.length).toBeGreaterThan(0);
    const parcel = response.pack.assignments[0]!.parcel;
    expect(Object.keys(parcel).sort()).toEqual([
      "chainageLabel",
      "parcelCode",
      "parcelId",
      "sectorLabel",
      "side",
    ]);
    // No geometry anywhere: a technician is told which parcel to visit, not its shape.
    const serialised = JSON.stringify(response.pack).toLowerCase();
    for (const forbidden of ["geometry", "coordinates", "latitude", "longitude"]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    // And nothing about a person. Asserted over the parcel context rather than over the whole
    // document, because the questionnaire's own option codes legitimately include words like
    // `owner_occupier` — an answer a household gives, not an owner's identity.
    expect(JSON.stringify(parcel).toLowerCase()).not.toMatch(/owner|propietario|name|nombre/);
  });

  it("carries both languages of the one questionnaire", async () => {
    const ctx = await contextFor(technician);
    const response = await buildFieldPack(db.runtime, ctx, {
      sessionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      technician: { email: technician.email, name: null },
    });
    if (response.kind !== "pack") throw new Error("expected a pack");

    const questions = response.pack.campaign.surveyVersion.questions;
    const tenure = questions.find((q) => q.code === "tenure_category");
    expect(tenure?.prompt).toBe("¿Relación con el predio?");
    expect(tenure?.translations.en?.prompt).toBe("Relationship to the parcel?");
    expect(tenure?.translations.en?.options.owner_occupier).toBe("Owner-occupier");

    // The codes are the same in both languages, because they are what an answer points at. A pack
    // that shipped an English question under an English code would produce answers no Spanish
    // reader of the study could join back to anything.
    expect(questions.map((q) => q.code)).toEqual([
      "tenure_category",
      "has_concern",
      "services_present",
    ]);

    // A question nobody translated keeps its Spanish wording rather than disappearing from the
    // English questionnaire: a missing translation is a gap in the wording, never a gap in the form.
    const services = questions.find((q) => q.code === "services_present");
    expect(services?.translations.en).toBeUndefined();
    expect(services?.prompt).toBe("¿Qué servicios hay en el sector?");
  });

  it("stamps a window that cannot outlive the session behind it", async () => {
    const ctx = await contextFor(technician);
    const sessionExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const response = await buildFieldPack(db.runtime, ctx, {
      sessionExpiresAt,
      technician: { email: technician.email, name: null },
    });
    if (response.kind !== "pack") throw new Error("expected a pack");
    expect(new Date(response.pack.validity.expiresAt).getTime()).toBe(sessionExpiresAt.getTime());
  });
});

describe("the same command, sent twice", () => {
  it("starts one visit, whatever the device does", async () => {
    const ctx = await contextFor(technician);
    const start = command("visit.start", {
      assignmentId,
      location: null,
      locationOutcome: "denied",
    });

    const first = await processSyncCommands(db.runtime, ctx, [start]);
    expect(first.results[0]!.outcome).toBe("applied");
    const visitId = first.results[0]!.visitId;
    expect(visitId).toBeTruthy();

    const second = await processSyncCommands(db.runtime, ctx, [start]);
    expect(second.results[0]!.outcome).toBe("duplicate");
    // The replayed answer is the stored one, so the device learns the same visit id.
    expect(second.results[0]!.visitId).toBe(visitId);
    expect(await countVisits()).toBe(1);
  });

  it("creates one response and one set of answers", async () => {
    const ctx = await contextFor(technician);
    const submit = command("survey.submit", {
      assignmentId,
      visitId: null,
      surveyVersionId: survey.versionId,
      answers: COMPLETE_ANSWERS,
    });

    const first = await processSyncCommands(db.runtime, ctx, [submit]);
    expect(first.results[0]!.outcome).toBe("applied");
    expect(first.results[0]!.instanceStatus).toBe("SUBMITTED");
    const answersAfterFirst = await countAnswers();

    const again = await processSyncCommands(db.runtime, ctx, [submit]);
    expect(again.results[0]!.outcome).toBe("duplicate");
    expect(again.results[0]!.instanceId).toBe(first.results[0]!.instanceId);

    expect(await countInstances()).toBe(1);
    expect(await countAnswers()).toBe(answersAfterFirst);
  });

  it("a whole batch replayed changes nothing at all", async () => {
    const ctx = await contextFor(technician);
    const before = {
      visits: await countVisits(),
      instances: await countInstances(),
      answers: await countAnswers(),
    };
    const batch = [
      command("visit.start", { assignmentId, location: null, locationOutcome: "denied" }),
      command("survey.submit", {
        assignmentId,
        visitId: null,
        surveyVersionId: survey.versionId,
        answers: COMPLETE_ANSWERS,
      }),
    ];
    await processSyncCommands(db.runtime, ctx, batch);
    await processSyncCommands(db.runtime, ctx, batch);
    await processSyncCommands(db.runtime, ctx, batch);

    expect(await countVisits()).toBe(before.visits);
    expect(await countInstances()).toBe(before.instances);
    expect(await countAnswers()).toBe(before.answers);
  });
});

describe("ordering and obsolete intents", () => {
  it("a draft arriving behind its own submit is superseded, not an error for ever", async () => {
    const ctx = await contextFor(technician);
    // The response for this assignment is already SUBMITTED by the tests above.
    const late = command("survey.upsert_draft", {
      assignmentId,
      visitId: null,
      surveyVersionId: survey.versionId,
      answers: { has_concern: { kind: "boolean", value: false } },
    });
    const result = await processSyncCommands(db.runtime, ctx, [late]);
    expect(result.results[0]!.outcome).toBe("superseded");

    // And the submitted answers were not overwritten.
    const rows = await db.migrator.execute(sql`
      select a.boolean_value from app.survey_answer a
        join app.survey_instance si on si.id = a.instance_id
        join app.survey_question q on q.id = a.question_id
       where si.assignment_id = ${assignmentId} and q.code = 'has_concern'
    `);
    expect((rows.rows[0] as { boolean_value: boolean }).boolean_value).toBe(true);
  });

  it("an older revision arriving after a newer one is refused rather than applied backwards", async () => {
    // A second assignment, so this starts from a clean draft state.
    const ctx = await contextFor(otherTechnician);
    const newer = command(
      "survey.upsert_draft",
      {
        assignmentId: otherAssignmentId,
        visitId: null,
        surveyVersionId: survey.versionId,
        answers: { has_concern: { kind: "boolean", value: true } },
      },
      { deviceRevision: 5 },
    );
    const older = command(
      "survey.upsert_draft",
      {
        assignmentId: otherAssignmentId,
        visitId: null,
        surveyVersionId: survey.versionId,
        answers: { has_concern: { kind: "boolean", value: false } },
      },
      { deviceRevision: 2 },
    );

    expect((await processSyncCommands(db.runtime, ctx, [newer])).results[0]!.outcome).toBe(
      "applied",
    );
    expect((await processSyncCommands(db.runtime, ctx, [older])).results[0]!.outcome).toBe(
      "superseded",
    );

    const rows = await db.migrator.execute(sql`
      select a.boolean_value from app.survey_answer a
        join app.survey_instance si on si.id = a.instance_id
        join app.survey_question q on q.id = a.question_id
       where si.assignment_id = ${otherAssignmentId} and q.code = 'has_concern'
    `);
    expect((rows.rows[0] as { boolean_value: boolean }).boolean_value).toBe(true);
  });
});

describe("conflicts preserve the technician's work", () => {
  it("another technician's assignment is refused, and does not confirm it exists", async () => {
    const ctx = await contextFor(technician);
    const stolen = command("survey.upsert_draft", {
      assignmentId: otherAssignmentId,
      visitId: null,
      surveyVersionId: survey.versionId,
      answers: COMPLETE_ANSWERS,
    });
    const result = await processSyncCommands(db.runtime, ctx, [stolen]);
    expect(result.results[0]!.outcome).toBe("conflict");
    expect(result.results[0]!.conflictReason).toBe("assignment_reassigned");
    expect(result.results[0]!.message).toContain("conservó");
  });

  it("a questionnaire that moved on the server is a conflict, never a reinterpretation", async () => {
    const ctx = await contextFor(technician);
    const stale = command("survey.upsert_draft", {
      assignmentId,
      visitId: null,
      surveyVersionId: randomUUID(),
      answers: COMPLETE_ANSWERS,
    });
    const result = await processSyncCommands(db.runtime, ctx, [stale]);
    expect(result.results[0]!.outcome).toBe("conflict");
    expect(result.results[0]!.conflictReason).toBe("survey_version_changed");
  });

  it("a conflict is recorded once and replayed, so the device is told the same thing", async () => {
    const ctx = await contextFor(technician);
    const stolen = command("visit.start", {
      assignmentId: otherAssignmentId,
      location: null,
      locationOutcome: "denied",
    });
    const first = await processSyncCommands(db.runtime, ctx, [stolen]);
    const second = await processSyncCommands(db.runtime, ctx, [stolen]);
    expect(first.results[0]!.outcome).toBe("conflict");
    expect(second.results[0]!.outcome).toBe("duplicate");
    expect(second.results[0]!.conflictReason).toBe(first.results[0]!.conflictReason);
  });
});

describe("a pull tells a technician what moved", () => {
  it("names the assignments that are no longer theirs without deleting anything", async () => {
    const ctx = await contextFor(technician);
    const response = await pullFieldChanges(db.runtime, ctx, {
      knownAssignmentIds: [assignmentId, otherAssignmentId],
      sessionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    expect(response).not.toBeNull();
    expect(response!.assignments.map((a) => a.id)).toEqual([assignmentId]);
    // The one the device holds but the server no longer sends: the device marks it, never deletes.
    expect(response!.revokedAssignmentIds).toEqual([otherAssignmentId]);
    expect(response!.surveyVersionId).toBe(survey.versionId);
  });

  it("renews the offline window on the session's own terms", async () => {
    const ctx = await contextFor(technician);
    const sessionExpiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const response = await pullFieldChanges(db.runtime, ctx, {
      knownAssignmentIds: [],
      sessionExpiresAt,
    });
    expect(new Date(response!.validity.expiresAt).getTime()).toBe(sessionExpiresAt.getTime());
  });
});

describe("isolation", () => {
  it("a technician of another tenant cannot even build a context for this project", async () => {
    const outsider = await createUser(db.migrator, "field-outsider");
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantB.id,
      userId: outsider.id,
      role: "MEMBER",
    });
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      tenantMembershipId: tenantMembership.id,
      role: "FIELD_TECHNICIAN",
    });
    const refused = await (async () => {
      try {
        await contextFor(outsider);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(refused).toBeInstanceOf(PermissionDenied);
  });

  it("receipts are the caller's own, and cannot be read across a technician", async () => {
    const ctx = await contextFor(otherTechnician);
    const visible = await db.runtime.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${w.tenantA.id}, true)`);
      await tx.execute(sql`select set_config('app.project_id', ${w.projectX.id}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      const rows = await tx
        .select({ id: fieldSchema.fieldSyncReceipt.id })
        .from(fieldSchema.fieldSyncReceipt)
        .where(
          and(
            eq(fieldSchema.fieldSyncReceipt.tenantId, w.tenantA.id),
            eq(fieldSchema.fieldSyncReceipt.userId, technician.id),
          ),
        );
      return rows.length;
    });
    expect(visible).toBe(0);
  });

  it("a receipt cannot be rewritten to change what a retry will be told", async () => {
    const rows = await db.migrator.execute(sql`select id from app.field_sync_receipt limit 1`);
    const id = (rows.rows[0] as { id: string }).id;
    const refused = await (async () => {
      try {
        await db.migrator.execute(
          sql`update app.field_sync_receipt set outcome = 'applied' where id = ${id}`,
        );
        return null;
      } catch (error) {
        return error;
      }
    })();
    const cause = (refused as { cause?: { message?: string } } | null)?.cause;
    expect(`${String(refused)} ${cause?.message ?? ""}`).toMatch(/field_sync_receipt_immutable/);
  });
});

describe("what a technician may not do", () => {
  it("cannot read the project's other work: the pack is the whole of their view", async () => {
    const ctx = await contextFor(technician);
    expect(ctx.permissions.has("field.responses.read")).toBe(false);
    expect(ctx.permissions.has("field.read")).toBe(false);
    expect(ctx.permissions.has("social.read")).toBe(false);
    expect(ctx.permissions.has("quality.read")).toBe(false);
    expect(ctx.permissions.has("portal.preview")).toBe(false);
  });

  it("the provenance of everything captured says what it is", async () => {
    const rows = await db.migrator.execute(sql`
      select distinct p.regime
        from app.survey_instance si
        join app.provenance_record p on p.id = si.provenance_id
       where si.assignment_id = ${assignmentId}
    `);
    expect(rows.rows.map((row) => (row as { regime: string }).regime)).toEqual(["DEMO_SIMULATION"]);
  });
});

void appSchema;
