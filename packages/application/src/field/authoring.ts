import { randomUUID } from "node:crypto";

import { appSchema, fieldSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  assertAuthoredDraftSavable,
  assertAuthoredVersionPublishable,
  authoredDefinitionSchema,
  CANONICAL_SURVEY_LOCALE,
  declaredLocales,
  InvalidInput,
  NotFound,
  nextSurveyVersionLabel,
  requireCapability,
  requirePermission,
  surveyTemplateKeySchema,
  surveyVersionHash,
  toSurveyQuestionDefinitions,
  type AuthoredDefinition,
  type AuthoredQuestion,
  type RequestContext,
  type SurveyLocale,
} from "@eia/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";

/**
 * Writing a questionnaire, inside the product, as part of preparing a project (ADR-037).
 *
 * Until this module existed a `SurveyVersion` could only be created by the demonstration seeder,
 * which made every one of eight studies a developer task. That is the blocker this removes, and
 * the shape it removes it in is deliberately small:
 *
 * - **a draft is a document.** `saveSurveyDraft` replaces the whole definition of a `DRAFT`
 *   version, because a questionnaire being written is one thing a person is editing, not a
 *   sequence of row mutations somebody has to keep consistent;
 * - **publication is the only irreversible act**, and it is a different permission from writing;
 * - **there is no edit after publication.** `createSurveyDraft` with `copyFromVersionId` is how a
 *   published questionnaire is "changed": the copy becomes the next version and the answers
 *   already given keep pointing at the definition they were given.
 *
 * Nothing here reads a survey answer, and nothing here can: this module touches the definition
 * tables only, and the person allowed to write one holds no `field.responses.read`.
 */

/** A query string is not a uuid. Postgres would answer a syntax error; the surface answers null. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new InvalidInput("this action needs a project context");
  return ctx.projectId;
}

/* ---------------------------------------------------------------------------------------------
 * read model
 * ------------------------------------------------------------------------------------------ */

export interface AuthoringVersionSummary {
  readonly id: string;
  readonly versionLabel: string;
  readonly status: string;
  readonly questionCount: number;
  /** Languages the definition actually carries, canonical first (ADR-029). */
  readonly locales: ReadonlyArray<string>;
  readonly publishedAt: string | null;
  /**
   * Whether a campaign already resolves answers against this version. A published version is
   * frozen either way; this is what the surface says to somebody wondering why.
   */
  readonly usedByCampaign: boolean;
}

export interface AuthoringTemplateSummary {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly versions: ReadonlyArray<AuthoringVersionSummary>;
}

export interface AuthoringSelection {
  readonly versionId: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly versionLabel: string;
  readonly status: string;
  readonly definition: AuthoredDefinition;
}

export interface SurveyAuthoringView {
  readonly templates: ReadonlyArray<AuthoringTemplateSummary>;
  /** The definition being edited or previewed, when the caller named one that exists. */
  readonly selected: AuthoringSelection | null;
  readonly canAuthor: boolean;
  readonly canPublish: boolean;
}

/**
 * Every questionnaire of this project, and one definition in full.
 *
 * Read in one transaction for the reason the intake read model gives: a list of versions taken at
 * one instant and a definition taken at another would describe a project that never existed.
 */
