import { appSchema, withDbContext, type Database } from "@eia/db";
import {
  can,
  METRIC_DEFINITIONS,
  requirePermission,
  type ActivityEvent,
  type AttentionItem,
  type MetricKey,
  type MetricSnapshot,
  type RequestContext,
  type WorkspaceSurface,
  isWorkspaceSurface,
} from "@eia/domain";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { facetsOf, loadProvenanceRecords } from "./provenance";

/** Headline figures shown on a Portfolio project card. */
const CARD_METRIC_KEYS: ReadonlyArray<MetricKey> = [
  "universe_estimated",
  "surveys_complete",
  "consultation_participants",
];

export interface PortfolioCard {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly summary: string | null;
  readonly locationLabel: string | null;
  readonly profileKey: string;
  readonly lifecycle: string;
  readonly metrics: ReadonlyArray<MetricSnapshot>;
  /** Social progress = surveys complete ÷ estimated universe, when both exist. */
  readonly progressRatio: number | null;
  readonly progressLabel: string | null;
}

export interface PortfolioView {
  readonly tenantName: string;
  readonly projects: ReadonlyArray<PortfolioCard>;
  readonly attention: ReadonlyArray<AttentionItem>;
  readonly activity: ReadonlyArray<ActivityEvent>;
  /**
   * True when the caller may see project rows but not their operational data — a tenant ADMIN
   * without a ProjectMembership (D-015). The UI says so instead of showing empty cards.
   */
  readonly metricsRestricted: boolean;
}

/**
 * Portfolio read model. Projects come from the same RLS-protected query as Slice 0; metrics,
 * attention and activity are project-scoped rows read at tenant scope, so their policies re-check
 * `has_project_access` per row. A project the user administers but is not assigned to therefore
 * appears by name with no figures, which is exactly the D-015 rule.
 */
export async function loadPortfolio(db: Database, ctx: RequestContext): Promise<PortfolioView> {
  requirePermission(ctx, "portfolio.read");

  return withDbContext(
    db,
    { userId: ctx.userId, tenantId: ctx.tenantId, projectId: null },
    async (tx) => {
      const tenantRows = await tx
        .select({ name: appSchema.tenant.name })
        .from(appSchema.tenant)
        .where(eq(appSchema.tenant.id, ctx.tenantId));

      const projectRows = await tx
        .select({
          id: appSchema.project.id,
          slug: appSchema.project.slug,
          name: appSchema.project.name,
          profileKey: appSchema.project.profileKey,
          lifecycle: appSchema.project.lifecycle,
          locationLabel: appSchema.project.locationLabel,
        })
        .from(appSchema.project)
        .where(eq(appSchema.project.tenantId, ctx.tenantId))
        .orderBy(asc(appSchema.project.createdAt));

      const projectIds = projectRows.map((p) => p.id);
      const metricRows =
        projectIds.length === 0
          ? []
          : await tx
              .select()
              .from(appSchema.metricSnapshot)
              .where(
                and(
                  eq(appSchema.metricSnapshot.tenantId, ctx.tenantId),
                  inArray(appSchema.metricSnapshot.projectId, projectIds),
                  inArray(appSchema.metricSnapshot.key, [...CARD_METRIC_KEYS]),
                ),
              )
              .orderBy(asc(appSchema.metricSnapshot.displayOrder));

      const attentionRows =
        projectIds.length === 0
          ? []
          : await tx
              .select()
              .from(appSchema.attentionItem)
              .where(
                and(
                  eq(appSchema.attentionItem.tenantId, ctx.tenantId),
                  inArray(appSchema.attentionItem.projectId, projectIds),
                ),
              )
              .orderBy(asc(appSchema.attentionItem.displayOrder))
              .limit(3);

      const activityRows =
        projectIds.length === 0
          ? []
          : await tx
              .select()
              .from(appSchema.activityEvent)
              .where(
                and(
                  eq(appSchema.activityEvent.tenantId, ctx.tenantId),
                  inArray(appSchema.activityEvent.projectId, projectIds),
                ),
              )
              .orderBy(desc(appSchema.activityEvent.occurredAt))
              .limit(3);

      const provenance = await loadProvenanceRecords(tx, ctx, [
        ...metricRows.map((r) => r.provenanceId),
        ...attentionRows.map((r) => r.provenanceId),
        ...activityRows.map((r) => r.provenanceId),
      ]);
      const facets = (id: string) => {
        const row = provenance.get(id);
        if (!row) throw new Error("provenance record missing for a visible value");
        return facetsOf(row);
      };

      const byProject = new Map<string, MetricSnapshot[]>();
      for (const row of metricRows) {
        const key = row.key as MetricKey;
        const snapshot: MetricSnapshot = {
          id: row.id,
          key,
          definition: METRIC_DEFINITIONS[key],
          numericValue: row.numericValue === null ? null : Number(row.numericValue),
          dateValue: row.dateValue,
          note: row.note,
          observedAt: row.observedAt,
          provenanceId: row.provenanceId,
          provenance: facets(row.provenanceId),
        };
        const list = byProject.get(row.projectId) ?? [];
        list.push(snapshot);
        byProject.set(row.projectId, list);
      }

      const projects: PortfolioCard[] = projectRows.map((row) => {
        const metrics = (byProject.get(row.id) ?? []).sort(
          (a, b) => CARD_METRIC_KEYS.indexOf(a.key) - CARD_METRIC_KEYS.indexOf(b.key),
        );
        const universe = metrics.find((m) => m.key === "universe_estimated")?.numericValue ?? null;
        const surveys = metrics.find((m) => m.key === "surveys_complete")?.numericValue ?? null;
        const progressRatio =
          universe && universe > 0 && surveys !== null ? surveys / universe : null;
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          summary: null,
          locationLabel: row.locationLabel,
          profileKey: row.profileKey,
          lifecycle: row.lifecycle,
          metrics,
          progressRatio,
          progressLabel:
            progressRatio === null || surveys === null || universe === null
              ? null
              : `Avance social · ${surveys} de ${universe} predios levantados`,
        };
      });

      return {
        tenantName: tenantRows[0]?.name ?? ctx.tenantSlug,
        projects,
        attention: attentionRows.map((row) => {
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
        }),
        activity: activityRows.map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt,
          actorLabel: row.actorLabel,
          action: row.action,
          objectLabel: row.objectLabel,
          provenanceId: row.provenanceId,
          provenance: facets(row.provenanceId),
        })),
        metricsRestricted:
          projectRows.length > 0 && metricRows.length === 0 && !can(ctx, "provenance.read"),
      };
    },
  );
}
