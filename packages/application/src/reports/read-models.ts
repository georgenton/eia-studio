import { withDbContext, type Database } from "@eia/db";
import {
  NotFound,
  reportSnapshotSchema,
  requireCapability,
  requirePermission,
  type ReportSnapshot,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * What the Reports surface reads.
 *
 * A version is the unit throughout: the list is of versions, and the detail is one version's
 * snapshot with whatever prose it carries. A superseded version is not hidden — it is the record of
 * what the chapter said then, and following a reference into it must land on those words.
 */
export interface ReportVersionSummary {
  readonly id: string;
  readonly versionLabel: string;
  readonly surveyVersionLabel: string;
  readonly generatedAt: string;
  readonly generatedBy: string | null;
  readonly narrativeModel: string | null;
  readonly factCount: number;
  readonly digest: string;
  readonly current: boolean;
}

export interface ReportOverview {
  readonly reportId: string | null;
  readonly title: string;
  readonly versions: ReadonlyArray<ReportVersionSummary>;
}

export interface ReportVersionDetail extends ReportVersionSummary {
  readonly projectName: string;
  readonly snapshot: ReportSnapshot;
  readonly narratives: ReadonlyMap<string, string>;
  readonly provenanceId: string;
  readonly superseded: boolean;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

const iso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export async function loadReportOverview(
  db: Database,
  ctx: RequestContext,
): Promise<ReportOverview> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const report = await tx.execute(sql`
      select id, title, current_version_id from app.generated_report
       where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and kind = 'social_chapter'
    `);
    const found = report.rows[0] as
      { id: string; title: string; current_version_id: string | null } | undefined;
    if (!found) return { reportId: null, title: "Capítulo social", versions: [] };

    const versions = await tx.execute(sql`
      select v.id, v.version_label, v.survey_version_label, v.generated_at, v.narrative_model,
             v.snapshot_digest, u.name as generated_by,
             jsonb_array_length(
               (select coalesce(jsonb_agg(f), '[]'::jsonb)
                  from jsonb_array_elements(v.snapshot->'sections') s,
                       jsonb_array_elements(s->'facts') f)
             ) as fact_count
        from app.report_version v
        left join app."user" u on u.id = v.generated_by_user_id
       where v.tenant_id = ${ctx.tenantId} and v.report_id = ${found.id}
       order by v.generated_at desc
    `);

    return {
      reportId: found.id,
      title: found.title,
      versions: (versions.rows as unknown as RawVersion[]).map((row) =>
        toSummary(row, found.current_version_id),
      ),
    };
  });
}

export async function loadReportVersion(
  db: Database,
  ctx: RequestContext,
  versionLabel?: string,
): Promise<ReportVersionDetail> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const result = await tx.execute(sql`
      select v.id, v.version_label, v.survey_version_label, v.generated_at, v.narrative_model,
             v.snapshot_digest, v.snapshot, v.provenance_id, u.name as generated_by,
             r.current_version_id, p.name as project_name
        from app.report_version v
        join app.generated_report r on r.tenant_id = v.tenant_id and r.id = v.report_id
        join app.project p on p.tenant_id = v.tenant_id and p.id = v.project_id
        left join app."user" u on u.id = v.generated_by_user_id
       where v.tenant_id = ${ctx.tenantId} and v.project_id = ${projectId}
         and r.kind = 'social_chapter'
         and ${versionLabel ? sql`v.version_label = ${versionLabel}` : sql`v.id = r.current_version_id`}
    `);
    const row = result.rows[0] as unknown as
      | (RawVersion & {
          snapshot: unknown;
          provenance_id: string;
          current_version_id: string | null;
          project_name: string;
        })
      | undefined;
    if (!row) throw new NotFound("report version");

    // Parsed rather than trusted: a snapshot written by an older shape of this code must fail
    // loudly here rather than render as a chapter with holes in it.
    const snapshot = reportSnapshotSchema.parse(row.snapshot);

    const sections = await tx.execute(sql`
      select key, narrative from app.report_section
       where tenant_id = ${ctx.tenantId} and version_id = ${row.id} and narrative is not null
    `);
    const narratives = new Map(
      (sections.rows as Array<{ key: string; narrative: string }>).map((s) => [s.key, s.narrative]),
    );

    return {
      ...toSummary(row, row.current_version_id),
      // Counted from the snapshot rather than re-queried: the detail already holds it, and two
      // sources for one number is how they come to disagree.
      factCount: snapshot.sections.reduce((sum, section) => sum + section.facts.length, 0),
      projectName: row.project_name,
      snapshot,
      narratives,
      provenanceId: row.provenance_id,
      superseded: row.current_version_id !== row.id,
    };
  });
}

interface RawVersion {
  id: string;
  version_label: string;
  survey_version_label: string;
  generated_at: Date | string;
  narrative_model: string | null;
  snapshot_digest: string;
  generated_by: string | null;
  fact_count?: number;
}

function toSummary(row: RawVersion, currentId: string | null): ReportVersionSummary {
  return {
    id: row.id,
    versionLabel: row.version_label,
    surveyVersionLabel: row.survey_version_label,
    generatedAt: iso(row.generated_at),
    generatedBy: row.generated_by,
    narrativeModel: row.narrative_model,
    factCount: Number(row.fact_count ?? 0),
    digest: row.snapshot_digest,
    current: row.id === currentId,
  };
}