export async function loadSurveyAuthoring(
  db: Database,
  ctx: RequestContext,
  selectedVersionId?: string | null,
): Promise<SurveyAuthoringView> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "project.intake.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const templates = await tx
      .select({
        id: fieldSchema.surveyTemplate.id,
        key: fieldSchema.surveyTemplate.key,
        name: fieldSchema.surveyTemplate.name,
        description: fieldSchema.surveyTemplate.description,
      })
      .from(fieldSchema.surveyTemplate)
      .where(eq(fieldSchema.surveyTemplate.projectId, projectId))
      .orderBy(asc(fieldSchema.surveyTemplate.name));

    const versions = await tx.execute<{
      id: string;
      template_id: string;
      version_label: string;
      status: string;
      question_count: number;
      locales: string[] | null;
      published_at: Date | null;
      used_by_campaign: boolean;
    }>(sql`
      select v.id, v.template_id, v.version_label, v.status::text as status,
             (select count(*)::int from app.survey_question q where q.version_id = v.id)
               as question_count,
             (select array_agg(distinct tr.locale order by tr.locale)
                from app.survey_question_translation tr
                join app.survey_question q on q.id = tr.question_id
               where q.version_id = v.id) as locales,
             v.published_at,
             exists (select 1 from app.survey_campaign c where c.survey_version_id = v.id)
               as used_by_campaign
        from app.survey_version v
       where v.project_id = ${projectId}
       order by v.template_id, v.version_label
    `);

    const byTemplate = new Map<string, AuthoringVersionSummary[]>();
    for (const row of versions.rows) {
      const list = byTemplate.get(row.template_id) ?? [];
      list.push({
        id: row.id,
        versionLabel: row.version_label,
        status: row.status,
        questionCount: row.question_count,
        locales: [CANONICAL_SURVEY_LOCALE, ...(row.locales ?? [])],
        publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
        usedByCampaign: row.used_by_campaign,
      });
      byTemplate.set(row.template_id, list);
    }

    let selected: AuthoringSelection | null = null;
    if (selectedVersionId && UUID_SHAPE.test(selectedVersionId)) {
      const [version] = await tx
        .select({
          id: fieldSchema.surveyVersion.id,
          templateId: fieldSchema.surveyVersion.templateId,
          versionLabel: fieldSchema.surveyVersion.versionLabel,
          status: fieldSchema.surveyVersion.status,
        })
        .from(fieldSchema.surveyVersion)
        .where(
          and(
            eq(fieldSchema.surveyVersion.id, selectedVersionId),
            eq(fieldSchema.surveyVersion.projectId, projectId),
          ),
        );
      if (version) {
        const template = templates.find((entry) => entry.id === version.templateId);
        selected = {
          versionId: version.id,
          templateId: version.templateId,
          templateName: template?.name ?? "",
          versionLabel: version.versionLabel,
          status: version.status,
          definition: await readDefinition(tx, ctx, version.id),
        };
      }
    }

    return {
      templates: templates.map((template) => ({
        id: template.id,
        key: template.key,
        name: template.name,
        description: template.description,
        versions: byTemplate.get(template.id) ?? [],
      })),
      selected,
      canAuthor: ctx.permissions.has("field.instruments.author"),
      canPublish: ctx.permissions.has("field.instruments.publish"),
    };
  });
}

/**
 * One version's definition, in the shape the authoring surface edits and the preview renders.
 *
 * The same rows the field pack and the phone read, assembled the same way — which is what makes
 * *what the author sees* and *what the technician is asked* one thing rather than two.
 */
