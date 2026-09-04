import { reportsSchema, type Database, type DbTx } from "@eia/db";
import {
  applyNarratives,
  assertSnapshotHonest,
  nextReportVersionLabel,
  NotFound,
  REPORT_PROMPT_VERSION,
  requireCapability,
  requirePermission,
  snapshotDigest,
  type ClassifierAvailability,
  type NarrativeGenerator,
  type ReportSnapshot,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "../field/context";
import { buildSocialSnapshot } from "./snapshot";

/**
 * Producing one version of the social chapter.
 *
 * The order is the argument of ADR-022. **Compute first**: the snapshot is built from validated
 * data, checked for honesty, and is a complete report on its own. Only then, and only if a
 * generator is configured, is prose asked for — from the snapshot, never from the database — and
 * every paragraph is refused if it states a figure the section did not compute.
 *
 * A version is written once. Regenerating produces a new one; the previous keeps exactly what it
 * said, because a study's chapter three is a thing that was produced on a date.
 */
export interface GeneratedReportVersion {
  readonly reportId: string;
  readonly versionId: string;
  readonly versionLabel: string;
  readonly digest: string;
  /** True when the inputs produced the same chapter as the previous version. */
  readonly unchangedFromPrevious: boolean;
  readonly narrativeSections: number;
}

export interface ReportGeneratorConfig {
  /** Resolved once at the boundary (IG4-001). `UNAVAILABLE` yields a version with no prose. */
  readonly narrative: ClassifierAvailability;
  readonly create?: () => NarrativeGenerator;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

export async function generateSocialChapter(
  db: Database,
  ctx: RequestContext,
  input: { readonly surveyVersionId: string },
  config: ReportGeneratorConfig,
): Promise<GeneratedReportVersion> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  // The chapter counts validated codings of individual responses, so the caller must be someone who
  // may read those responses. Reusing the boundary rather than minting a parallel one, exactly as
  // Social Intelligence does (TENANCY.md §3.2).
  requirePermission(ctx, "field.responses.read");
  const projectId = requireProject(ctx);

  // `withFieldContext` because the snapshot counts response rows, whose policies ask whether this
  // caller may see rows that are not their own.
  return withFieldContext(db, ctx, async (tx) => {
    const snapshot = await buildSocialSnapshot(tx, {
      tenantId: ctx.tenantId,
      projectId,
      surveyVersionId: input.surveyVersionId,
    });
    assertSnapshotHonest(snapshot);
    const digest = snapshotDigest(snapshot);

    const reportId = await ensureReport(tx, ctx.tenantId, projectId, snapshot.projectName);
    const previous = await tx.execute(sql`
      select version_label, snapshot_digest from app.report_version
       where tenant_id = ${ctx.tenantId} and report_id = ${reportId}
       order by generated_at desc
    `);
    const rows = previous.rows as Array<{ version_label: string; snapshot_digest: string }>;
    const unchanged = rows[0]?.snapshot_digest === digest;
    const versionLabel = nextReportVersionLabel(rows.map((row) => row.version_label));

    // Prose, only if a generator may run. The snapshot is identical either way, which is the
    // property that makes the narrative optional rather than essential.
    let narratives: ReadonlyMap<string, string> = new Map();
    let model: string | null = null;
    if (config.narrative.state === "AVAILABLE" && config.create) {
      const generator = config.create();
      const raw = await generator.generate({ snapshot, model: config.narrative.model });
      narratives = applyNarratives(snapshot, raw);
      model = config.narrative.model;
    }

    const provenanceId = await createReportProvenance(tx, ctx.tenantId, projectId, {
      title: `Capítulo social · ${versionLabel}`,
      note:
        "Borrador generado a partir de datos validados: tabulación determinista, codificaciones " +
        "validadas por especialista, hallazgos de calidad decididos y documentos citados. No es " +
        "un entregable aprobado.",
      method: model
        ? `Instantánea determinista + redacción ${model} · prompt ${REPORT_PROMPT_VERSION}`
        : "Instantánea determinista; sin redacción asistida",
    });

    const versionId = randomUUID();
    await tx.insert(reportsSchema.reportVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      projectId,
      reportId,
      versionLabel,
      status: "DRAFT",
      snapshot,
      snapshotDigest: digest,
      surveyVersionLabel: snapshot.surveyVersionLabel,
      narrativeModel: model,
      narrativePromptVersion: model ? REPORT_PROMPT_VERSION : null,
      generatedByUserId: ctx.userId,
      provenanceId,
    });

    for (const section of snapshot.sections) {
      const sectionId = randomUUID();
      await tx.insert(reportsSchema.reportSection).values({
        id: sectionId,
        tenantId: ctx.tenantId,
        projectId,
        versionId,
        key: section.key,
        title: section.title,
        ordinal: section.ordinal,
        summary: section.summary,
        narrative: narratives.get(section.key) ?? null,
      });
      let ordinal = 0;
      for (const fact of section.facts) {
        await tx.insert(reportsSchema.reportSectionSource).values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          projectId,
          sectionId,
          kind: fact.source.kind,
          factKey: fact.key,
          locator: fact.source,
          ordinal: ordinal++,
        });
      }
    }

    await tx.execute(sql`
      update app.generated_report set current_version_id = ${versionId}
       where tenant_id = ${ctx.tenantId} and id = ${reportId}
    `);

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "reports.version.generated",
        objectKind: "report_version",
        objectId: versionId,
        details: {
          versionLabel,
          sections: snapshot.sections.length,
          facts: snapshot.sections.reduce((sum, s) => sum + s.facts.length, 0),
          narrative: model ?? "none",
          unchangedFromPrevious: unchanged,
        },
      },
    );

    return {
      reportId,
      versionId,
      versionLabel,
      digest,
      unchangedFromPrevious: unchanged,
      narrativeSections: narratives.size,
    };
  });
}

async function ensureReport(
  tx: DbTx,
  tenantId: string,
  projectId: string,
  projectName: string,
): Promise<string> {
  const existing = await tx.execute(sql`
    select id from app.generated_report
     where tenant_id = ${tenantId} and project_id = ${projectId} and kind = 'social_chapter'
     for update
  `);
  const found = existing.rows[0] as { id: string } | undefined;
  if (found) return found.id;

  const id = randomUUID();
  await tx.insert(reportsSchema.generatedReport).values({
    id,
    tenantId,
    projectId,
    kind: "social_chapter",
    title: `Capítulo social — ${projectName}`,
  });
  return id;
}

/**
 * A report's provenance.
 *
 * `DERIVED` and `PENDING`: it is computed from other records and nobody has approved it. A chapter
 * that recorded itself as validated would be claiming the one thing this slice deliberately does
 * not do (AI_GOVERNANCE.md §8, TD-060).
 */
async function createReportProvenance(
  tx: DbTx,
  tenantId: string,
  projectId: string,
  input: { title: string; note: string; method: string },
): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    insert into app.provenance_record
      (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
       method, validation_state, captured_at)
    values (${id}, ${tenantId}, ${projectId}, 'DEMO_SIMULATION', 'SYSTEM_GENERATED',
            ARRAY['DERIVED']::app.provenance_transformation[], 'AGGREGATE', ${input.title},
            ${input.note}, ${input.method}, 'PENDING', now())
  `);
  return id;
}

/** Re-exported so the web layer and the tests share one shape. */
export type { ReportSnapshot };
