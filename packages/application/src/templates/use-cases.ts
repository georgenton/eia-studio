import { createHash, randomUUID } from "node:crypto";

import {
  reportsSchema,
  storageSchema,
  templatesSchema,
  withDbContext,
  type Database,
  type DbTx,
} from "@eia/db";
import {
  assertActivatable,
  assertTemplateTransition,
  DOWNLOAD_LINK_TTL_SECONDS,
  InvalidInput,
  NotFound,
  requireCapability,
  requirePermission,
  TEMPLATE_KINDS,
  TEMPLATE_LOCALES,
  templateManifestSchema,
  type RequestContext,
  type StoragePort,
  type TemplateKind,
  type TemplateLocale,
  type TemplateManifest,
} from "@eia/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { buildTemplateBinding } from "./binding";
import { readTemplateManifest, renderTemplate } from "./renderer";

/**
 * The template library's lifecycle: registered, uploaded, validated, activated, rendered (ADR-036).
 *
 * The one distinction the whole file turns on: **validation is a fact about the file, activation
 * is a decision about the study.** Parsing tells you which placeholders a `.docx` carries;
 * deciding that documents may be produced from it is somebody putting their name to the format a
 * client will receive. So they are two acts, and the second freezes the version — from that moment
 * a deliverable can name it, and "which template produced this?" has to stay answerable.
 */

export const createTemplateInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(20)
      .regex(/^[A-Z0-9-]+$/u, "a template code is upper-case letters, digits and hyphens"),
    name: z.string().trim().min(3).max(200),
    kind: z.enum(TEMPLATE_KINDS),
    purpose: z.string().trim().min(10).max(600),
  })
  .strict();
export type CreateTemplateInput = z.infer<typeof createTemplateInputSchema>;

export async function createReportTemplate(
  db: Database,
  ctx: RequestContext,
  raw: CreateTemplateInput,
): Promise<{ id: string; code: string }> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);
  const input = createTemplateInputSchema.parse(raw);

  return withDbContext(db, ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: templatesSchema.reportTemplate.id })
      .from(templatesSchema.reportTemplate)
      .where(
        and(
          eq(templatesSchema.reportTemplate.projectId, projectId),
          eq(templatesSchema.reportTemplate.code, input.code),
        ),
      );
    if (existing) {
      throw new InvalidInput(
        `this project already has a template ${input.code}. Upload a new version of it rather ` +
          "than registering a second template under the same code.",
      );
    }

    const id = randomUUID();
    await tx.insert(templatesSchema.reportTemplate).values({
      id,
      tenantId: ctx.tenantId,
      projectId,
      code: input.code,
      name: input.name,
      kind: input.kind,
      purpose: input.purpose,
      createdByUserId: ctx.userId,
    });
    return { id, code: input.code };
  });
}

export const uploadTemplateVersionInputSchema = z
  .object({
    templateId: z.uuid(),
    locale: z.enum(TEMPLATE_LOCALES),
    /** The verified upload in the `templates` namespace. */
    storedObjectId: z.uuid(),
  })
  .strict();
export type UploadTemplateVersionInput = z.infer<typeof uploadTemplateVersionInputSchema>;

export interface UploadedTemplateVersion {
  readonly versionId: string;
  readonly versionLabel: string;
  /** True when these exact bytes were already this template's version in this locale. */
  readonly answered: boolean;
  readonly manifest: TemplateManifest | null;
  readonly validationError: string | null;
}

/**
 * Register a stored `.docx` as the next version of a template, and read it.
 *
 * Upload and validation are one act deliberately: a template version nobody has parsed is a row
 * whose only honest state is *unknown*, and leaving it there means a person has to remember to ask.
 * The state machine still distinguishes them, because a re-validation after the registry grows is
 * a real operation on an unchanged file.
 *
 * **The same bytes twice are answered, not duplicated** — the rule ADR-031 set for a delivered
 * file, for the same reason: a firm re-uploading their cover template should be told it is already
 * v1, not given a v2 that is identical to it.
 */
