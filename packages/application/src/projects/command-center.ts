import { appSchema, withDbContext, type Database } from "@eia/db";
import {
  METRIC_DEFINITIONS,
  requireCapability,
  requirePermission,
  type ActivityEvent,
  type AttentionItem,
  type ForecastSnapshot,
  type MetricKey,
  type MetricSnapshot,
  type ProjectRole,
  type ProvenanceFacets,
  type RequestContext,
  type WorkspaceSurface,
  isWorkspaceSurface,
} from "@eia/domain";
import { and, asc, desc, eq } from "drizzle-orm";

import { facetsOf, loadProvenanceRecords } from "./provenance";

export interface ProjectHeader {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly profileKey: string;
  readonly profileVersion: string;
  readonly lifecycle: string;
  /** Free-text location line of the project, e.g. "Provincia, País". */
  readonly locationLabel: string | null;
  /**
   * The study's own title, as the terms of reference write it, and the programme it belongs to.
   *
   * Both are nullable because most projects will not have them: they are what a real consultancy
   * file carries and a working title is not. Where they exist the surface shows them, because the
   * short name a team uses in conversation is not the name the deliverable will be filed under.
   */
  readonly officialTitle: string | null;
  readonly programmeReference: string | null;
}

/** The forecast plus the provenance it was recorded under, so a demo can be named as one. */
export interface CommandCenterForecast extends ForecastSnapshot {
  readonly provenance: ProvenanceFacets;
}

export interface CommandCenterView {
  readonly project: ProjectHeader;
  readonly metrics: ReadonlyArray<MetricSnapshot>;
  readonly forecast: CommandCenterForecast | null;
  readonly attention: ReadonlyArray<AttentionItem>;
  readonly activity: ReadonlyArray<ActivityEvent>;
  readonly tenantRole: string;
  readonly projectRole: ProjectRole | null;
}

function numericOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Command Center read model. Every value carries the provenance record it came from, so the UI
 * can render the SOURCE TYPE badge and open the drawer without a second round trip and without
 * ever guessing a regime.
 */