async function readDefinition(
  tx: DbTx,
  ctx: RequestContext,
  versionId: string,
): Promise<AuthoredDefinition> {
  const questionRows = await tx.execute<{
    id: string;
    code: string;
    ordinal: number;
    type: string;
    prompt: string;
    help_text: string | null;
    required: boolean;
    sensitivity: string;
    section: string | null;
  }>(sql`
    select id, code, ordinal, type::text as type, prompt, help_text, required,
           sensitivity::text as sensitivity, section
      from app.survey_question
     where tenant_id = ${ctx.tenantId} and version_id = ${versionId}
     order by ordinal
  `);

  const optionRows = await tx.execute<{
    id: string;
    question_id: string;
    code: string;
    label: string;
    ordinal: number;
  }>(sql`
    select o.id, o.question_id, o.code, o.label, o.ordinal
      from app.survey_option o
      join app.survey_question q on q.tenant_id = o.tenant_id and q.id = o.question_id
     where o.tenant_id = ${ctx.tenantId} and q.version_id = ${versionId}
     order by o.ordinal
  `);

  const questionTranslations = await tx.execute<{
    question_id: string;
    locale: string;
    prompt: string;
    help_text: string | null;
    section: string | null;
  }>(sql`
    select tr.question_id, tr.locale, tr.prompt, tr.help_text, tr.section
      from app.survey_question_translation tr
      join app.survey_question q on q.tenant_id = tr.tenant_id and q.id = tr.question_id
     where tr.tenant_id = ${ctx.tenantId} and q.version_id = ${versionId}
  `);

  const optionTranslations = await tx.execute<{
    option_id: string;
    locale: string;
    label: string;
  }>(sql`
    select tr.option_id, tr.locale, tr.label
      from app.survey_option_translation tr
      join app.survey_option o on o.tenant_id = tr.tenant_id and o.id = tr.option_id
      join app.survey_question q on q.tenant_id = o.tenant_id and q.id = o.question_id
     where tr.tenant_id = ${ctx.tenantId} and q.version_id = ${versionId}
  `);

  const optionTranslationsById = new Map<string, Record<string, string>>();
  for (const row of optionTranslations.rows) {
    const entry = optionTranslationsById.get(row.option_id) ?? {};
    entry[row.locale] = row.label;
    optionTranslationsById.set(row.option_id, entry);
  }
  const questionTranslationsById = new Map<
    string,
    Record<string, { prompt: string; helpText: string | null; section: string | null }>
  >();
  for (const row of questionTranslations.rows) {
    const entry = questionTranslationsById.get(row.question_id) ?? {};
    entry[row.locale] = { prompt: row.prompt, helpText: row.help_text, section: row.section };
    questionTranslationsById.set(row.question_id, entry);
  }

  return {
    questions: questionRows.rows.map((question) => ({
      code: question.code,
      ordinal: question.ordinal,
      type: question.type as AuthoredQuestion["type"],
      prompt: question.prompt,
      helpText: question.help_text,
      required: question.required,
      sensitivity: question.sensitivity as AuthoredQuestion["sensitivity"],
      section: question.section,
      options: optionRows.rows
        .filter((option) => option.question_id === question.id)
        .map((option) => ({
          code: option.code,
          label: option.label,
          ordinal: option.ordinal,
          translations: optionTranslationsById.get(option.id) ?? {},
        })),
      translations: questionTranslationsById.get(question.id) ?? {},
    })),
  };
}

/* ---------------------------------------------------------------------------------------------
 * writing
 * ------------------------------------------------------------------------------------------ */

export const createSurveyTemplateInputSchema = z
  .object({
    key: surveyTemplateKeySchema,
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(600).nullable(),
  })
  .strict();
export type CreateSurveyTemplateInput = z.infer<typeof createSurveyTemplateInputSchema>;

/**
 * Register a questionnaire, and open its first draft.
 *
 * One act rather than two: a template with no version is a name with nothing behind it, and the
 * next thing anybody would do with it is the only thing they could do with it.
 */
export async function createSurveyTemplate(
  db: Database,
  ctx: RequestContext,
  raw: CreateSurveyTemplateInput,
): Promise<{ templateId: string; versionId: string; versionLabel: string }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.instruments.author");
  const projectId = requireProject(ctx);
  const input = createSurveyTemplateInputSchema.parse(raw);

  return withDbContext(db, ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: fieldSchema.surveyTemplate.id })
      .from(fieldSchema.surveyTemplate)
      .where(
        and(
          eq(fieldSchema.surveyTemplate.projectId, projectId),
          eq(fieldSchema.surveyTemplate.key, input.key),
        ),
      );
    if (existing) {
      throw new InvalidInput(
        `this project already has a questionnaire "${input.key}". Add a version to it rather ` +
          "than registering a second questionnaire under the same key.",
      );
    }

    const templateId = randomUUID();
    await tx.insert(fieldSchema.surveyTemplate).values({
      id: templateId,
      tenantId: ctx.tenantId,
      projectId,
      key: input.key,
      name: input.name,
      description: input.description,
    });

    const version = await openDraft(tx, ctx, { projectId, templateId, existingLabels: [] });
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.survey.drafted",
        objectKind: "survey_version",
        objectId: version.versionId,
        details: { templateKey: input.key, versionLabel: version.versionLabel, copied: false },
      },
    );
    return { templateId, ...version };
  });
}

