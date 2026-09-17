import { auditSchema, storageSchema, templatesSchema } from "@eia/db";
import {
  DRAFT_BANNERS,
  TemplateMissingDraftBanner,
  TemplateNotActivatable,
  UnsupportedUpload,
  type SessionUser,
} from "@eia/domain";
import {
  attempt,
  buildDocxTemplate,
  buildMacroEnabledTemplate,
  createProjectMembership,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TemplateParagraph,
  type TwoTenantWorld,
} from "@eia/testing";
import { and, desc, eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  activateTemplateVersion,
  buildRequestContext,
  buildTemplateBinding,
  createReportTemplate,
  createS3Storage,
  createUploadIntent,
  finalizeUpload,
  generateDocumentFromTemplate,
  listGeneratedDocuments,
  listReportTemplates,
  uploadTemplateVersion,
} from "../src/index";

/**
 * The template library end to end, against a real database and a real provider (ADR-036).
 *
 * The suite is about what a template may not do: carry code, print a value nobody declared, invent
 * a figure the project does not have, or produce a document that does not say it is a draft — plus
 * the two archival properties, that an activated version is frozen and a generated document is
 * reproducible.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let coordinator: { id: string; email: string };
let specialist: { id: string; email: string };
let storage: ReturnType<typeof createS3Storage>;

const NOT_AVAILABLE = "Dato no disponible";

/** A template that is complete: one required value, one optional, and the banner. */
const GOOD_TEMPLATE: TemplateParagraph[] = [
  { runs: ["Estudio: ", "{{", "project", ".na", "me}}"], headingLevel: 1 },
  { runs: ["Título oficial: {{project.official_title}}"] },
  { runs: ["Localidad: {{project.locality}}"] },
  { runs: ["Longitud del corredor: {{territory.corridor_length_km}} km"] },
  { runs: ["Predios: {{territory.parcel_universe}}"] },
  { runs: ["Medidas del plan: {{pgas.measures}}"] },
  { runs: ["Generado el {{generation.date}} · {{generation.locale}}"] },
  { runs: ["{{generation.draft_banner}}"] },
];

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

/** The three steps a template takes to reach storage, exactly as a browser drives them. */
async function storeTemplate(bytes: Uint8Array, filename = "plantilla.docx"): Promise<string> {
  const ctx = await contextFor(coordinator);
  const intent = await createUploadIntent(db.runtime, ctx, storage, {
    namespace: "templates",
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
  return stored.storedObjectId;
}

async function textOf(bytes: Uint8Array): Promise<string> {
  const files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" });
  return new TextDecoder()
    .decode(files["word/document.xml"]!)
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of [
    "core.projects",
    "core.documents",
    "social.analytics",
    "field.surveys",
    "gis.maps",
    "gis.parcels",
    "reports.social_generator",
  ] as const) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }

  const user = await createUser(db.migrator, "template-coordinator");
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

  // A social specialist: holds `reports.write` and deliberately not `deliverables.approve`.
  const spec = await createUser(db.migrator, "template-specialist");
  const specMembership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: spec.id,
    role: "MEMBER",
  });
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: specMembership.id,
    role: "SOCIAL_SPECIALIST" as never,
  });
  specialist = spec;

  const config = inject("eiaTestStorage");
  storage = createS3Storage({
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  // The project has a name and nothing else measured: the state most projects start in, and the
  // one that proves an absence is not a zero.
  await db.migrator.execute(sql`
    update app.project
       set official_title = 'Estudio socioambiental de la vía de prueba',
           location_label = 'Cantón de prueba, Provincia de prueba'
     where id = ${w.projectX.id}
  `);
});
afterAll(() => db.close());

