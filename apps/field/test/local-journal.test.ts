import type { WorkPack } from "@eia/field-sync-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyInvitations,
  deliveriesAwaitingEvidence,
  deliveriesReadyToQueue,
  ensureWorkPack,
  listDeliveryAttempts,
  listInvitations,
  readWorkPack,
  readWorkPackOrigin,
  recordEvidenceFailure,
  releaseEvidenceFile,
  replaceActiveProject,
  saveDeliveryAttempt,
  saveWorkPack,
  settleDelivery,
  summarisePendingWork,
} from "../src/db/repo-v4";
import { listAssignments, readPack } from "../src/db/repo";
import { queueReadyDeliveries } from "../src/sync/delivery-queue";
import {
  asFreshHandle,
  openTestDatabase,
  openTestDatabaseAtVersion,
  upgrade,
} from "./support/local-db";

/**
 * The device's journal, against a real SQLite.
 *
 * These are the properties that only a database can demonstrate: that a retry is one row by
 * constraint, that a failed switch rolls back, that an upgrade keeps a handset's work, that a
 * socialization-only project shows no campaign. A mock would pass whatever it was written to.
 *
 * Everything is synthetic — a project this file invents, parcels with made-up codes, and no
 * person anywhere.
 */
const PROJECT = {
  tenantId: "0199f3a2-7c41-7abc-8d0f-00000000a001",
  tenantSlug: "consultora",
  tenantName: "Consultora",
  projectId: "0199f3a2-7c41-7abc-8d0f-00000000a002",
  projectSlug: "via-a",
  projectName: "Vía A",
  locality: null,
} as const;

const TECHNICIAN = {
  userId: "0199f3a2-7c41-7abc-8d0f-00000000a003",
  email: "tecnica@example.invalid",
  name: null,
} as const;

const VALIDITY = {
  issuedAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-08T00:00:00.000Z",
  basis: "sesión",
} as const;

function invitation(over: Partial<Record<string, unknown>> = {}) {
  return {
    invitationId: "0199f3a2-7c41-7abc-8d0f-00000000b001",
    revision: 1,
    status: "PENDING" as const,
    parcelId: "0199f3a2-7c41-7abc-8d0f-00000000b002",
    parcelCode: "001",
    sectorLabel: null,
    chainageLabel: null,
    recipientLabel: null,
    eventId: "0199f3a2-7c41-7abc-8d0f-00000000b003",
    eventTitle: "Convocatoria sintética",
    startsAt: "2026-11-12T19:00:00.000Z",
    timezone: "America/Guayaquil",
    locationLabel: "Casa comunal",
    purpose: null,
    ...over,
  };
}

function surveyWork() {
  return {
    campaign: {
      id: "0199f3a2-7c41-7abc-8d0f-00000000c001",
      name: "Campaña sintética",
      status: "ACTIVE" as const,
      captureChannel: "EIA_FIELD_MOBILE",
      offlineMode: "required" as const,
      surveyVersion: {
        id: "0199f3a2-7c41-7abc-8d0f-00000000c002",
        versionLabel: "v1",
        templateName: "Ficha",
        status: "PUBLISHED" as const,
        questions: [
          {
            code: "household_size",
            ordinal: 0,
            type: "INTEGER",
            prompt: "¿Cuántas personas viven aquí?",
            helpText: null,
            required: true,
            sensitivity: "ordinary",
            section: null,
            options: [],
            translations: {},
          },
          {
            code: "tenure",
            ordinal: 1,
            type: "SINGLE_CHOICE",
            prompt: "Tenencia",
            helpText: null,
            required: false,
            sensitivity: "ordinary",
            section: null,
            options: [{ code: "owner", label: "Propietario", ordinal: 0 }],
            translations: {},
          },
        ],
      },
    },
    assignments: [
      {
        id: "0199f3a2-7c41-7abc-8d0f-00000000d001",
        status: "PENDING" as const,
        parcel: {
          parcelId: "0199f3a2-7c41-7abc-8d0f-00000000d002",
          parcelCode: "001",
          sectorLabel: null,
          chainageLabel: "2+840",
          side: "left" as const,
        },
        correction: null,
        openVisitId: null,
        instanceId: null,
        instanceStatus: null,
        revision: 1,
      },
    ],
  };
}

function pack(over: Partial<WorkPack> = {}): WorkPack {
  return {
    schemaVersion: 2,
    protocolVersion: 4,
    technician: TECHNICIAN,
    project: PROJECT,
    surveyWork: null,
    socializationWork: { invitations: [] },
    validity: VALIDITY,
    cursor: "v4:2026-11-01T00:00:00.000Z",
    ...over,
  } as WorkPack;
}