export const createSurveyDraftInputSchema = z
  .object({
    templateId: z.uuid(),
    /** Start from an existing version's questions. This is how a published one is "edited". */
    copyFromVersionId: z.uuid().nullable(),
  })
  .strict();
export type CreateSurveyDraftInput = z.infer<typeof createSurveyDraftInputSchema>;

export async function createSurveyDraft(
  db: Database,
  ctx: RequestContext,
  raw: CreateSurveyDraftInput,
): Promise<{ versionId: string; versionLabel: string }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.instruments.author");
  const projectId = requireProject(ctx);
  const input = createSurveyDraftInputSchema.parse(raw);

  return withDbContext(db, ctx, async (tx) => {
    const [template] = await tx
      .select({ id: fieldSchema.surveyTemplate.id, key: fieldSchema.surveyTemplate.key })
      .from(fieldSchema.surveyTemplate)
      .where(
        and(
          eq(fieldSchema.surveyTemplate.id, input.templateId),
          eq(fieldSchema.surveyTemplate.projectId, projectId),
        ),
      );
    if (!template) throw new NotFound("survey template");

    const existing = await tx
      .select({
        label: fieldSchema.surveyVersion.versionLabel,
        status: fieldSchema.surveyVersion.status,
      })
      .from(fieldSchema.surveyVersion)
      .where(eq(fieldSchema.surveyVersion.templateId, input.templateId));

    if (existing.some((row) => row.status === "DRAFT")) {
      throw new InvalidInput(
        "this questionnaire already has a draft. Finish or publish it before opening another, " +
          "so there is one answer to the question of what is being written.",
      );
    }

    /*
     * The source must be a version *of this questionnaire*. RLS already confines the read to this
     * tenant and project, but copying questionnaire A's questions into questionnaire B's v3 would
     * be a silently different act from the one the surface offers.
     */
    let source: AuthoredDefinition | null = null;
    if (input.copyFromVersionId) {
      const [origin] = await tx
        .select({ id: fieldSchema.surveyVersion.id })
        .from(fieldSchema.surveyVersion)
        .where(
          and(
            eq(fieldSchema.surveyVersion.id, input.copyFromVersionId),
            eq(fieldSchema.surveyVersion.templateId, input.templateId),
            eq(fieldSchema.surveyVersion.projectId, projectId),
          ),
        );
      if (!origin) throw new NotFound("survey version");
      source = await readDefinition(tx, ctx, input.copyFromVersionId);
    }

    const version = await openDraft(tx, ctx, {
      projectId,
      templateId: input.templateId,
      existingLabels: existing.map((row) => row.label),
    });
    if (source) {
      await writeDefinition(tx, ctx, { projectId, versionId: version.versionId }, source);
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.survey.drafted",
        objectKind: "survey_version",
        objectId: version.versionId,
        details: {
          templateKey: template.key,
          versionLabel: version.versionLabel,
          copied: source !== null,
          questionCount: source?.questions.length ?? 0,
        },
      },
    );
    return version;
  });
}

export const saveSurveyDefinitionInputSchema = z
  .object({ versionId: z.uuid(), definition: authoredDefinitionSchema })
  .strict();
export type SaveSurveyDefinitionInput = z.infer<typeof saveSurveyDefinitionInputSchema>;