describe("registering a template and its versions", () => {
  it("stores a `.docx` as v1 and reads it in the same act", async () => {
    const ctx = await contextFor(coordinator);
    const template = await createReportTemplate(db.runtime, ctx, {
      code: "TPL-COVER",
      name: "Carátula del estudio",
      kind: "cover",
      purpose: "La portada que la consultora entrega con cada estudio de este programa.",
    });

    const objectId = await storeTemplate(buildDocxTemplate(GOOD_TEMPLATE));
    const version = await uploadTemplateVersion(db.runtime, ctx, storage, {
      templateId: template.id,
      locale: "es-EC",
      storedObjectId: objectId,
    });

    expect(version.versionLabel).toBe("v1");
    expect(version.answered).toBe(false);
    expect(version.validationError).toBeNull();
    expect(version.manifest?.unknown).toEqual([]);
    expect(version.manifest?.supported).toContain("project.name");
    expect(version.manifest?.required).toContain("generation.draft_banner");

    const [row] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplateVersion)
      .where(eq(templatesSchema.reportTemplateVersion.id, version.versionId));
    expect(row!.state).toBe("VALIDATED");
    expect(row!.validatedAt).not.toBeNull();
  });

  /*
   * The rule ADR-031 set for a delivered file. A firm re-uploading their cover template should be
   * told it is already v1, not handed a v2 identical to it.
   */
  it("answers the same bytes rather than creating a second version", async () => {
    const ctx = await contextFor(coordinator);
    const [template] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplate)
      .where(eq(templatesSchema.reportTemplate.code, "TPL-COVER"));

    const objectId = await storeTemplate(buildDocxTemplate(GOOD_TEMPLATE), "otra-vez.docx");
    const again = await uploadTemplateVersion(db.runtime, ctx, storage, {
      templateId: template!.id,
      locale: "es-EC",
      storedObjectId: objectId,
    });
    expect(again.answered).toBe(true);
    expect(again.versionLabel).toBe("v1");
  });

  it("makes changed bytes the next version", async () => {
    const ctx = await contextFor(coordinator);
    const [template] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplate)
      .where(eq(templatesSchema.reportTemplate.code, "TPL-COVER"));

    const objectId = await storeTemplate(
      buildDocxTemplate([
        ...GOOD_TEMPLATE,
        { runs: ["Programa: {{project.programme_reference}}"] },
      ]),
      "corregida.docx",
    );
    const v2 = await uploadTemplateVersion(db.runtime, ctx, storage, {
      templateId: template!.id,
      locale: "es-EC",
      storedObjectId: objectId,
    });
    expect(v2.answered).toBe(false);
    expect(v2.versionLabel).toBe("v2");
  });

  /*
   * ES and EN are different versions of the same template, and they version independently: a firm
   * that corrects their Spanish cover three times has not changed the English one.
   */
  it("versions the two languages independently, never translating one into the other", async () => {
    const ctx = await contextFor(coordinator);
    const [template] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplate)
      .where(eq(templatesSchema.reportTemplate.code, "TPL-COVER"));

    const objectId = await storeTemplate(
      buildDocxTemplate([
        { runs: ["Study: {{project.name}}"] },
        { runs: ["Generated {{generation.date}} · {{generation.locale}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
      "cover-en.docx",
    );
    const en = await uploadTemplateVersion(db.runtime, ctx, storage, {
      templateId: template!.id,
      locale: "en",
      storedObjectId: objectId,
    });
    expect(en.versionLabel).toBe("v1");
  });

  it("refuses a macro-enabled package, whatever its name claims", async () => {
    const ctx = await contextFor(coordinator);
    const [template] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplate)
      .where(eq(templatesSchema.reportTemplate.code, "TPL-COVER"));

    const objectId = await storeTemplate(
      buildMacroEnabledTemplate(GOOD_TEMPLATE),
      "con-macros.docx",
    );
    const version = await uploadTemplateVersion(db.runtime, ctx, storage, {
      templateId: template!.id,
      locale: "es-EC",
      storedObjectId: objectId,
    });
    // Stored, unreadable, and stuck at UPLOADED: the file exists because the provider already has
    // it, and it can never be activated.
    expect(version.manifest).toBeNull();
    expect(version.validationError).toContain("macro project");
    const [row] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplateVersion)
      .where(eq(templatesSchema.reportTemplateVersion.id, version.versionId));
    expect(row!.state).toBe("UPLOADED");
  });

  it("refuses an object from another namespace as a template", async () => {
    const ctx = await contextFor(coordinator);
    const [template] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplate)
      .where(eq(templatesSchema.reportTemplate.code, "TPL-COVER"));

    const bytes = buildDocxTemplate(GOOD_TEMPLATE);
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: "documents",
      filename: "no-es-plantilla.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: bytes.byteLength,
    });
    await fetch(intent.url, { method: "PUT", headers: intent.headers, body: bytes });
    const stored = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });

    await expect(
      uploadTemplateVersion(db.runtime, ctx, storage, {
        templateId: template!.id,
        locale: "es-EC",
        storedObjectId: stored.storedObjectId,
      }),
    ).rejects.toThrow(/templates namespace/);
  });

  it("refuses a `.doc` or a `.docm` before a URL is even issued", async () => {
    const ctx = await contextFor(coordinator);
    for (const [filename, mimeType] of [
      ["plantilla.doc", "application/msword"],
      ["plantilla.docm", "application/vnd.ms-word.document.macroEnabled.12"],
    ] as const) {
      await expect(
        createUploadIntent(db.runtime, ctx, storage, {
          namespace: "templates",
          filename,
          mimeType,
          sizeBytes: 2048,
        }),
      ).rejects.toThrow(UnsupportedUpload);
    }
  });
});