export async function loadCommandCenter(
  db: Database,
  ctx: RequestContext,
): Promise<CommandCenterView> {
  requireCapability(ctx, "core.projects");
  requirePermission(ctx, "provenance.read");
  if (ctx.projectId === null) throw new Error("loadCommandCenter requires a project context");
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const projectRows = await tx
      .select({
        id: appSchema.project.id,
        slug: appSchema.project.slug,
        name: appSchema.project.name,
        profileKey: appSchema.project.profileKey,
        profileVersion: appSchema.project.profileVersion,
        lifecycle: appSchema.project.lifecycle,
        locationLabel: appSchema.project.locationLabel,
        officialTitle: appSchema.project.officialTitle,
        programmeReference: appSchema.project.programmeReference,
      })
      .from(appSchema.project)
      .where(
        and(eq(appSchema.project.tenantId, ctx.tenantId), eq(appSchema.project.id, projectId)),
      );
    const projectRow = projectRows[0];
    if (!projectRow) throw new Error("project not visible in context");

    const metricRows = await tx
      .select()
      .from(appSchema.metricSnapshot)
      .where(
        and(
          eq(appSchema.metricSnapshot.tenantId, ctx.tenantId),
          eq(appSchema.metricSnapshot.projectId, projectId),
        ),
      )
      .orderBy(asc(appSchema.metricSnapshot.displayOrder));

    const forecastRows = await tx
      .select()
      .from(appSchema.forecastSnapshot)
      .where(
        and(
          eq(appSchema.forecastSnapshot.tenantId, ctx.tenantId),
          eq(appSchema.forecastSnapshot.projectId, projectId),
        ),
      )
      .orderBy(desc(appSchema.forecastSnapshot.calculatedAt))
      .limit(1);

    const attentionRows = await tx
      .select()
      .from(appSchema.attentionItem)
      .where(
        and(
          eq(appSchema.attentionItem.tenantId, ctx.tenantId),
          eq(appSchema.attentionItem.projectId, projectId),
        ),
      )
      .orderBy(asc(appSchema.attentionItem.displayOrder))
      .limit(6);

    const activityRows = await tx
      .select()
      .from(appSchema.activityEvent)
      .where(
        and(
          eq(appSchema.activityEvent.tenantId, ctx.tenantId),
          eq(appSchema.activityEvent.projectId, projectId),
        ),
      )
      .orderBy(desc(appSchema.activityEvent.occurredAt))
      .limit(8);

    const provenance = await loadProvenanceRecords(tx, ctx, [
      ...metricRows.map((r) => r.provenanceId),
      ...forecastRows.map((r) => r.provenanceId),
      ...attentionRows.map((r) => r.provenanceId),
      ...activityRows.map((r) => r.provenanceId),
    ]);
    const facets = (id: string) => {
      const row = provenance.get(id);
      if (!row) throw new Error("provenance record missing for a visible value");
      return facetsOf(row);
    };

    const metrics: MetricSnapshot[] = metricRows.map((row) => {
      const key = row.key as MetricKey;
      return {
        id: row.id,
        key,
        definition: METRIC_DEFINITIONS[key],
        numericValue: numericOrNull(row.numericValue),
        dateValue: row.dateValue,
        note: row.note,
        observedAt: row.observedAt,
        provenanceId: row.provenanceId,
        provenance: facets(row.provenanceId),
      };
    });

    const forecastRow = forecastRows[0];
    const forecast: CommandCenterForecast | null = forecastRow
      ? {
          id: forecastRow.id,
          algorithmVersion: forecastRow.algorithmVersion,
          asOfDate: forecastRow.asOfDate,
          pending: forecastRow.pending,
          dailyCompletions: forecastRow.dailyCompletions,
          windowDays: forecastRow.windowDays,
          movingAveragePerDay: Number(forecastRow.movingAveragePerDay),
          requiredRatePerDay: numericOrNull(forecastRow.requiredRatePerDay),
          activeTechnicians: forecastRow.activeTechnicians,
          assignedTechnicians: forecastRow.assignedTechnicians,
          targetDate: forecastRow.targetDate,
          projectedCloseDate: forecastRow.projectedCloseDate,
          delayDays: forecastRow.delayDays,
          assumptions: forecastRow.assumptions,
          calculatedAt: forecastRow.calculatedAt,
          provenanceId: forecastRow.provenanceId,
          provenance: facets(forecastRow.provenanceId),
        }
      : null;

    const attention: AttentionItem[] = attentionRows.map((row) => {
      const surface: WorkspaceSurface | null =
        row.surfaceKey && isWorkspaceSurface(row.surfaceKey) ? row.surfaceKey : null;
      return {
        id: row.id,
        severity: row.severity,
        title: row.title,
        note: row.note,
        surfaceLabel: row.surfaceLabel,
        surface,
        actionLabel: row.actionLabel,
        provenanceId: row.provenanceId,
        provenance: facets(row.provenanceId),
      };
    });

    const activity: ActivityEvent[] = activityRows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      actorLabel: row.actorLabel,
      action: row.action,
      objectLabel: row.objectLabel,
      provenanceId: row.provenanceId,
      provenance: facets(row.provenanceId),
    }));

    return {
      project: {
        id: projectRow.id,
        slug: projectRow.slug,
        name: projectRow.name,
        profileKey: projectRow.profileKey,
        profileVersion: projectRow.profileVersion,
        lifecycle: projectRow.lifecycle,
        locationLabel: projectRow.locationLabel,
        officialTitle: projectRow.officialTitle,
        programmeReference: projectRow.programmeReference,
      },
      metrics,
      forecast,
      attention,
      activity,
      tenantRole: ctx.tenantRole,
      projectRole: ctx.projectRole,
    };
  });
}
