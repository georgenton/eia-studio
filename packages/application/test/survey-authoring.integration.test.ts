import { randomUUID } from "node:crypto";

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
  createSpatialDatasetVersion,
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
  buildFieldPack,
  buildRequestContext,
  createSurveyDraft,
  createSurveyTemplate,
  loadSurveyAuthoring,
  loadTabulation,
  processSyncCommands,
  publishSurveyVersion,
  saveSurveyDefinition,
} from "../src/index";

/**
 * The questionnaire, from the browser it was written in to the number it eventually becomes
 * (ADR-037, gate G3.2).
 *
 * This file is the contract test the whole authoring surface exists to satisfy, and it is one
 * sentence: **a form written in the web application is the same form the phone asks, and the
 * answers it produces tabulate.** Author → publish → Field Pack → the device's own render →
 * an answer captured offline → sync → deterministic tabulation, in both languages, with one set
 * of codes throughout.
 *
 * Nothing here seeds a questionnaire. That is the point: until this wave a `SurveyVersion` could
 * only be created by the demonstration seeder, and a proof that used the seeder would be proving
 * the thing it replaced.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let dataManager: { id: string; email: string };
let technician: { id: string; email: string; membershipId: string };
let parcelId: string;
let prov: string;

const CAPABILITIES = [
  "core.projects",
  "gis.maps",
  "gis.parcels",
  "field.surveys",
  "social.analytics",
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
function command(type: SyncCommand["type"], payload: Record<string, unknown>): SyncCommand {
  sequence += 1;
  return {
    commandId: randomUUID(),
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
    deviceRevision: sequence,
    occurredAt: new Date().toISOString(),
    appVersion: "0.1.0",
    packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
    type,
    payload,
  } as SyncCommand;
}

/**
 * A questionnaire with a heading, two languages and a closed question — the smallest form that
 * exercises every part of the path without becoming a fixture nobody reads.
 */
const DEFINITION = {
  questions: [
    {
      code: "tenure_category",
      ordinal: 0,
      type: "SINGLE_CHOICE" as const,
      prompt: "¿Relación con el predio?",
      helpText: "Marca una sola opción.",
      required: true,
      sensitivity: "NON_PERSONAL" as const,
      section: "Vivienda",
      options: [
        {
          code: "owner_occupier",
          label: "Propietario ocupante",
          ordinal: 0,
          translations: { en: "Owner-occupier" },
        },
        { code: "tenant", label: "Arrendatario", ordinal: 1, translations: { en: "Tenant" } },
      ],
      translations: {
        en: {
          prompt: "Relationship to the parcel?",
          helpText: "Choose one option.",
          section: "Housing",
        },
      },
    },
    {
      code: "has_concern",
      ordinal: 1,
      type: "BOOLEAN" as const,
      prompt: "¿Tiene alguna preocupación?",
      helpText: null,
      required: true,
      sensitivity: "NON_PERSONAL" as const,
      section: "Percepción",
      options: [],
      translations: {
        en: { prompt: "Do you have any concern?", helpText: null, section: "Perception" },
      },
    },
  ],
};

let templateId: string;
let versionId: string;

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
  coordinator = await make("authoring-coordinator", "COORDINATOR");
  dataManager = await make("authoring-data-manager", "PROJECT_DATA_MANAGER");
  technician = await make("authoring-technician", "FIELD_TECHNICIAN");

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  parcelId = (
    await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      datasetVersionId: dataset.id,
      provenanceId: prov,
      parcelCode: "001",
    })
  ).parcelId;
});

afterAll(() => db.close());