describe("activation, which is a decision", () => {
  async function versionOf(code: string, label: string, locale: "es-EC" | "en" = "es-EC") {
    const [row] = await db.migrator
      .select({ id: templatesSchema.reportTemplateVersion.id })
      .from(templatesSchema.reportTemplateVersion)
      .innerJoin(
        templatesSchema.reportTemplate,
        eq(templatesSchema.reportTemplate.id, templatesSchema.reportTemplateVersion.templateId),
      )
      .where(
        and(
          eq(templatesSchema.reportTemplate.code, code),
          eq(templatesSchema.reportTemplateVersion.versionLabel, label),
          eq(templatesSchema.reportTemplateVersion.locale, locale),
        ),
      );
    return row!.id;
  }

  it("activates a validated version and supersedes the previous one", async () => {
    const ctx = await contextFor(coordinator);
    const v1 = await versionOf("TPL-COVER", "v1");
    const first = await activateTemplateVersion(db.runtime, ctx, v1);
    expect(first.supersededId).toBeNull();

    const v2 = await versionOf("TPL-COVER", "v2");
    const second = await activateTemplateVersion(db.runtime, ctx, v2);
    expect(second.supersededId).toBe(v1);

    const [old] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplateVersion)
      .where(eq(templatesSchema.reportTemplateVersion.id, v1));
    expect(old!.state).toBe("SUPERSEDED");
  });

  it("refuses a template that uses a placeholder nobody declared", async () => {
    const ctx = await contextFor(coordinator);
    const template = await createReportTemplate(db.runtime, ctx, {
      code: "TPL-BAD",
      name: "Plantilla con campos inventados",
      kind: "annex",
      purpose: "Existe para probar que un marcador no declarado impide la activación.",
    });
    const objectId = await storeTemplate(
      buildDocxTemplate([
        { runs: ["{{project.name}} · {{respondent.full_name}} · {{project.budget_usd}}"] },
        { runs: ["{{generation.date}} {{generation.locale}} {{generation.draft_banner}}"] },
      ]),
      "inventada.docx",
    );
    const version = await uploadTemplateVersion(db.runtime, ctx, storage, {
      templateId: template.id,
      locale: "es-EC",
      storedObjectId: objectId,
    });
    expect(version.manifest?.unknown).toEqual(["respondent.full_name", "project.budget_usd"]);

    await expect(activateTemplateVersion(db.runtime, ctx, version.versionId)).rejects.toThrow(
      TemplateNotActivatable,
    );

    const [row] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplateVersion)
      .where(eq(templatesSchema.reportTemplateVersion.id, version.versionId));
    expect(row!.state).toBe("VALIDATED");
  });

  it("refuses a template that does not say it produces a draft", async () => {
    const ctx = await contextFor(coordinator);
    const template = await createReportTemplate(db.runtime, ctx, {
      code: "TPL-NOBANNER",
      name: "Plantilla sin aviso de borrador",
      kind: "annex",
      purpose: "Existe para probar que el aviso de borrador es obligatorio en toda plantilla.",
    });
    const objectId = await storeTemplate(
      buildDocxTemplate([
        { runs: ["{{project.name}}"] },
        { runs: ["{{generation.date}} · {{generation.locale}}"] },
      ]),
      "sin-aviso.docx",
    );
    const version = await uploadTemplateVersion(db.runtime, ctx, storage, {
      templateId: template.id,
      locale: "es-EC",
      storedObjectId: objectId,
    });
    await expect(activateTemplateVersion(db.runtime, ctx, version.versionId)).rejects.toThrow(
      TemplateMissingDraftBanner,
    );
  });

  it("is a different grant from uploading: a specialist prepares, a coordinator approves", async () => {
    const specialistCtx = await contextFor(specialist);
    const v2 = await versionOf("TPL-COVER", "v2");
    // `reports.write` but not `deliverables.approve`.
    await expect(activateTemplateVersion(db.runtime, specialistCtx, v2)).rejects.toThrow();
  });
});

