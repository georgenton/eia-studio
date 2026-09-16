import { loadPortfolio } from "@eia/application";
import {
  PermissionDenied,
  ROAD_EIA_SOCIAL_PROFILE,
  SURFACE_DEFINITIONS,
  WORKSPACE_RAIL_ORDER,
} from "@eia/domain";
import {
  ActivityTable,
  AttentionList,
  AttentionRow,
  Chip,
  Columns,
  DemoBadge,
  EmptyState,
  MetricFigure,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  ProgressBar,
  ProvenanceBadge,
  Stack,
  StatusChip,
  SystemState,
  formatMetricValue,
} from "@eia/ui";
import { ButtonLink, ProvenanceLink } from "@/components/navigation";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProvenancePanel } from "@/components/provenance-panel";
import { tenantBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getRequestContext, getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { attentionSeverityLabel, surfaceLabel, tenantRoleLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "./portfolio.module.css";

export const dynamic = "force-dynamic";

/**
 * Portfolio (design v0.2 §1). Every project and figure comes from the application layer under the
 * verified RequestContext; nothing is hardcoded in React. A tenant or project the user cannot
 * access never appears here and cannot be reached by editing the URL either.
 */
export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ prov?: string }>;
}) {
  const { tenant } = await params;
  const { prov } = await searchParams;
  const result = await getRequestContext(tenant);
  if (result.kind === "unauthenticated") redirect("/sign-in");
  if (result.kind === "denied") {
    return (
      <main className={styles.standalone}>
        <PermissionDeniedState
          role={result.role}
          restrictedData={result.restrictedData}
          backHref="/"
        />
      </main>
    );
  }
  const { ctx, tenantSettings } = result;
  const { t, fmt } = await getI18n();
  const sessionUser = await getSessionUser();

  let portfolio;
  try {
    portfolio = await loadPortfolio(getDb(), ctx);
  } catch (error) {
    if (error instanceof PermissionDenied) {
      return (
        <main className={styles.standalone}>
          <PermissionDeniedState
            role={error.role}
            restrictedData={error.restrictedData}
            backHref="/"
          />
        </main>
      );
    }
    throw error;
  }

  const basePath = `/t/${ctx.tenantSlug}`;
  // Module chips on a project card come from the resolved capability set, never a hardcoded list.
  const moduleChips = WORKSPACE_RAIL_ORDER.filter(
    (key) => ctx.capabilities[SURFACE_DEFINITIONS[key].capability],
  ).map((key) => surfaceLabel(t, key));

  return (
    <WorkspaceShell
      breadcrumb={tenantBreadcrumb(portfolio.tenantName, t)}
      ctx={ctx}
      currentSurface={null}
      drawer={
        prov ? <ProvenancePanel closeHref={basePath} ctx={ctx} provenanceId={prov} /> : undefined
      }
      projects={portfolio.projects}
      tenantSettings={tenantSettings}
      userName={sessionUser?.name ?? sessionUser?.email ?? t("shell.user")}
      userEmail={sessionUser?.email ?? null}
    >
      <PageHeader
        title={t("portfolio.title")}
        subtitle={
          <>
            <span>
              {t(
                portfolio.projects.length === 1
                  ? "portfolio.projectActive"
                  : "portfolio.projectsActive",
                { count: fmt.count(portfolio.projects.length) },
              )}
            </span>
            <span>
              {t("portfolio.profileLine", {
                profile: t(
                  `vocabulary.profile.${ROAD_EIA_SOCIAL_PROFILE.key}` as Parameters<typeof t>[0],
                ),
              })}
            </span>
          </>
        }
      />

      {portfolio.metricsRestricted ? (
        <SystemState state="permission denied" title={t("portfolio.metricsRestrictedTitle")}>
          <p>
            {t("portfolio.metricsRestrictedBody", {
              role: tenantRoleLabel(t, ctx.tenantRole),
            })}
          </p>
        </SystemState>
      ) : null}

      <Columns>
        <Stack gap={16}>
          {portfolio.projects.length === 0 ? (
            <SystemState state="empty" title={t("portfolio.emptyTitle")}>
              <p>{t("portfolio.emptyBody")}</p>
            </SystemState>
          ) : (
            portfolio.projects.map((project) => (
              <Panel key={project.id}>
                <PanelBody className={styles.card}>
                  <div className={styles.cardHead}>
                    <div>
                      <h2 className={styles.cardTitle}>
                        <Link href={`${basePath}/p/${project.slug}`}>{project.name}</Link>
                      </h2>
                      <p className={styles.cardMeta}>
                        {project.locationLabel ? <span>{project.locationLabel}</span> : null}
                        <span>
                          {t("portfolio.profileLine", {
                            profile: t(
                              `vocabulary.profile.${project.profileKey}` as Parameters<typeof t>[0],
                            ),
                          })}
                        </span>
                      </p>
                    </div>
                    <StatusChip
                      label={t(
                        `vocabulary.lifecycle.${project.lifecycle}` as Parameters<typeof t>[0],
                      )}
                      tone="ok"
                    />
                  </div>

                  {project.progressRatio !== null && project.progressLabel ? (
                    <ProgressBar
                      label={project.progressLabel}
                      ratio={project.progressRatio}
                      valueLabel={fmt.percent(project.progressRatio)}
                    />
                  ) : null}

                  {project.metrics.length > 0 ? (
                    <>
                      <div className={styles.figures}>
                        {project.metrics.map((metric) => (
                          <MetricFigure
                            key={metric.id}
                            label={metric.definition.label}
                            value={formatMetricValue(metric, fmt)}
                          />
                        ))}
                      </div>
                      <div className={styles.chipRow}>
                        {[...new Set(project.metrics.map((m) => m.provenanceId))].map((id) => {
                          const metric = project.metrics.find((m) => m.provenanceId === id)!;
                          return (
                            <span className={styles.provenancePair} key={id}>
                              <ProvenanceBadge facets={metric.provenance} t={t} />
                              <ProvenanceLink href={`${basePath}?prov=${id}`} />
                            </span>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  <div className={styles.chipRow}>
                    {moduleChips.map((label) => (
                      <Chip key={label}>{label}</Chip>
                    ))}
                  </div>

                  <div className={styles.cardActions}>
                    <ButtonLink href={`${basePath}/p/${project.slug}`} variant="primary">
                      {t("portfolio.openCommandCenter")}
                    </ButtonLink>
                  </div>
                </PanelBody>
              </Panel>
            ))
          )}

          {portfolio.projects.length > 0 ? (
            <EmptyState
              title={t("portfolio.moreEmptyTitle")}
              description={t("portfolio.moreEmptyBody")}
            />
          ) : null}
        </Stack>

        <Stack gap={16}>
          {portfolio.attention.length > 0 ? (
            <Panel>
              <PanelHeader
                label={t("portfolio.attentionTitle")}
                badge={<DemoBadge facets={portfolio.attention.map((a) => a.provenance)} t={t} />}
              />
              <AttentionList>
                {portfolio.attention.map((item) => (
                  <AttentionRow
                    key={item.id}
                    severity={item.severity}
                    severityLabel={attentionSeverityLabel(t, item.severity)}
                    title={item.title}
                    note={item.note}
                    surfaceLabel={item.surface ? surfaceLabel(t, item.surface) : item.surfaceLabel}
                  />
                ))}
              </AttentionList>
            </Panel>
          ) : null}

          {portfolio.activity.length > 0 ? (
            <Panel>
              <PanelHeader
                label={t("portfolio.activityTitle")}
                badge={<DemoBadge facets={portfolio.activity.map((a) => a.provenance)} t={t} />}
              />
              <ActivityTable
                caption={t("portfolio.activityCaption")}
                headers={{
                  time: t("commandCenter.activityTime"),
                  actor: t("commandCenter.activityActor"),
                  action: t("commandCenter.activityAction"),
                  object: t("commandCenter.activityObject"),
                }}
                rows={portfolio.activity.map((event) => ({
                  id: event.id,
                  time: fmt.isoDateShort(event.occurredAt.toISOString().slice(0, 10)),
                  actor: event.actorLabel,
                  action: event.action,
                  object: event.objectLabel,
                }))}
              />
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader label={t("portfolio.modulesTitle")} />
            <PanelBody>
              <p className={styles.muted}>{t("portfolio.modulesBody")}</p>
              <div className={styles.chipRow}>
                {/*
                  The module's name, not its key. A consultant reads this panel to know what the
                  firm has; the key is what the code checks and belongs nowhere near it.
                */}
                {Object.entries(ctx.capabilities)
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => (
                    <Chip key={key}>
                      {t(
                        `vocabulary.capability.${key.replace(".", "_")}` as Parameters<typeof t>[0],
                      )}
                    </Chip>
                  ))}
              </div>
            </PanelBody>
          </Panel>
        </Stack>
      </Columns>
    </WorkspaceShell>
  );
}