let database: ReturnType<typeof openTestDatabase>;
beforeEach(() => {
  database = openTestDatabase();
});
afterEach(() => database.close());

/* =============================================================================================
 * F · G — the survey half, hydrated or absent
 * ========================================================================================== */

describe("a v4 pack with survey work", () => {
  it("F · fills the tables the questionnaire screens read", async () => {
    const { db } = database;
    await saveWorkPack(db, pack({ surveyWork: surveyWork() }));

    // The gap this closes: `work_pack` was written and these four were not, so a clean
    // installation held a valid pack and showed no surveys at all.
    const stored = await readPack(db);
    expect(stored?.campaign.id).toBe(surveyWork().campaign.id);
    expect(await listAssignments(db)).toHaveLength(1);

    const questions = await db.getAllAsync<{ code: string }>("select code from local_question");
    expect(questions.map((q) => q.code).sort()).toEqual(["household_size", "tenure"]);
    const options = await db.getAllAsync<{ code: string }>("select code from local_option");
    expect(options.map((o) => o.code)).toEqual(["owner"]);
  });
});

describe("a socialization-only pack", () => {
  it("G · is operable, and leaves no campaign from an earlier road looking current", async () => {
    const { db } = database;
    // First a project with surveys, so there is something stale to leave behind.
    await saveWorkPack(db, pack({ surveyWork: surveyWork() }));
    expect(await readPack(db)).not.toBeNull();

    await saveWorkPack(
      db,
      pack({ surveyWork: null, socializationWork: { invitations: [invitation()] } }),
    );

    // No campaign at all — not an empty one, and certainly not the previous road's.
    expect(await readPack(db)).toBeNull();
    const invitations = await listInvitations(db);
    expect(invitations).toHaveLength(1);
    expect(invitations[0]?.parcelCode).toBe("001");
  });
});

/* =============================================================================================
 * J — a handset that was in the field when the application was updated
 * ========================================================================================== */

describe("updating an application that was holding work", () => {
  it("J · keeps the draft, the outbox and the photograph, and converts the pack", async () => {
    const old = openTestDatabaseAtVersion(3);
    try {
      const { db, raw } = old;
      // A v3 device mid-day: a pack, an assignment, a draft, a queued command, a photograph.
      raw.exec(`insert into field_pack (id, tenant_slug, project_slug, project_name, locality,
        campaign_id, campaign_name, survey_version_id, survey_version_label, technician_user_id,
        technician_email, issued_at, expires_at, validity_basis, cursor, payload)
        values (1, 'consultora', 'via-a', 'Vía A', null, 'c1', 'Campaña', 'v1', 'V1',
                'u1', 'e@x.invalid', '2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z',
                'sesión', 'c', '${JSON.stringify({
                  schemaVersion: 1,
                  protocolVersion: 3,
                  technician: TECHNICIAN,
                  project: PROJECT,
                  campaign: surveyWork().campaign,
                  assignments: surveyWork().assignments,
                  validity: VALIDITY,
                  cursor: "c",
                }).replace(/'/g, "''")}')`);
      raw.exec(`insert into local_assignment (id, parcel_code, server_status, revision, updated_at)
                values ('a1', '001', 'PENDING', 1, '2026-11-01T00:00:00.000Z')`);
      raw.exec(`insert into local_survey (id, assignment_id, survey_version_id, state,
                device_revision, updated_at)
                values ('s1', 'a1', 'v1', 'DRAFT', 1, '2026-11-01T00:00:00.000Z')`);
      raw.exec(`insert into local_answer (survey_id, question_code, answer_json, updated_at)
                values ('s1', 'household_size', '{"kind":"number","value":3}', '2026-11-01T00:00:00.000Z')`);
      raw.exec(`insert into sync_outbox (command_id, command_type, entity_kind, entity_local_id,
                command_json, created_at)
                values ('cmd-1', 'survey.upsert_draft', 'survey', 's1', '{}', '2026-11-01T00:00:00.000Z')`);
      raw.exec(`insert into local_media (local_id, assignment_local_id, file_uri, mime_type,
                size_bytes, kind, captured_at)
                values ('m1', 'a1', 'file:///m1.jpg', 'image/jpeg', 10, 'parcel', '2026-11-01T00:00:00.000Z')`);

      // The update.
      upgrade(old, 3);

      // Nothing of the technician's day is gone.
      expect(await db.getFirstAsync("select id from local_survey where id = 's1'")).not.toBeNull();
      expect(
        await db.getFirstAsync("select question_code from local_answer where survey_id = 's1'"),
      ).not.toBeNull();
      expect(
        await db.getFirstAsync("select command_id from sync_outbox where command_id = 'cmd-1'"),
      ).not.toBeNull();
      expect(
        await db.getFirstAsync("select local_id from local_media where local_id = 'm1'"),
      ).not.toBeNull();

      // And the v3 pack becomes the active v4 project, without inventing invitations.
      const converted = await ensureWorkPack(db);
      expect(converted?.project.projectSlug).toBe("via-a");
      expect(converted?.socializationWork.invitations).toEqual([]);
      expect(converted?.validity).toEqual(VALIDITY);
      expect(await readWorkPackOrigin(db)).toBe("converted");
    } finally {
      old.close();
    }
  });
});