describe("generating a document", () => {
  async function activeCoverVersion(): Promise<string> {
    const [row] = await db.migrator
      .select({ id: templatesSchema.reportTemplateVersion.id })
      .from(templatesSchema.reportTemplateVersion)
      .innerJoin(
        templatesSchema.reportTemplate,
        eq(templatesSchema.reportTemplate.id, templatesSchema.reportTemplateVersion.templateId),
      )
      .where(
        and(
          eq(templatesSchema.reportTemplate.code, "TPL-COVER"),
          eq(templatesSchema.reportTemplateVersion.state, "ACTIVE"),
          eq(templatesSchema.reportTemplateVersion.locale, "es-EC"),
        ),
      );
    return row!.id;
  }

  it("renders the project's own values and records what it was made from", async () => {
    const ctx = await contextFor(coordinator);
    const versionId = await activeCoverVersion();
    const result = await generateDocumentFromTemplate(db.runtime, ctx, storage, {
      templateVersionId: versionId,
      notAvailableText: NOT_AVAILABLE,
      generatedAt: new Date("2026-09-17T12:00:00Z"),
    });

    const [object] = await db.migrator
      .select()
      .from(storageSchema.storedObject)
      .where(eq(storageSchema.storedObject.id, result.storedObjectId));
    expect(object!.namespace).toBe("generated");
    // The key names nobody: a namespace and three UUIDs (ADR-031 §1).
    expect(object!.objectKey).toMatch(
      /^t\/[0-9a-f-]{36}\/p\/[0-9a-f-]{36}\/generated\/[0-9a-f-]{36}$/,
    );

    const bytes = await storage.get(object!.objectKey);
    const text = await textOf(bytes);
    expect(text).toContain("Estudio:");
    expect(text).toContain("Estudio socioambiental de la vía de prueba");
    expect(text).toContain("Cantón de prueba");
    expect(text).toContain(DRAFT_BANNERS["es-EC"]);
    expect(text).not.toContain("{{");

    const [generated] = await db.migrator
      .select()
      .from(templatesSchema.generatedDocument)
      .where(eq(templatesSchema.generatedDocument.id, result.generatedDocumentId));
    expect(generated!.templateVersionId).toBe(versionId);
    expect(generated!.locale).toBe("es-EC");
    expect(generated!.fileSha256).toHaveLength(64);
    // No prose was generated, and the row says so rather than leaving the question unanswerable.
    expect(generated!.narrativeModel).toBeNull();
  });

  /*
   * The rule the whole feature turns on. This project has no corridor length and no parcel
   * universe measured, and the document must say so rather than print `0`.
   */
  it("prints an explicit no-value for what the project has not measured, never zero", async () => {
    const ctx = await contextFor(coordinator);
    const versionId = await activeCoverVersion();
    const result = await generateDocumentFromTemplate(db.runtime, ctx, storage, {
      templateVersionId: versionId,
      notAvailableText: NOT_AVAILABLE,
    });

    const [object] = await db.migrator
      .select()
      .from(storageSchema.storedObject)
      .where(eq(storageSchema.storedObject.id, result.storedObjectId));
    const text = await textOf(await storage.get(object!.objectKey));

    expect(text).toContain(`Longitud del corredor: ${NOT_AVAILABLE} km`);
    expect(text).toContain(`Predios: ${NOT_AVAILABLE}`);
    expect(text).not.toMatch(/Longitud del corredor: 0 km/);
    expect(text).not.toMatch(/Predios: 0\b/);
    expect(result.declaredAbsent).toContain("territory.corridor_length_km");
  });

  it("refuses to generate from a version nobody activated", async () => {
    const ctx = await contextFor(coordinator);
    const [pending] = await db.migrator
      .select({ id: templatesSchema.reportTemplateVersion.id })
      .from(templatesSchema.reportTemplateVersion)
      .where(eq(templatesSchema.reportTemplateVersion.state, "VALIDATED"))
      .limit(1);
    await expect(
      generateDocumentFromTemplate(db.runtime, ctx, storage, {
        templateVersionId: pending!.id,
        notAvailableText: NOT_AVAILABLE,
      }),
    ).rejects.toThrow(/activated/);
  });

  it("keeps an older generated document readable after a newer one exists", async () => {
    const ctx = await contextFor(coordinator);
    const documents = await listGeneratedDocuments(db.runtime, ctx);
    expect(documents.length).toBeGreaterThanOrEqual(2);
    for (const document of documents) {
      const [object] = await db.migrator
        .select()
        .from(storageSchema.storedObject)
        .where(eq(storageSchema.storedObject.id, document.storedObjectId));
      const bytes = await storage.get(object!.objectKey);
      // Every one is still a Word package with the banner in it.
      expect(await textOf(bytes)).toContain(DRAFT_BANNERS["es-EC"]);
    }
  });

  it("audits the three moments without ever naming the file", async () => {
    const entries = await db.migrator
      .select()
      .from(auditSchema.log)
      .where(sql`${auditSchema.log.action} like 'templates.%'`)
      .orderBy(desc(auditSchema.log.occurredAt));
    const actions = new Set(entries.map((entry) => entry.action));
    expect(actions).toContain("templates.version.uploaded");
    expect(actions).toContain("templates.version.activated");
    expect(actions).toContain("templates.document.generated");
    for (const entry of entries) {
      const details = JSON.stringify(entry.details);
      expect(details).not.toContain(".docx");
      expect(details).not.toContain("t/");
    }
  });
});