export async function uploadTemplateVersion(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  raw: UploadTemplateVersionInput,
): Promise<UploadedTemplateVersion> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);
  const input = uploadTemplateVersionInputSchema.parse(raw);

  const stored = await withDbContext(db, ctx, async (tx) => {
    const [template] = await tx
      .select({ id: templatesSchema.reportTemplate.id, code: templatesSchema.reportTemplate.code })
      .from(templatesSchema.reportTemplate)
      .where(
        and(
          eq(templatesSchema.reportTemplate.id, input.templateId),
          eq(templatesSchema.reportTemplate.projectId, projectId),
        ),
      );
    if (!template) throw new NotFound("report template");

    const [object] = await tx
      .select({
        id: storageSchema.storedObject.id,
        namespace: storageSchema.storedObject.namespace,
        objectKey: storageSchema.storedObject.objectKey,
        sha256: storageSchema.storedObject.sha256,
        filename: storageSchema.storedObject.originalFilename,
        sizeBytes: storageSchema.storedObject.sizeBytes,
      })
      .from(storageSchema.storedObject)
      .where(
        and(
          eq(storageSchema.storedObject.id, input.storedObjectId),
          eq(storageSchema.storedObject.projectId, projectId),
        ),
      );
    if (!object) throw new NotFound("stored object");
    if (object.namespace !== "templates") {
      // A delivered study and a template are different things in different namespaces, and an
      // object from one must not become the other (ADR-036 §4).
      throw new InvalidInput("this object is not in the templates namespace");
    }

    const [duplicate] = await tx
      .select({
        id: templatesSchema.reportTemplateVersion.id,
        versionLabel: templatesSchema.reportTemplateVersion.versionLabel,
        manifest: templatesSchema.reportTemplateVersion.manifest,
      })
      .from(templatesSchema.reportTemplateVersion)
      .where(
        and(
          eq(templatesSchema.reportTemplateVersion.templateId, input.templateId),
          eq(templatesSchema.reportTemplateVersion.locale, input.locale),
          eq(templatesSchema.reportTemplateVersion.fileSha256, object.sha256),
        ),
      );

    return { template, object, duplicate };
  });

  if (stored.duplicate) {
    return {
      versionId: stored.duplicate.id,
      versionLabel: stored.duplicate.versionLabel,
      answered: true,
      manifest: parseManifest(stored.duplicate.manifest),
      validationError: null,
    };
  }

  // Parsed **outside** the transaction: reading a Word package is bounded but not instant, and a
  // transaction held open across it would hold a connection for the duration.
  let manifest: TemplateManifest | null = null;
  let validationError: string | null = null;
  try {
    manifest = await readTemplateManifest(await storage.get(stored.object.objectKey));
  } catch (error) {
    validationError = (error as Error).message.slice(0, 500);
  }

  return withDbContext(db, ctx, async (tx) => {
    const versionLabel = await nextVersionLabel(tx, input.templateId, input.locale);
    const versionId = randomUUID();
    const provenanceId = await createTemplateProvenance(tx, ctx, projectId, {
      title: `Plantilla ${stored.template.code} ${versionLabel} (${input.locale})`,
      note: "Plantilla entregada por la consultora. Se conserva tal como llega.",
    });

    await tx.insert(templatesSchema.reportTemplateVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      projectId,
      templateId: input.templateId,
      versionLabel,
      locale: input.locale,
      state: manifest === null ? "UPLOADED" : "VALIDATED",
      storedObjectId: stored.object.id,
      fileSha256: stored.object.sha256,
      originalFilename: stored.object.filename,
      sizeBytes: stored.object.sizeBytes,
      manifest,
      validatedAt: manifest === null ? null : new Date(),
      validationError,
      uploadedByUserId: ctx.userId,
      provenanceId,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
      {
        action: "templates.version.uploaded",
        objectKind: "report_template_version",
        objectId: versionId,
        // The template's code, the label, the locale and what parsing found. Never the filename —
        // a template is named by whoever wrote it, and an audit line is read by more people than
        // the row is (ADR-031 §1).
        details: {
          template: stored.template.code,
          versionLabel,
          locale: input.locale,
          supported: manifest?.supported.length ?? 0,
          unknown: manifest?.unknown.length ?? 0,
          readable: manifest !== null,
        },
      },
    );

    return { versionId, versionLabel, answered: false, manifest, validationError };
  });
}