/* =============================================================================================
 * A · B — the evidence retry, and the refusal that must not loop
 * ========================================================================================== */

describe("an evidence upload that failed", () => {
  async function anAttemptWithAPhotograph() {
    const { db } = database;
    await saveWorkPack(db, pack({ socializationWork: { invitations: [invitation()] } }));
    await saveDeliveryAttempt(db, {
      localId: "attempt-1",
      invitationId: invitation().invitationId,
      invitationRevision: 1,
      outcome: "DELIVERED",
      occurredAt: "2026-11-12T19:30:00.000Z",
      note: null,
      location: null,
      evidence: { fileUri: "file:///e1.jpg", mimeType: "image/jpeg", sizeBytes: 10 },
      state: "EVIDENCE_PENDING",
    });
  }

  it("A · comes back on the next sync when the network was the problem", async () => {
    const { db } = database;
    await anAttemptWithAPhotograph();

    // Sync 1: the server was not there.
    await recordEvidenceFailure(db, "attempt-1", { kind: "retryable", message: "sin conexión" });

    // Sync 2, with nothing edited by hand: the same attempt is selected again.
    const waiting = await deliveriesAwaitingEvidence(db);
    expect(waiting.map((a) => a.localId)).toEqual(["attempt-1"]);
    expect(waiting[0]?.evidenceFileUri).toBe("file:///e1.jpg");
    expect(waiting[0]?.evidenceStoredObjectId).toBeNull();
    expect(waiting[0]?.attempts).toBe(1);
  });

  it("B · stops by itself when the server refused, and keeps the photograph", async () => {
    const { db } = database;
    await anAttemptWithAPhotograph();
    await recordEvidenceFailure(db, "attempt-1", {
      kind: "permanent",
      message: "el proveedor rechazó la carga",
    });

    // Not selected again: a refusal does not change by being asked once more.
    expect(await deliveriesAwaitingEvidence(db)).toEqual([]);

    const [attempt] = await listDeliveryAttempts(db);
    expect(attempt?.state).toBe("SYNC_ERROR");
    // The one thing that must survive every failure.
    expect(attempt?.evidenceFileUri).toBe("file:///e1.jpg");
  });
});

/* =============================================================================================
 * C · D — one command id, and what an answer does to the row
 * ========================================================================================== */