describe("the binding a renderer is handed", () => {
  it("carries only declared placeholders, and a null where the project has no value", async () => {
    const ctx = await contextFor(coordinator);
    const binding = await buildTemplateBinding(db.runtime, ctx, {
      locale: "es-EC",
      generatedAt: new Date("2026-09-17T12:00:00Z"),
    });
    const keys = binding.values.map((value) => value.key);
    expect(keys).toContain("project.name");
    // Nothing personal, provisional or internal can be in it, because the registry is what it is
    // built from.
    for (const key of keys) {
      expect(key).not.toMatch(/respondent|answer|candidate|classification|storage|token/);
    }
    const byKey = new Map(binding.values.map((value) => [value.key, value.text]));
    expect(byKey.get("territory.corridor_length_km")).toBeNull();
    expect(byKey.get("generation.draft_banner")).toBe(DRAFT_BANNERS["es-EC"]);
  });
});

describe("what the database refuses, not only the application", () => {
  it("refuses to change which file a template version is", async () => {
    const [version] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplateVersion)
      .limit(1);
    const outcome = await attempt(
      db.migrator.execute(sql`
        update app.report_template_version set file_sha256 = repeat('0', 64) where id = ${version!.id}
      `),
    );
    expect(outcome).toContain("cannot change");
  });

  it("refuses to edit or delete a generated document", async () => {
    const [generated] = await db.migrator.select().from(templatesSchema.generatedDocument).limit(1);
    expect(generated).toBeDefined();
    const updated = await attempt(
      db.migrator.execute(
        sql`update app.generated_document set snapshot_digest = 'x' where id = ${generated!.id}`,
      ),
    );
    expect(updated).toContain("written once");
    const deleted = await attempt(
      db.migrator.execute(sql`delete from app.generated_document where id = ${generated!.id}`),
    );
    expect(deleted).toContain("written once");
  });

  it("refuses to delete a template or a template version", async () => {
    const [template] = await db.migrator.select().from(templatesSchema.reportTemplate).limit(1);
    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.report_template where id = ${template!.id}`),
      ),
    ).toContain("written once");
    const [version] = await db.migrator
      .select()
      .from(templatesSchema.reportTemplateVersion)
      .limit(1);
    expect(
      await attempt(
        db.migrator.execute(sql`delete from app.report_template_version where id = ${version!.id}`),
      ),
    ).toContain("written once");
  });
});

describe("what a reader is shown", () => {
  it("lists the templates with their versions, states and manifests", async () => {
    const ctx = await contextFor(coordinator);
    const templates = await listReportTemplates(db.runtime, ctx);
    const cover = templates.find((template) => template.code === "TPL-COVER");
    expect(cover).toBeDefined();
    expect(cover!.versions.length).toBeGreaterThanOrEqual(3);
    const active = cover!.versions.filter((version) => version.state === "ACTIVE");
    // One active version per locale: a project has one current cover in Spanish, not two.
    expect(active.filter((version) => version.locale === "es-EC")).toHaveLength(1);
  });
});