/**
 * Parse an already-uploaded version again.
 *
 * The file has not changed; what this product is willing to say may have. A template that was
 * blocked because it used `pgas.programmes` before that placeholder existed becomes activatable
 * without anybody re-uploading anything.
 */
export async function revalidateTemplateVersion(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  versionId: string,
): Promise<{ manifest: TemplateManifest | null; validationError: string | null }> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);

  const loaded = await withDbContext(db, ctx, (tx) => loadVersion(tx, projectId, versionId));
  if (loaded.state === "ACTIVE" || loaded.state === "SUPERSEDED") {
    throw new InvalidInput(
      "an activated version is settled: a deliverable may already name it, so its manifest does " +
        "not move. A changed template is the next version.",
    );
  }

  let manifest: TemplateManifest | null = null;
  let validationError: string | null = null;
  try {
    manifest = await readTemplateManifest(await storage.get(loaded.objectKey));
  } catch (error) {
    validationError = (error as Error).message.slice(0, 500);
  }

  await withDbContext(db, ctx, async (tx) => {
    if (manifest !== null) assertTemplateTransition(loaded.state, "VALIDATED");
    await tx
      .update(templatesSchema.reportTemplateVersion)
      .set({
        state: manifest === null ? loaded.state : "VALIDATED",
        manifest,
        validatedAt: manifest === null ? null : new Date(),
        validationError,
      })
      .where(eq(templatesSchema.reportTemplateVersion.id, versionId));
  });

  return { manifest, validationError };
}

/**
 * Decide that documents may be produced from this version.
 *
 * `assertActivatable` refuses an unknown placeholder and a missing draft banner, naming both — the
 * point of the whole validation step is that a template's errors are told to a person rather than
 * rendered as blanks. Activation supersedes the previously active version of the same template and
 * locale: a project has one current cover in Spanish, not two.
 */
export async function activateTemplateVersion(
  db: Database,
  ctx: RequestContext,
  versionId: string,
): Promise<{ versionId: string; supersededId: string | null }> {
  requireCapability(ctx, "reports.social_generator");
  // Deciding the format a client receives is the same grant that approves a deliverable.
  requirePermission(ctx, "deliverables.approve");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const version = await loadVersion(tx, projectId, versionId);
    assertTemplateTransition(version.state, "ACTIVE");
    const manifest = parseManifest(version.manifest);
    if (manifest === null) {
      throw new InvalidInput(
        "this version has not been read yet, so nothing is known about what it would print",
      );
    }
    assertActivatable(manifest);

    const [current] = await tx
      .select({ id: templatesSchema.reportTemplateVersion.id })
      .from(templatesSchema.reportTemplateVersion)
      .where(
        and(
          eq(templatesSchema.reportTemplateVersion.templateId, version.templateId),
          eq(templatesSchema.reportTemplateVersion.locale, version.locale),
          eq(templatesSchema.reportTemplateVersion.state, "ACTIVE"),
        ),
      );

    if (current) {
      assertTemplateTransition("ACTIVE", "SUPERSEDED");
      await tx
        .update(templatesSchema.reportTemplateVersion)
        .set({ state: "SUPERSEDED" })
        .where(eq(templatesSchema.reportTemplateVersion.id, current.id));
    }

    await tx
      .update(templatesSchema.reportTemplateVersion)
      .set({ state: "ACTIVE", activatedAt: new Date(), activatedByUserId: ctx.userId })
      .where(eq(templatesSchema.reportTemplateVersion.id, versionId));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
      {
        action: "templates.version.activated",
        objectKind: "report_template_version",
        objectId: versionId,
        details: {
          versionLabel: version.versionLabel,
          locale: version.locale,
          placeholders: manifest.supported.length,
          superseded: current?.id ?? "none",
        },
      },
    );

    return { versionId, supersededId: current?.id ?? null };
  });
}