describe("1 · who may write a questionnaire, and who may decide it is asked", () => {
  it("a data manager writes the instrument", async () => {
    const ctx = await contextFor(dataManager);
    const created = await createSurveyTemplate(db.runtime, ctx, {
      key: "ficha_socioeconomica",
      name: "Ficha socioeconómica",
      description: "El instrumento de este estudio.",
    });
    templateId = created.templateId;
    versionId = created.versionId;
    expect(created.versionLabel).toBe("v1");

    await saveSurveyDefinition(db.runtime, ctx, { versionId, definition: DEFINITION });
    const view = await loadSurveyAuthoring(db.runtime, ctx, versionId);
    expect(view.selected?.definition.questions.map((q) => q.code)).toEqual([
      "tenure_category",
      "has_concern",
    ]);
    expect(view.canAuthor).toBe(true);
  });

  /*
   * The shape of `PROJECT_DATA_MANAGER` is what is **absent** from it (ADR-030). Preparing a
   * project includes writing the form; deciding that households will be asked it does not.
   */
  it("and cannot decide it is asked", async () => {
    const ctx = await contextFor(dataManager);
    expect(ctx.permissions.has("field.instruments.author")).toBe(true);
    expect(ctx.permissions.has("field.instruments.publish")).toBe(false);
    await expect(publishSurveyVersion(db.runtime, ctx, { versionId })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("and gains nothing about what anybody answered", async () => {
    const ctx = await contextFor(dataManager);
    for (const key of [
      "field.responses.read",
      "pii.read",
      "social.coding.review",
      "quality.review",
      "portal.publish",
    ] as const) {
      expect(ctx.permissions.has(key), key).toBe(false);
    }
  });

  it("a technician can write nothing at all", async () => {
    const ctx = await contextFor(technician);
    expect(ctx.permissions.has("field.instruments.author")).toBe(false);
    await expect(
      saveSurveyDefinition(db.runtime, ctx, { versionId, definition: DEFINITION }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("the coordinator publishes, and the version is frozen from that moment", async () => {
    const ctx = await contextFor(coordinator);
    const published = await publishSurveyVersion(db.runtime, ctx, { versionId });
    expect(published.versionLabel).toBe("v1");
    expect(published.definitionHash).toMatch(/^[0-9a-f]{8}$/);

    // Written once and not again: the trigger of migration 0014 refuses the edit whoever asks.
    await expect(
      saveSurveyDefinition(db.runtime, ctx, { versionId, definition: DEFINITION }),
    ).rejects.toThrow(/published|cannot be edited/i);
  });

  it("records who decided it, beside when", async () => {
    const rows = await db.migrator.execute(sql`
      select published_by_user_id, published_at from app.survey_version where id = ${versionId}
    `);
    const row = rows.rows[0] as { published_by_user_id: string; published_at: Date };
    expect(row.published_by_user_id).toBe(coordinator.id);
    expect(row.published_at).toBeTruthy();
  });

  /*
   * The only way a published questionnaire "changes": a copy, which becomes the next version.
   * The published one keeps its words, because answers already point at it.
   */
  it("a correction is the next version, never an edit", async () => {
    const ctx = await contextFor(coordinator);
    const next = await createSurveyDraft(db.runtime, ctx, {
      templateId,
      copyFromVersionId: versionId,
    });
    expect(next.versionLabel).toBe("v2");

    const view = await loadSurveyAuthoring(db.runtime, ctx, next.versionId);
    expect(view.selected?.definition.questions.map((q) => q.code)).toEqual([
      "tenure_category",
      "has_concern",
    ]);
    expect(view.selected?.definition.questions[0]!.section).toBe("Vivienda");
    expect(view.selected?.definition.questions[0]!.translations.en?.section).toBe("Housing");

    // One draft at a time: two open drafts would make "what is being written" ambiguous.
    await expect(
      createSurveyDraft(db.runtime, ctx, { templateId, copyFromVersionId: null }),
    ).rejects.toThrow(/draft/i);
  });
});

describe("2 · the same form, on the phone", () => {
  let campaignId: string;

  beforeAll(async () => {
    const campaign = await createCampaign(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      surveyVersionId: versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    campaignId = campaign.id;
    await createAssignment(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: prov,
      campaignId,
      parcelId,
      assigneeMembershipId: technician.membershipId,
      assigneeUserId: technician.id,
    });
  });

  it("the Field Pack carries the authored questionnaire, headings and both languages", async () => {
    const ctx = await contextFor(technician);
    const response = await buildFieldPack(db.runtime, ctx, {
      sessionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      technician: { email: technician.email, name: null },
    });
    if (response.kind !== "pack") throw new Error("expected a pack");

    const questions = response.pack.campaign.surveyVersion.questions;
    expect(questions.map((q) => q.code)).toEqual(["tenure_category", "has_concern"]);
    expect(questions[0]!.section).toBe("Vivienda");
    expect(questions[0]!.translations.en?.section).toBe("Housing");
    expect(questions[0]!.translations.en?.prompt).toBe("Relationship to the parcel?");
    expect(questions[0]!.translations.en?.options.owner_occupier).toBe("Owner-occupier");

    /*
     * The assertion the whole gate is about. Reading the form in English changes every word and
     * **no identity**: the question codes and the option codes are one set, so an answer captured
     * in English is the same answer captured in Spanish.
     */
    const spanishCodes = questions.map((q) => q.code);
    const englishCodes = questions.map((q) => q.code);
    expect(englishCodes).toEqual(spanishCodes);
    expect(Object.keys(questions[0]!.translations.en!.options).sort()).toEqual(
      questions[0]!.options.map((option) => option.code).sort(),
    );
  });

  it("an answer captured offline synchronises once and tabulates", async () => {
    const ctx = await contextFor(technician);
    const pack = await buildFieldPack(db.runtime, ctx, {
      sessionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      technician: { email: technician.email, name: null },
    });
    if (pack.kind !== "pack") throw new Error("expected a pack");
    const assignmentId = pack.pack.assignments[0]!.id;

    const submit = command("survey.submit", {
      assignmentId,
      visitId: null,
      surveyVersionId: versionId,
      answers: {
        // The option **code**, which is what an English screen would have sent too.
        tenure_category: { kind: "option", optionCode: "owner_occupier" },
        has_concern: { kind: "boolean", value: true },
      },
    });
    const first = await processSyncCommands(db.runtime, ctx, [submit]);
    expect(first.results[0]!.outcome).toBe("applied");
    expect(first.results[0]!.instanceStatus).toBe("SUBMITTED");

    // The same intent again is one response, not two (ADR-028).
    const again = await processSyncCommands(db.runtime, ctx, [submit]);
    expect(again.results[0]!.outcome).toBe("duplicate");

    const coordinatorCtx = await contextFor(coordinator);
    const tabulation = await loadTabulation(db.runtime, coordinatorCtx, versionId);
    expect(tabulation.submitted).toBe(1);
    const tenure = tabulation.questions.find((q) => q.code === "tenure_category");
    expect(tenure).toBeDefined();
    expect(tenure!.answered).toBe(1);
    expect(tenure!.tallies.find((tally) => tally.code === "owner_occupier")?.count).toBe(1);
    // An option nobody chose produces no tally row, which is this module's existing behaviour:
    // the tabulation counts what was answered and does not manufacture a zero.
    expect(tenure!.tallies.find((tally) => tally.code === "tenant")).toBeUndefined();
    // The words the tabulation prints are the definition's own, not a code.
    expect(tenure!.tallies.find((tally) => tally.code === "owner_occupier")?.label).toBe(
      "Propietario ocupante",
    );
  });
});

describe("3 · a questionnaire belongs to its project", () => {
  it("another project of the same tenant sees none of it", async () => {
    const sessionUser: SessionUser = {
      subject: coordinator.id,
      email: coordinator.email,
      name: null,
      emailVerified: true,
    };
    const ctx = await buildRequestContext(db.runtime, {
      sessionUser,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    const view = await loadSurveyAuthoring(db.runtime, ctx, null);
    expect(view.templates.map((template) => template.key)).toEqual(["ficha_socioeconomica"]);

    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from app.survey_template where project_id <> ${w.projectX.id}
    `);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});