/**
 * Replace a draft's definition with what the author wrote.
 *
 * The whole definition, in one transaction, because that is what was edited. A partial save would
 * leave a questionnaire that is half of two different forms, and the person who then published it
 * would be publishing something nobody wrote.
 *
 * The version's `DRAFT` status is re-read here and enforced again by trigger underneath. Two
 * layers, one failure still safe — and the trigger is the one that matters, because it is also
 * what stops a repository call nobody has written yet.
 */
export async function saveSurveyDefinition(
  db: Database,
  ctx: RequestContext,
  raw: SaveSurveyDefinitionInput,
): Promise<{ questionCount: number; locales: ReadonlyArray<SurveyLocale> }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.instruments.author");
  const projectId = requireProject(ctx);
  const input = saveSurveyDefinitionInputSchema.parse(raw);
  assertAuthoredDraftSavable(input.definition);

  return withDbContext(db, ctx, async (tx) => {
    const version = await loadDraft(tx, projectId, input.versionId);
    await writeDefinition(
      tx,
      ctx,
      { projectId, versionId: version.id },
      input.definition,
      /* replacing */ true,
    );
    return {
      questionCount: input.definition.questions.length,
      locales: declaredLocales(input.definition),
    };
  });
}

export const publishSurveyVersionInputSchema = z.object({ versionId: z.uuid() }).strict();
export type PublishSurveyVersionInput = z.infer<typeof publishSurveyVersionInputSchema>;

/**
 * Decide that households may be asked this.
 *
 * Validated **before** the status moves, because after it the definition cannot be corrected: the
 * trigger refuses every change, and a version published with two questions sharing a code would
 * have to be retired and rewritten rather than fixed.
 */
export async function publishSurveyVersion(
  db: Database,
  ctx: RequestContext,
  raw: PublishSurveyVersionInput,
): Promise<{ versionId: string; versionLabel: string; definitionHash: string }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.instruments.publish");
  const projectId = requireProject(ctx);
  const input = publishSurveyVersionInputSchema.parse(raw);

  return withDbContext(db, ctx, async (tx) => {
    const version = await loadDraft(tx, projectId, input.versionId);
    const definition = await readDefinition(tx, ctx, version.id);
    assertAuthoredVersionPublishable(definition);

    const definitionHash = surveyVersionHash(toSurveyQuestionDefinitions(definition));
    const publishedAt = new Date();
    await tx
      .update(fieldSchema.surveyVersion)
      .set({
        status: "PUBLISHED",
        publishedAt,
        publishedByUserId: ctx.userId,
        definitionHash,
      })
      .where(eq(fieldSchema.surveyVersion.id, version.id));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.survey.published",
        objectKind: "survey_version",
        objectId: version.id,
        details: {
          versionLabel: version.versionLabel,
          questionCount: definition.questions.length,
          definitionHash,
          locales: declaredLocales(definition).join(" "),
        },
      },
    );

    return { versionId: version.id, versionLabel: version.versionLabel, definitionHash };
  });
}

/* ---------------------------------------------------------------------------------------------
 * shared internals
 * ------------------------------------------------------------------------------------------ */

async function loadDraft(
  tx: DbTx,
  projectId: string,
  versionId: string,
): Promise<{ id: string; versionLabel: string }> {
  const [version] = await tx
    .select({
      id: fieldSchema.surveyVersion.id,
      versionLabel: fieldSchema.surveyVersion.versionLabel,
      status: fieldSchema.surveyVersion.status,
    })
    .from(fieldSchema.surveyVersion)
    .where(
      and(
        eq(fieldSchema.surveyVersion.id, versionId),
        eq(fieldSchema.surveyVersion.projectId, projectId),
      ),
    );
  if (!version) throw new NotFound("survey version");
  if (version.status !== "DRAFT") {
    throw new InvalidInput(
      `version ${version.versionLabel} is ${version.status.toLowerCase()} and cannot be edited. ` +
        "Copy it into a new draft, so the answers already given keep the questionnaire they " +
        "were given.",
    );
  }
  return { id: version.id, versionLabel: version.versionLabel };
}