describe("queueing and settling a delivery", () => {
  beforeEach(async () => {
    await saveWorkPack(database.db, pack({ socializationWork: { invitations: [invitation()] } }));
    await saveDeliveryAttempt(database.db, {
      localId: "attempt-2",
      invitationId: invitation().invitationId,
      invitationRevision: 1,
      outcome: "ABSENT",
      occurredAt: "2026-11-12T19:30:00.000Z",
      note: null,
      location: null,
      evidence: null,
      state: "READY_TO_SYNC",
    });
  });

  it("C · an attempt is queued once; a second pass finds nothing to queue", async () => {
    const { db } = database;
    let minted = 0;
    const ids: string[] = [];
    const newId = () => `cmd-${(minted += 1)}`;
    const first = await queueReadyDeliveries(
      db,
      async (command) => {
        ids.push(command.commandId);
      },
      newId,
      "0.2.0",
    );
    expect(first).toBe(1);

    const second = await queueReadyDeliveries(
      db,
      async (command) => {
        ids.push(command.commandId);
      },
      newId,
      "0.2.0",
    );
    // Already carries a `command_id`, so it is not selected again — one logical command.
    expect(second).toBe(0);
    expect(ids).toEqual(["cmd-1"]);
  });

  it("D · an acknowledgement settles it and releases the photograph; a conflict does neither", async () => {
    const { db } = database;
    await saveDeliveryAttempt(db, {
      localId: "attempt-3",
      invitationId: invitation().invitationId,
      invitationRevision: 1,
      outcome: "DELIVERED",
      occurredAt: "2026-11-12T20:00:00.000Z",
      note: null,
      location: null,
      evidence: { fileUri: "file:///e3.jpg", mimeType: "image/jpeg", sizeBytes: 10 },
      state: "READY_TO_SYNC",
    });

    await settleDelivery(db, "attempt-3", {
      outcome: "applied",
      attemptId: "0199f3a2-7c41-7abc-8d0f-00000000e001",
      conflictReason: null,
      message: null,
    });
    const settled = (await listDeliveryAttempts(db)).find((a) => a.localId === "attempt-3");
    expect(settled?.state).toBe("SYNCED");
    expect(await releaseEvidenceFile(db, settled!)).toBe(true);

    // And a conflict: the row stays, the photograph stays, and nothing is retried.
    await saveDeliveryAttempt(db, {
      localId: "attempt-4",
      invitationId: invitation().invitationId,
      invitationRevision: 1,
      outcome: "DELIVERED",
      occurredAt: "2026-11-12T20:10:00.000Z",
      note: null,
      location: null,
      evidence: { fileUri: "file:///e4.jpg", mimeType: "image/jpeg", sizeBytes: 10 },
      state: "READY_TO_SYNC",
    });
    await settleDelivery(db, "attempt-4", {
      outcome: "conflict",
      attemptId: null,
      conflictReason: "invitation_reassigned",
      message: "ya no está a tu nombre",
    });
    const conflicted = (await listDeliveryAttempts(db)).find((a) => a.localId === "attempt-4");
    expect(conflicted?.state).toBe("REQUIRES_REVIEW");
    expect(conflicted?.evidenceFileUri).toBe("file:///e4.jpg");
    expect(await releaseEvidenceFile(db, conflicted!)).toBe(false);
    // Not re-queued: it is no longer `READY_TO_SYNC`, so the outbox will not send it again.
    const queueable = (await deliveriesReadyToQueue(db)).map((a) => a.localId);
    expect(queueable).not.toContain("attempt-4");
    expect(queueable).not.toContain("attempt-3");
  });

  it("E · saving the same attempt twice is one row", async () => {
    const { db } = database;
    for (let i = 0; i < 2; i += 1) {
      await saveDeliveryAttempt(db, {
        localId: "attempt-2",
        invitationId: invitation().invitationId,
        invitationRevision: 1,
        outcome: "ABSENT",
        occurredAt: "2026-11-12T19:30:00.000Z",
        note: null,
        location: null,
        evidence: null,
        state: "READY_TO_SYNC",
      });
    }
    expect(await listDeliveryAttempts(db)).toHaveLength(1);
  });
});

/* =============================================================================================
 * H · I — changing road
 * ========================================================================================== */

describe("changing road", () => {
  it("H · a failure during the write leaves the previous project complete", async () => {
    const { db, raw } = database;
    await saveWorkPack(
      db,
      pack({
        surveyWork: surveyWork(),
        socializationWork: { invitations: [invitation()] },
      }),
    );

    /*
     * A pack B the write will choke on: two assignments sharing an id, which the survey
     * snapshot inserts plainly and the primary key refuses. The particular failure is
     * arbitrary — what matters is that *any* failure inside the transaction leaves road A
     * whole, which the previous implementation could not do because it committed the deletion
     * before writing anything.
     */
    const duplicated = surveyWork();
    const broken = pack({
      project: { ...PROJECT, projectSlug: "via-b", projectName: "Vía B" },
      surveyWork: {
        campaign: duplicated.campaign,
        assignments: [duplicated.assignments[0]!, duplicated.assignments[0]!],
      },
      socializationWork: { invitations: [invitation()] },
    });

    await expect(replaceActiveProject(db, broken)).rejects.toBeTruthy();

    // Road A, untouched: its pack, its invitation and its survey snapshot.
    const still = await readWorkPack(db);
    expect(still?.project.projectSlug).toBe("via-a");
    expect(await listInvitations(db)).toHaveLength(1);
    expect(await readPack(db)).not.toBeNull();
    expect(await listAssignments(db)).toHaveLength(1);
    expect(raw.prepare("select count(*) as n from work_pack").get()).toMatchObject({ n: 1 });
  });

  it("· and a good switch replaces everything in one go", async () => {
    const { db } = database;
    await saveWorkPack(db, pack({ surveyWork: surveyWork() }));
    const roadB = pack({
      project: { ...PROJECT, projectSlug: "via-b", projectName: "Vía B" },
      socializationWork: { invitations: [invitation()] },
    });
    await replaceActiveProject(db, roadB);

    expect((await readWorkPack(db))?.project.projectSlug).toBe("via-b");
    expect(await listInvitations(db)).toHaveLength(1);
    // Road A's campaign is gone rather than left looking current.
    expect(await readPack(db)).toBeNull();
    expect(await listAssignments(db)).toEqual([]);
  });

  it("I · every kind of pending work is counted, so a refusal can name it", async () => {
    const { db } = database;
    await saveWorkPack(db, pack({ socializationWork: { invitations: [invitation()] } }));
    await saveDeliveryAttempt(db, {
      localId: "attempt-5",
      invitationId: invitation().invitationId,
      invitationRevision: 1,
      outcome: "DELIVERED",
      occurredAt: "2026-11-12T19:30:00.000Z",
      note: null,
      location: null,
      evidence: { fileUri: "file:///e5.jpg", mimeType: "image/jpeg", sizeBytes: 10 },
      state: "EVIDENCE_PENDING",
    });

    const pending = await summarisePendingWork(db);
    expect(pending.unsettledDeliveries).toBe(1);
    expect(pending.pendingEvidence).toBe(1);
    expect(pending.outboxPending).toBe(0);
  });
});

