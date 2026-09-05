import { pgasSchema, type DbTx } from "@eia/db";
import { measureCode, pgasChapterSchema, placeFromObjective, type PgasChapter } from "@eia/domain";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

/**
 * Import one delivery of the management plan chapter (ADR-024 §4).
 *
 * **An importer for this document family, not for any PGAS.** It validates the shape it expects
 * before it writes anything, and refuses rather than guessing — a chapter with seven columns, or
 * with a header this product does not recognise, is a delivery someone must look at, not a smaller
 * plan to store quietly.
 *
 * Idempotent by the source file's hash. Re-running with the same document does nothing at all; a
 * different document becomes a new run whose plans supersede the previous run's, which stay
 * queryable so a figure quoted from the old plan is still explainable.
 */
export interface PgasImportResult {
  readonly runId: string | null;
  readonly plans: number;
  readonly measures: number;
  readonly supersededRunId: string | null;
  /** True when the same document was already imported and nothing was written. */
  readonly unchanged: boolean;
}

export async function importPgasChapter(
  tx: DbTx,
  input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly provenanceId: string;
    readonly importedAt: Date;
    readonly chapter: unknown;
  },
): Promise<PgasImportResult> {
  const chapter: PgasChapter = pgasChapterSchema.parse(input.chapter);

  const existing = await tx.execute(sql`
    select id, source_sha256 from app.pgas_import_run
     where tenant_id = ${input.tenantId} and project_id = ${input.projectId} and is_active
     limit 1
  `);
  const active = existing.rows[0] as { id: string; source_sha256: string } | undefined;
  if (active?.source_sha256 === chapter.source.sha256) {
    return {
      runId: active.id,
      plans: 0,
      measures: 0,
      supersededRunId: null,
      unchanged: true,
    };
  }

  if (active) {
    // The previous run steps down in the same transaction as the new one steps up: the partial
    // unique index allows exactly one active run, and a half-finished import must not leave two.
    await tx.execute(sql`
      update app.pgas_import_run set is_active = false
       where tenant_id = ${input.tenantId} and id = ${active.id}
    `);
  }

  const runId = randomUUID();
  const measureTotal = chapter.plans.reduce((sum, plan) => sum + plan.measures.length, 0);
  await tx.insert(pgasSchema.pgasImportRun).values({
    id: runId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    sourceFile: chapter.source.file,
    sourceSha256: chapter.source.sha256,
    planCount: chapter.plans.length,
    measureCount: measureTotal,
    importedAt: input.importedAt,
    isActive: true,
    supersedesRunId: active?.id ?? null,
    provenanceId: input.provenanceId,
  });

  for (const [planIndex, plan] of chapter.plans.entries()) {
    const planId = randomUUID();
    await tx.insert(pgasSchema.pgasPlan).values({
      id: planId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      importRunId: runId,
      ordinal: planIndex + 1,
      code: plan.code,
      title: plan.title,
      objective: plan.objective,
      /*
       * The chapter states the place of application two ways: its own field in two plans, and
       * inside the objective paragraph in the other seven. Both are read; the objective is stored
       * whole either way, so nothing the document says is lost or moved.
       */
      place: plan.place ?? placeFromObjective(plan.objective),
      columnHeadings: [...plan.columns],
    });

    for (const [measureIndex, measure] of plan.measures.entries()) {
      await tx.insert(pgasSchema.pgasMeasure).values({
        id: randomUUID(),
        tenantId: input.tenantId,
        projectId: input.projectId,
        planId,
        ordinal: measureIndex + 1,
        measureCode: measureCode({
          planCode: plan.code,
          planTitle: plan.title,
          programmeOrdinal: measure.programmeOrdinal,
          ordinal: measureIndex + 1,
        }),
        // Stored as the document writes it, repeats and blanks included.
        statedNumber: measure.statedNumber,
        programmeTitle: measure.programmeTitle,
        programmeOrdinal: measure.programmeOrdinal,
        aspect: measure.aspect,
        impact: measure.impact,
        measure: measure.measure,
        indicator: measure.indicator,
        verification: measure.verification,
        responsible: measure.responsible,
        frequency: measure.frequency,
        deadline: measure.deadline,
      });
    }
  }

  return {
    runId,
    plans: chapter.plans.length,
    measures: measureTotal,
    supersededRunId: active?.id ?? null,
    unchanged: false,
  };
}

/** Remove every run of a project. Used only by fixtures; a real revision supersedes instead. */
export async function clearPgas(tx: DbTx, projectId: string): Promise<void> {
  await tx
    .delete(pgasSchema.pgasImportRun)
    .where(eq(pgasSchema.pgasImportRun.projectId, projectId));
}