export interface GeneratedDocumentResult {
  readonly generatedDocumentId: string;
  readonly storedObjectId: string;
  readonly sizeBytes: number;
  readonly declaredAbsent: ReadonlyArray<string>;
}

/**
 * Produce one document from one activated template version.
 *
 * The order is ADR-022's, one layer out: validated data → deterministic binding → template →
 * `.docx`. The renderer is handed the template's bytes and the binding and nothing else; it has no
 * database handle, no context and no snapshot, and there is no model anywhere on this path.
 *
 * The bytes are stored in the `generated` namespace through the same verified path an upload
 * takes, so a generated draft is addressable, immutable and unreachable by a query written for the
 * document corpus.
 */
export async function generateDocumentFromTemplate(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  input: {
    readonly templateVersionId: string;
    readonly notAvailableText: string;
    readonly reportVersionId?: string | null;
    readonly generatedAt?: Date;
  },
): Promise<GeneratedDocumentResult> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);
  const generatedAt = input.generatedAt ?? new Date();

  const version = await withDbContext(db, ctx, (tx) =>
    loadVersion(tx, projectId, input.templateVersionId),
  );
  if (version.state !== "ACTIVE") {
    throw new InvalidInput(
      "documents are produced only from an activated template version: a version nobody has " +
        "decided on is a file, not a format a client receives",
    );
  }

  const binding = await buildTemplateBinding(db, ctx, {
    locale: version.locale as TemplateLocale,
    generatedAt,
  });

  const rendered = await renderTemplate({
    bytes: await storage.get(version.objectKey),
    binding,
    notAvailableText: input.notAvailableText,
  });

  const snapshot = input.reportVersionId
    ? await withDbContext(db, ctx, (tx) =>
        readSnapshotDigest(tx, projectId, input.reportVersionId!),
      )
    : null;

  const objectId = randomUUID();
  const objectKey = `t/${ctx.tenantId}/p/${projectId}/generated/${objectId}`;
  await storage.put(
    objectKey,
    rendered.bytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const sha256 = createHash("sha256").update(rendered.bytes).digest("hex");

  return withDbContext(db, ctx, async (tx) => {
    await tx.insert(storageSchema.storedObject).values({
      id: objectId,
      tenantId: ctx.tenantId,
      projectId,
      namespace: "generated",
      objectKey,
      // The name a reader will be offered. It carries the template's code and the version, never a
      // person's name and never the key.
      originalFilename: `${version.templateCode}-${version.versionLabel}-${version.locale}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: rendered.bytes.byteLength,
      sha256,
      uploadedByUserId: ctx.userId,
    });

    const generatedDocumentId = randomUUID();
    const provenanceId = await createTemplateProvenance(tx, ctx, projectId, {
      title: `Documento generado · ${version.templateCode} ${version.versionLabel}`,
      note:
        "Producido a partir de una plantilla activada y de datos validados del proyecto. " +
        "Borrador: no es un entregable aprobado.",
    });

    await tx.insert(templatesSchema.generatedDocument).values({
      id: generatedDocumentId,
      tenantId: ctx.tenantId,
      projectId,
      templateVersionId: version.id,
      reportVersionId: input.reportVersionId ?? null,
      snapshotDigest: snapshot,
      locale: version.locale,
      storedObjectId: objectId,
      fileSha256: sha256,
      sizeBytes: rendered.bytes.byteLength,
      declaredAbsent: [...rendered.declaredAbsent],
      // No prose was generated. The column exists so that a document which *did* use a model says
      // which one, rather than the question being unanswerable (ADR-036 §8).
      narrativeModel: null,
      narrativePromptVersion: null,
      generatedByUserId: ctx.userId,
      generatedAt,
      provenanceId,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
      {
        action: "templates.document.generated",
        objectKind: "generated_document",
        objectId: generatedDocumentId,
        details: {
          template: version.templateCode,
          templateVersion: version.versionLabel,
          locale: version.locale,
          declaredAbsent: rendered.declaredAbsent.length,
          sizeBytes: rendered.bytes.byteLength,
        },
      },
    );

    return {
      generatedDocumentId,
      storedObjectId: objectId,
      sizeBytes: rendered.bytes.byteLength,
      declaredAbsent: rendered.declaredAbsent,
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * Read models
 * ------------------------------------------------------------------------------------------ */

export interface TemplateVersionRow {
  readonly id: string;
  readonly versionLabel: string;
  readonly locale: string;
  readonly state: string;
  readonly manifest: TemplateManifest | null;
  readonly validationError: string | null;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

export interface TemplateRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: TemplateKind;
  readonly purpose: string;
  readonly versions: ReadonlyArray<TemplateVersionRow>;
}

export async function listReportTemplates(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<TemplateRow>> {
  requireCapability(ctx, "reports.social_generator");
  // The same grant the Reports surface reads under: whoever may produce a deliverable may see
  // which templates exist and what each one would print.
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const templates = await tx
      .select()
      .from(templatesSchema.reportTemplate)
      .where(eq(templatesSchema.reportTemplate.projectId, projectId))
      .orderBy(templatesSchema.reportTemplate.code);

    const versions = await tx
      .select()
      .from(templatesSchema.reportTemplateVersion)
      .where(eq(templatesSchema.reportTemplateVersion.projectId, projectId))
      .orderBy(desc(templatesSchema.reportTemplateVersion.uploadedAt));

    return templates.map((template) => ({
      id: template.id,
      code: template.code,
      name: template.name,
      kind: template.kind as TemplateKind,
      purpose: template.purpose,
      versions: versions
        .filter((version) => version.templateId === template.id)
        .map((version) => ({
          id: version.id,
          versionLabel: version.versionLabel,
          locale: version.locale,
          state: version.state,
          manifest: parseManifest(version.manifest),
          validationError: version.validationError,
          sizeBytes: version.sizeBytes,
          uploadedAt: version.uploadedAt,
        })),
    }));
  });
}

export interface GeneratedDocumentRow {
  readonly id: string;
  readonly templateCode: string;
  readonly templateVersionLabel: string;
  readonly locale: string;
  readonly sizeBytes: number;
  readonly declaredAbsent: ReadonlyArray<string>;
  readonly snapshotDigest: string | null;
  readonly narrativeModel: string | null;
  readonly generatedAt: Date;
  readonly storedObjectId: string;
}

export async function listGeneratedDocuments(
  db: Database,
  ctx: RequestContext,
  limit = 50,
): Promise<ReadonlyArray<GeneratedDocumentRow>> {
  requireCapability(ctx, "reports.social_generator");
  // The same grant the Reports surface reads under: whoever may produce a deliverable may see
  // which templates exist and what each one would print.
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        id: templatesSchema.generatedDocument.id,
        templateCode: templatesSchema.reportTemplate.code,
        templateVersionLabel: templatesSchema.reportTemplateVersion.versionLabel,
        locale: templatesSchema.generatedDocument.locale,
        sizeBytes: templatesSchema.generatedDocument.sizeBytes,
        declaredAbsent: templatesSchema.generatedDocument.declaredAbsent,
        snapshotDigest: templatesSchema.generatedDocument.snapshotDigest,
        narrativeModel: templatesSchema.generatedDocument.narrativeModel,
        generatedAt: templatesSchema.generatedDocument.generatedAt,
        storedObjectId: templatesSchema.generatedDocument.storedObjectId,
      })
      .from(templatesSchema.generatedDocument)
      .innerJoin(
        templatesSchema.reportTemplateVersion,
        eq(
          templatesSchema.reportTemplateVersion.id,
          templatesSchema.generatedDocument.templateVersionId,
        ),
      )
      .innerJoin(
        templatesSchema.reportTemplate,
        eq(templatesSchema.reportTemplate.id, templatesSchema.reportTemplateVersion.templateId),
      )
      .where(eq(templatesSchema.generatedDocument.projectId, projectId))
      .orderBy(desc(templatesSchema.generatedDocument.generatedAt))
      .limit(limit);
    return rows;
  });
}

/* ---------------------------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------------------------ */

interface LoadedVersion {
  readonly id: string;
  readonly templateId: string;
  readonly templateCode: string;
  readonly versionLabel: string;
  readonly locale: TemplateLocale;
  readonly state: "UPLOADED" | "VALIDATED" | "ACTIVE" | "SUPERSEDED";
  readonly manifest: unknown;
  readonly objectKey: string;
}

async function loadVersion(tx: DbTx, projectId: string, versionId: string): Promise<LoadedVersion> {
  const [row] = await tx
    .select({
      id: templatesSchema.reportTemplateVersion.id,
      templateId: templatesSchema.reportTemplateVersion.templateId,
      templateCode: templatesSchema.reportTemplate.code,
      versionLabel: templatesSchema.reportTemplateVersion.versionLabel,
      locale: templatesSchema.reportTemplateVersion.locale,
      state: templatesSchema.reportTemplateVersion.state,
      manifest: templatesSchema.reportTemplateVersion.manifest,
      objectKey: storageSchema.storedObject.objectKey,
    })
    .from(templatesSchema.reportTemplateVersion)
    .innerJoin(
      templatesSchema.reportTemplate,
      eq(templatesSchema.reportTemplate.id, templatesSchema.reportTemplateVersion.templateId),
    )
    .innerJoin(
      storageSchema.storedObject,
      eq(storageSchema.storedObject.id, templatesSchema.reportTemplateVersion.storedObjectId),
    )
    .where(
      and(
        eq(templatesSchema.reportTemplateVersion.id, versionId),
        eq(templatesSchema.reportTemplateVersion.projectId, projectId),
      ),
    );
  if (!row) throw new NotFound("report template version");
  return row as LoadedVersion;
}

/** `v1`, `v2`, … per template **and locale**: the two languages version independently. */
async function nextVersionLabel(tx: DbTx, templateId: string, locale: string): Promise<string> {
  const result = await tx.execute(sql`
    select coalesce(max(substring(version_label from 2)::integer), 0) + 1 as next
      from app.report_template_version
     where template_id = ${templateId} and locale = ${locale}
  `);
  const next = Number((result.rows[0] as { next: number } | undefined)?.next ?? 1);
  return `v${next}`;
}

function parseManifest(raw: unknown): TemplateManifest | null {
  if (raw === null || raw === undefined) return null;
  const parsed = templateManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function readSnapshotDigest(
  tx: DbTx,
  projectId: string,
  reportVersionId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ snapshot: reportsSchema.reportVersion.snapshot })
    .from(reportsSchema.reportVersion)
    .where(
      and(
        eq(reportsSchema.reportVersion.id, reportVersionId),
        eq(reportsSchema.reportVersion.projectId, projectId),
      ),
    );
  if (!row) throw new NotFound("report version");
  // The digest of the snapshot's own bytes: the id says which version, this says which bytes of
  // it, and the two together make "reproduce this document" a question with an answer.
  return createHash("sha256").update(JSON.stringify(row.snapshot)).digest("hex");
}

/**
 * Provenance for a template version and for a generated document.
 *
 * A delivered template is `IMPORTED_DOCUMENT` + `ORIGINAL` — it is the firm's own file, observed as
 * it arrived. A generated document is `SYSTEM_GENERATED` + `DERIVED`, produced by operating this
 * product today over validated data, and `SPECIALIST_REQUIRED` because it is a draft nobody has
 * approved (there is no approval workflow here, TD-060).
 */
async function createTemplateProvenance(
  tx: DbTx,
  ctx: { tenantId: string },
  projectId: string,
  input: { title: string; note: string },
): Promise<string> {
  const id = randomUUID();
  const generated = input.title.startsWith("Documento generado");
  await tx.execute(sql`
    insert into app.provenance_record
      (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
       method, validation_state, captured_at)
    values (${id}, ${ctx.tenantId}, ${projectId},
            ${generated ? "LIVE_OPERATIONAL" : "HISTORICAL_OBSERVED"},
            ${generated ? "SYSTEM_GENERATED" : "IMPORTED_DOCUMENT"},
            ARRAY[${generated ? "DERIVED" : "ORIGINAL"}]::app.provenance_transformation[],
            'AGGREGATE', ${input.title}, ${input.note}, NULL,
            ${generated ? "SPECIALIST_REQUIRED" : "NOT_REQUIRED"}, now())
  `);
  return id;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new InvalidInput("this action needs a project context");
  return ctx.projectId;
}

/**
 * A link to one generated document's bytes (ADR-036, the shape ADR-034 established).
 *
 * The same three properties the delivered-file download has: the caller names the **generated
 * document**, not a storage row; the row is read under their own RLS first; and the issuance is
 * audited, because a generated draft carries a client's figures and a presigned URL is a bearer
 * credential for five minutes.
 */
export interface GeneratedDocumentLink {
  readonly url: string;
  readonly expiresAt: string;
  readonly filename: string;
  readonly sizeBytes: number;
}

export async function issueGeneratedDocumentDownload(
  db: Database,
  ctx: RequestContext,
  storage: StoragePort,
  generatedDocumentId: string,
): Promise<GeneratedDocumentLink> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);

  const row = await withDbContext(db, ctx, async (tx) => {
    const [found] = await tx
      .select({
        id: templatesSchema.generatedDocument.id,
        locale: templatesSchema.generatedDocument.locale,
        sizeBytes: templatesSchema.generatedDocument.sizeBytes,
        objectKey: storageSchema.storedObject.objectKey,
        namespace: storageSchema.storedObject.namespace,
        filename: storageSchema.storedObject.originalFilename,
        templateCode: templatesSchema.reportTemplate.code,
        templateVersionLabel: templatesSchema.reportTemplateVersion.versionLabel,
      })
      .from(templatesSchema.generatedDocument)
      .innerJoin(
        storageSchema.storedObject,
        eq(storageSchema.storedObject.id, templatesSchema.generatedDocument.storedObjectId),
      )
      .innerJoin(
        templatesSchema.reportTemplateVersion,
        eq(
          templatesSchema.reportTemplateVersion.id,
          templatesSchema.generatedDocument.templateVersionId,
        ),
      )
      .innerJoin(
        templatesSchema.reportTemplate,
        eq(templatesSchema.reportTemplate.id, templatesSchema.reportTemplateVersion.templateId),
      )
      .where(
        and(
          eq(templatesSchema.generatedDocument.id, generatedDocumentId),
          eq(templatesSchema.generatedDocument.projectId, projectId),
        ),
      );
    if (!found) throw new NotFound("generated document");
    // A row written by an older, wider version could not point outside this namespace, and the
    // check says so rather than leaving it to be inferred.
    if (found.namespace !== "generated") throw new NotFound("generated document");

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
      {
        action: "templates.document.download_issued",
        objectKind: "generated_document",
        objectId: generatedDocumentId,
        details: {
          template: found.templateCode,
          templateVersion: found.templateVersionLabel,
          locale: found.locale,
        },
      },
    );
    return found;
  });

  const link = await storage.presignDownload(
    row.objectKey,
    DOWNLOAD_LINK_TTL_SECONDS,
    row.filename,
  );
  return {
    url: link.url,
    expiresAt: link.expiresAt.toISOString(),
    filename: row.filename,
    sizeBytes: row.sizeBytes,
  };
}
