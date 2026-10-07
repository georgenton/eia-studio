import {
  FIELD_PACK_SCHEMA_VERSION_V4,
  FIELD_SYNC_PROTOCOL_VERSION_V4,
  LOCAL_DELIVERY_STATES,
  type FieldPack,
} from "@eia/field-sync-contract";
import { describe, expect, it } from "vitest";

import {
  canSaveDelivery,
  deliveryStateAfter,
  initialDeliveryState,
  isUnsettled,
  mayDeleteEvidenceFile,
  requiresEvidence,
} from "../src/core/delivery";
import { workPackFromFieldPack } from "../src/core/pack-upgrade";
import {
  decideProjectSwitch,
  EMPTY_PENDING,
  hasPendingWork,
  PENDING_KINDS,
  PROJECT_SWITCH_STEPS,
} from "../src/core/project-switch";
import { LOCAL_MIGRATIONS, LOCAL_SCHEMA_VERSION, pendingMigrations } from "../src/db/migrations";

/**
 * The device's own rules about a delivery, its photograph, and changing road.
 *
 * These are the parts of the mobile change that can be *decided* without a device, so they are
 * where the reasoning lives: a screen that asks a different question, or a sync engine that
 * releases a file at the wrong moment, fails here rather than on somebody's phone.
 */

describe("saving a delivery on the device", () => {
  it("a delivered invitation needs a photograph, and the other three do not", () => {
    expect(requiresEvidence("DELIVERED")).toBe(true);
    for (const outcome of ["ABSENT", "REFUSED", "OTHER"] as const) {
      expect(requiresEvidence(outcome)).toBe(false);
      expect(
        canSaveDelivery({ outcome, evidenceFileUri: null, evidenceStoredObjectId: null }),
      ).toBe(true);
    }
  });

  it("and the device refuses it before the valley ends, not after", () => {
    // The point of checking here as well as on the server: a technician standing at a gate must
    // be told now, while they can still take the picture.
    expect(
      canSaveDelivery({
        outcome: "DELIVERED",
        evidenceFileUri: null,
        evidenceStoredObjectId: null,
      }),
    ).toBe(false);
    expect(
      canSaveDelivery({
        outcome: "DELIVERED",
        evidenceFileUri: "file:///documents/entrega.jpg",
        evidenceStoredObjectId: null,
      }),
    ).toBe(true);
  });

  it("an attempt with a photograph still to upload is not ready to send", () => {
    expect(
      initialDeliveryState({
        outcome: "DELIVERED",
        evidenceFileUri: "file:///documents/entrega.jpg",
        evidenceStoredObjectId: null,
      }),
    ).toBe("EVIDENCE_PENDING");
    expect(
      initialDeliveryState({
        outcome: "DELIVERED",
        evidenceFileUri: "file:///documents/entrega.jpg",
        evidenceStoredObjectId: "0199f3a2-7c41-7abc-8d0f-aaaaaaaaaaaa",
      }),
    ).toBe("READY_TO_SYNC");
    expect(
      initialDeliveryState({
        outcome: "ABSENT",
        evidenceFileUri: null,
        evidenceStoredObjectId: null,
      }),
    ).toBe("READY_TO_SYNC");
  });
});

describe("what the server's answer does to the row", () => {
  it("only an acknowledgement settles it", () => {
    expect(deliveryStateAfter("applied")).toBe("SYNCED");
    expect(deliveryStateAfter("duplicate")).toBe("SYNCED");
  });

  it("and a refusal keeps the work, in front of a person", () => {
    // The rule the whole file exists for: nothing deletes a technician's capture. A conflict is
    // terminal for the *queue* and not for the *record*.
    for (const outcome of ["conflict", "rejected", "superseded"] as const) {
      expect(deliveryStateAfter(outcome)).toBe("REQUIRES_REVIEW");
      expect(isUnsettled(deliveryStateAfter(outcome))).toBe(true);
    }
  });

  it("every state the contract names is one this device can be in", () => {
    // The vocabulary is shared so the phone's screens and the server's outcomes cannot drift.
    expect([...LOCAL_DELIVERY_STATES]).toContain("REQUIRES_REVIEW");
    expect([...LOCAL_DELIVERY_STATES]).toContain("EVIDENCE_PENDING");
  });
});

describe("deleting the photograph", () => {
  it("needs the command acknowledged, not the upload finished", () => {
    // `EVIDENCE_PENDING` → uploaded → `READY_TO_SYNC` → sent → `SYNCED`. Only the last one
    // releases the file: bytes in a bucket are not the same fact as the row existing.
    expect(mayDeleteEvidenceFile({ state: "READY_TO_SYNC", serverAttemptId: null })).toBe(false);
    expect(mayDeleteEvidenceFile({ state: "SYNCING", serverAttemptId: null })).toBe(false);
    expect(mayDeleteEvidenceFile({ state: "SYNCED", serverAttemptId: null })).toBe(false);
    expect(
      mayDeleteEvidenceFile({ state: "SYNCED", serverAttemptId: "0199f3a2-7c41-7abc-8d0f-b" }),
    ).toBe(true);
  });

  it("and a conflict never releases it", () => {
    expect(mayDeleteEvidenceFile({ state: "REQUIRES_REVIEW", serverAttemptId: null })).toBe(false);
  });
});