/* =============================================================================================
 * Reopening after the application was killed
 * ========================================================================================== */

describe("closing and reopening the application", () => {
  it("loses nothing, because nothing of consequence lives in React state", async () => {
    const { db, raw } = database;
    await saveWorkPack(db, pack({ socializationWork: { invitations: [invitation()] } }));
    await saveDeliveryAttempt(db, {
      localId: "attempt-reopen",
      invitationId: invitation().invitationId,
      invitationRevision: 7,
      outcome: "DELIVERED",
      occurredAt: "2026-11-12T19:45:00.000Z",
      note: "la entregué en la puerta",
      location: { latitude: -3.8, longitude: -78.7, accuracyM: 12 },
      evidence: { fileUri: "file:///reopen.jpg", mimeType: "image/jpeg", sizeBytes: 42 },
      state: "EVIDENCE_PENDING",
    });

    /*
     * The application is gone: every component unmounted, every hook's state collected. What
     * survives is the file on disk and the rows in SQLite, which is the whole premise. Reading
     * through a *fresh* adapter over the same database is the closest this can get without an
     * emulator — and it is the half that would actually be wrong if state had leaked into
     * React, because then these reads would come back empty.
     */
    const reopened = await listDeliveryAttempts(asFreshHandle(raw));
    expect(reopened).toHaveLength(1);
    const attempt = reopened[0]!;
    expect(attempt.localId).toBe("attempt-reopen");
    expect(attempt.invitationRevision).toBe(7);
    expect(attempt.outcome).toBe("DELIVERED");
    expect(attempt.evidenceFileUri).toBe("file:///reopen.jpg");
    expect(attempt.state).toBe("EVIDENCE_PENDING");
    expect(attempt.note).toBe("la entregué en la puerta");

    // And the invitation it belongs to is still there to open.
    const invitations = await listInvitations(asFreshHandle(raw));
    expect(invitations.map((row) => row.id)).toEqual([invitation().invitationId]);
  });
});

/* =============================================================================================
 * The revocation path
 * ========================================================================================== */

describe("an invitation that is no longer this technician's", () => {
  it("is marked, never deleted, and keeps the attempt made against it", async () => {
    const { db } = database;
    await saveWorkPack(db, pack({ socializationWork: { invitations: [invitation()] } }));
    await saveDeliveryAttempt(db, {
      localId: "attempt-6",
      invitationId: invitation().invitationId,
      invitationRevision: 1,
      outcome: "DELIVERED",
      occurredAt: "2026-11-12T19:30:00.000Z",
      note: null,
      location: null,
      evidence: { fileUri: "file:///e6.jpg", mimeType: "image/jpeg", sizeBytes: 10 },
      state: "READY_TO_SYNC",
    });

    await applyInvitations(db, [], [invitation().invitationId]);

    const [row] = await listInvitations(db);
    expect(row?.revoked).toBe(true);
    // The technician's walk is still there, with its photograph.
    const attempts = await listDeliveryAttempts(db);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.evidenceFileUri).toBe("file:///e6.jpg");
  });
});