async function openDraft(
  tx: DbTx,
  ctx: RequestContext,
  input: {
    readonly projectId: string;
    readonly templateId: string;
    readonly existingLabels: ReadonlyArray<string>;
  },
): Promise<{ versionId: string; versionLabel: string }> {
  const provenanceId = randomUUID();
  await tx.insert(appSchema.provenanceRecord).values({
    id: provenanceId,
    tenantId: ctx.tenantId,
    projectId: input.projectId,
    // The instrument is this firm's own working document, written in this product by a named
    // person. `SYSTEM_GENERATED` says it was produced here rather than imported; the method text
    // says by whom, in words, because that is the fact somebody reading the drawer wants.
    regime: "LIVE_OPERATIONAL",
    origin: "SYSTEM_GENERATED",
    transformations: ["ORIGINAL"],
    granularity: "AGGREGATE",
    title: "Cuestionario redactado en Preparar proyecto",
    note: "La definición del instrumento, escrita dentro del producto. No contiene respuestas.",
    method: "Redacción manual del cuestionario en la etapa Formularios de Preparar proyecto.",
    capturedAt: new Date(),
    validationState: "PENDING",
  });

  const versionId = randomUUID();
  const versionLabel = nextSurveyVersionLabel(input.existingLabels);
  await tx.insert(fieldSchema.surveyVersion).values({
    id: versionId,
    tenantId: ctx.tenantId,
    projectId: input.projectId,
    templateId: input.templateId,
    versionLabel,
    status: "DRAFT",
    provenanceId,
  });
  return { versionId, versionLabel };
}

/**
 * Write a definition into a draft, optionally clearing what was there.
 *
 * Delete-then-insert rather than a diff. A diff would have to decide what "the same question"
 * means across an edit, and the only honest answer is its code — which is precisely what an author
 * may be changing. Deleting is safe here and nowhere else: this runs only on a `DRAFT`, which by
 * construction has no answers, and the trigger refuses it on anything else.
 */
async function writeDefinition(
  tx: DbTx,
  ctx: RequestContext,
  scope: { readonly projectId: string; readonly versionId: string },
  definition: AuthoredDefinition,
  replacing = false,
): Promise<void> {
  if (replacing) {
    await tx.execute(sql`
      delete from app.survey_question
       where tenant_id = ${ctx.tenantId} and version_id = ${scope.versionId}
    `);
  }

  for (const question of definition.questions) {
    const questionId = randomUUID();
    await tx.insert(fieldSchema.surveyQuestion).values({
      id: questionId,
      tenantId: ctx.tenantId,
      projectId: scope.projectId,
      versionId: scope.versionId,
      code: question.code,
      ordinal: question.ordinal,
      type: question.type,
      prompt: question.prompt,
      helpText: question.helpText,
      required: question.required,
      sensitivity: question.sensitivity,
      section: question.section,
    });

    for (const [locale, words] of Object.entries(question.translations)) {
      await tx.insert(fieldSchema.surveyQuestionTranslation).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId: scope.projectId,
        questionId,
        locale,
        prompt: words.prompt,
        helpText: words.helpText,
        section: words.section,
      });
    }

    for (const option of question.options) {
      const optionId = randomUUID();
      await tx.insert(fieldSchema.surveyOption).values({
        id: optionId,
        tenantId: ctx.tenantId,
        projectId: scope.projectId,
        questionId,
        code: option.code,
        label: option.label,
        ordinal: option.ordinal,
      });
      for (const [locale, label] of Object.entries(option.translations)) {
        await tx.insert(fieldSchema.surveyOptionTranslation).values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          projectId: scope.projectId,
          optionId,
          locale,
          label,
        });
      }
    }
  }
}