describe("changing road", () => {
  it("is allowed only with a signal and nothing pending", () => {
    expect(decideProjectSwitch({ online: true, pending: EMPTY_PENDING })).toEqual({
      kind: "allowed",
    });
    expect(decideProjectSwitch({ online: false, pending: EMPTY_PENDING })).toEqual({
      kind: "offline",
    });
  });

  it("names what is pending, rather than refusing without saying why", () => {
    const decision = decideProjectSwitch({
      online: true,
      pending: { ...EMPTY_PENDING, unsyncedSurveys: 2, pendingEvidence: 1 },
    });
    expect(decision.kind).toBe("blocked");
    if (decision.kind !== "blocked") return;
    expect(decision.blocking).toEqual(["unsyncedSurveys", "pendingEvidence"]);
  });

  it("and every kind of unsynced work blocks it, one at a time", () => {
    for (const kind of PENDING_KINDS) {
      const decision = decideProjectSwitch({
        online: true,
        pending: { ...EMPTY_PENDING, [kind]: 1 },
      });
      expect(decision, kind).toMatchObject({ kind: "blocked", blocking: [kind] });
    }
    expect(hasPendingWork(EMPTY_PENDING)).toBe(false);
  });

  it("reports pending work before a missing signal, because that is the useful instruction", () => {
    const decision = decideProjectSwitch({
      online: false,
      pending: { ...EMPTY_PENDING, outboxPending: 1 },
    });
    expect(decision.kind).toBe("blocked");
  });

  it("downloads and validates the new pack before replacing the old one", () => {
    // The ordering *is* the safety property: a download that fails leaves a device that still
    // knows which road it is on.
    expect([...PROJECT_SWITCH_STEPS]).toEqual([
      "verify-nothing-pending",
      "download-new-pack",
      "validate-new-pack",
      "replace-active-project",
      "clear-previous-project-snapshots",
    ]);
    expect(PROJECT_SWITCH_STEPS.indexOf("validate-new-pack")).toBeLessThan(
      PROJECT_SWITCH_STEPS.indexOf("replace-active-project"),
    );
  });
});

describe("a device that was in the field when the application was updated", () => {
  const v3Pack = {
    schemaVersion: 1,
    protocolVersion: 3,
    technician: {
      userId: "0199f3a2-7c41-7abc-8d0f-000000000001",
      email: "t@x.invalid",
      name: null,
    },
    project: {
      tenantId: "0199f3a2-7c41-7abc-8d0f-000000000002",
      tenantSlug: "t",
      tenantName: "T",
      projectId: "0199f3a2-7c41-7abc-8d0f-000000000003",
      projectSlug: "p",
      projectName: "P",
      locality: null,
    },
    campaign: {
      id: "0199f3a2-7c41-7abc-8d0f-000000000004",
      name: "C",
      status: "ACTIVE",
      captureChannel: "EIA_FIELD_MOBILE",
      offlineMode: "required",
      surveyVersion: {
        id: "0199f3a2-7c41-7abc-8d0f-000000000005",
        versionLabel: "v1",
        templateName: "T",
        status: "PUBLISHED",
        questions: [],
      },
    },
    assignments: [],
    validity: {
      issuedAt: "2026-11-01T00:00:00.000Z",
      expiresAt: "2026-11-08T00:00:00.000Z",
      basis: "sesión",
    },
    cursor: "c",
  } as unknown as FieldPack;

  it("keeps working: the v3 pack becomes a v4 one with no invitations", () => {
    const converted = workPackFromFieldPack(v3Pack);
    expect(converted.schemaVersion).toBe(FIELD_PACK_SCHEMA_VERSION_V4);
    expect(converted.protocolVersion).toBe(FIELD_SYNC_PROTOCOL_VERSION_V4);
    expect(converted.surveyWork?.campaign.id).toBe(v3Pack.campaign.id);
    // None is the truth until this device next reaches a server. Conversion does not invent.
    expect(converted.socializationWork.invitations).toEqual([]);
    // And it does not extend its own offline access.
    expect(converted.validity).toEqual(v3Pack.validity);
  });
});

describe("the local database upgrades forward", () => {
  it("adds migration 4 and drops nothing a handset is holding", () => {
    expect(LOCAL_SCHEMA_VERSION).toBe(4);
    const upgrade = pendingMigrations(3);
    expect(upgrade.map((m) => m.version)).toEqual([4]);
    const sql = upgrade
      .flatMap((m) => m.statements)
      .join("\n")
      .toLowerCase();
    // A device in the field is holding drafts, an outbox and photographs. Nothing here may
    // remove any of it — the one rule this migration had to satisfy.
    for (const destructive of ["drop table", "drop column", "delete from", "truncate"]) {
      expect(sql, destructive).not.toContain(destructive);
    }
    expect(sql).toContain("create table if not exists work_pack");
    expect(sql).toContain("create table if not exists local_invitation");
    expect(sql).toContain("create table if not exists local_delivery_attempt");
  });

  it("and every migration is still forward-only, from 1", () => {
    const versions = LOCAL_MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(versions[0]).toBe(1);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
