import { withDbContext, type Database } from "@eia/db";
import {
  headingVariants,
  planCompleteness,
  requireCapability,
  requirePermission,
  type PgasPlan,
  type PlanCompleteness,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * The management plan, as the surface reads it (ADR-024).
 *
 * One query per level rather than one per plan: nine plans and 86 measures is small, and the shape
 * a reader wants — plans in document order, each with its measures grouped by programme banner —
 * is a grouping of two flat reads.
 */
export interface PgasMeasureView {
  readonly measureCode: string;
  readonly statedNumber: string;
  readonly programmeTitle: string | null;
  readonly aspect: string;
  readonly impact: string;
  readonly measure: string;
  readonly indicator: string;
  readonly verification: string;
  readonly responsible: string;
  readonly frequency: string;
  readonly deadline: string;
}

export interface PgasPlanSummary {
  readonly code: string | null;
  readonly title: string;
  readonly objective: string | null;
  readonly place: string | null;
  readonly columns: ReadonlyArray<string>;
  readonly completeness: PlanCompleteness;
  readonly measures: ReadonlyArray<PgasMeasureView>;
}

export interface PgasPlanView {
  readonly imported: {
    readonly file: string;
    readonly sha256: string;
    readonly at: Date;
    readonly plans: number;
    readonly measures: number;
    readonly provenanceId: string;
  } | null;
  readonly plans: ReadonlyArray<PgasPlanSummary>;
  /** Column names that differ between plans for the same position, both spellings named. */
  readonly headingVariants: ReadonlyArray<{
    position: number;
    spellings: ReadonlyArray<string>;
  }>;
}

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

export async function loadPgasPlan(db: Database, ctx: RequestContext): Promise<PgasPlanView> {
  requireCapability(ctx, "compliance.pma");
  requirePermission(ctx, "documents.read");
  if (!ctx.projectId) return { imported: null, plans: [], headingVariants: [] };

  return withDbContext(
    db,
    { userId: ctx.userId, tenantId: ctx.tenantId, projectId: ctx.projectId },
    async (tx) => {
      const runRows = await tx.execute(sql`
        select id, source_file, source_sha256, imported_at, plan_count, measure_count, provenance_id
          from app.pgas_import_run
         where tenant_id = ${ctx.tenantId} and project_id = ${ctx.projectId} and is_active
         limit 1
      `);
      const run = runRows.rows[0] as
        | {
            id: string;
            source_file: string;
            source_sha256: string;
            imported_at: string | Date;
            plan_count: number;
            measure_count: number;
            provenance_id: string;
          }
        | undefined;
      if (!run) return { imported: null, plans: [], headingVariants: [] };

      const planRows = (
        await tx.execute(sql`
          select id, ordinal, code, title, objective, place, column_headings
            from app.pgas_plan
           where tenant_id = ${ctx.tenantId} and import_run_id = ${run.id}
           order by ordinal
        `)
      ).rows as unknown as ReadonlyArray<{
        id: string;
        ordinal: number;
        code: string | null;
        title: string;
        objective: string | null;
        place: string | null;
        column_headings: string[] | string;
      }>;

      const measureRows = (
        await tx.execute(sql`
          select m.plan_id, m.measure_code, m.stated_number, m.programme_title, m.programme_ordinal,
                 m.aspect, m.impact, m.measure, m.indicator, m.verification, m.responsible,
                 m.frequency, m.deadline
            from app.pgas_measure m
            join app.pgas_plan p on p.tenant_id = m.tenant_id and p.id = m.plan_id
           where m.tenant_id = ${ctx.tenantId} and p.import_run_id = ${run.id}
           order by p.ordinal, m.programme_ordinal, m.ordinal
        `)
      ).rows as unknown as ReadonlyArray<Record<string, unknown>>;

      const byPlan = new Map<string, Array<Record<string, unknown>>>();
      for (const row of measureRows) {
        const key = String(row.plan_id);
        const list = byPlan.get(key) ?? [];
        list.push(row);
        byPlan.set(key, list);
      }

      // `tx.execute` returns a Postgres array as `{A,B}` text when the driver has no type hint.
      const columnsOf = (value: string[] | string): string[] =>
        Array.isArray(value)
          ? value
          : String(value)
              .replace(/^\{|\}$/g, "")
              .split(/","|,/)
              .map((c) => c.replace(/^"|"$/g, "").trim())
              .filter(Boolean);

      const plans: PgasPlanSummary[] = planRows.map((planRow) => {
        const rows = byPlan.get(planRow.id) ?? [];
        const measures: PgasMeasureView[] = rows.map((row) => ({
          measureCode: text(row.measure_code),
          statedNumber: text(row.stated_number),
          programmeTitle: row.programme_title === null ? null : text(row.programme_title),
          aspect: text(row.aspect),
          impact: text(row.impact),
          measure: text(row.measure),
          indicator: text(row.indicator),
          verification: text(row.verification),
          responsible: text(row.responsible),
          frequency: text(row.frequency),
          deadline: text(row.deadline),
        }));
        const columns = columnsOf(planRow.column_headings);
        const asDomain: PgasPlan = {
          title: planRow.title,
          code: planRow.code,
          objective: planRow.objective,
          place: planRow.place,
          columns,
          measures: rows.map((row) => ({
            statedNumber: text(row.stated_number),
            programmeTitle: row.programme_title === null ? null : text(row.programme_title),
            programmeOrdinal: Number(row.programme_ordinal ?? 0),
            aspect: text(row.aspect),
            impact: text(row.impact),
            measure: text(row.measure),
            indicator: text(row.indicator),
            verification: text(row.verification),
            responsible: text(row.responsible),
            frequency: text(row.frequency),
            deadline: text(row.deadline),
          })),
        };
        return {
          code: planRow.code,
          title: planRow.title,
          objective: planRow.objective,
          place: planRow.place,
          columns,
          completeness: planCompleteness(asDomain),
          measures,
        };
      });

      return {
        imported: {
          file: run.source_file,
          sha256: run.source_sha256,
          at: run.imported_at instanceof Date ? run.imported_at : new Date(run.imported_at),
          plans: run.plan_count,
          measures: run.measure_count,
          provenanceId: run.provenance_id,
        },
        plans,
        headingVariants: headingVariants(
          plans.map((p) => ({
            title: p.title,
            code: p.code,
            objective: p.objective,
            place: p.place,
            columns: [...p.columns],
            measures: [],
          })),
        ),
      };
    },
  );
}
