import { loadPortfolio } from "@eia/application";
import {
  ATTENTION_SEVERITY_LABEL,
  PermissionDenied,
  CAPABILITY_CATALOG,
  ROAD_EIA_SOCIAL_PROFILE,
  profileLabel,
  type CapabilityKey,
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
  formatCount,
  formatIsoDateShort,
  formatMetricValue,
  formatPercent,
} from "@eia/ui";
import { ButtonLink, ProvenanceLink } from "@/components/navigation";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProvenancePanel } from "@/components/provenance-panel";
import { tenantBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getRequestContext, getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { lifecycleLabel } from "@/lib/lifecycle";
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
  ).map((key) => SURFACE_DEFINITIONS[key].label);

  return (
    <WorkspaceShell
      breadcrumb={tenantBreadcrumb(portfolio.tenantName)}
      ctx={ctx}
      currentSurface={null}
      drawer={
        prov ? <ProvenancePanel closeHref={basePath} ctx={ctx} provenanceId={prov} /> : undefined
      }
      projects={portfolio.projects}
      tenantSettings={tenantSettings}
      userName={sessionUser?.name ?? sessionUser?.email ?? "Usuario"}
      userEmail={sessionUser?.email ?? null}
    >
      <PageHeader
        title="Cartera de proyectos"
        subtitle={
          <>
            <span>
              {formatCount(portfolio.projects.length)}{" "}
              {portfolio.projects.length === 1 ? "proyecto activo" : "proyectos activos"}
            </span>
            <span>perfil {ROAD_EIA_SOCIAL_PROFILE.label}</span>
          </>
        }
      />

      {portfolio.metricsRestricted ? (
        <SystemState state="permission denied" title="Solo administración de proyectos">
          <p>
            Tu rol <strong>{ctx.tenantRole}</strong> administra este tenant pero no incluye acceso a
            los datos operativos de los proyectos. Necesitas una asignación en el proyecto para ver
            sus cifras.
          </p>
        </SystemState>
      ) : null}

      <Columns>
        <Stack gap={16}>
          {portfolio.projects.length === 0 ? (
            <SystemState state="empty" title="Aún no hay proyectos en esta organización">
              <p>
                Crea uno desde una plantilla de perfil o importa geometría, predios y encuestas.
              </p>
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
                        <span>perfil {profileLabel(project.profileKey)}</span>
                      </p>
                    </div>
                    <StatusChip label={lifecycleLabel(project.lifecycle)} tone="ok" />
                  </div>

                  {project.progressRatio !== null && project.progressLabel ? (
                    <ProgressBar
                      label={project.progressLabel}
                      ratio={project.progressRatio}
                      valueLabel={formatPercent(project.progressRatio)}
                    />
                  ) : null}

                  {project.metrics.length > 0 ? (
                    <>
                      <div className={styles.figures}>
                        {project.metrics.map((metric) => (
                          <MetricFigure
                            key={metric.id}
                            label={metric.definition.label}
                            value={formatMetricValue(metric)}
                          />
                        ))}
                      </div>
                      <div className={styles.chipRow}>
                        {[...new Set(project.metrics.map((m) => m.provenanceId))].map((id) => {
                          const metric = project.metrics.find((m) => m.provenanceId === id)!;
                          return (
                            <span className={styles.provenancePair} key={id}>
                              <ProvenanceBadge facets={metric.provenance} />
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
                      Abrir el centro de control
                    </ButtonLink>
                  </div>
                </PanelBody>
              </Panel>
            ))
          )}

          {portfolio.projects.length > 0 ? (
            <EmptyState
              title="Aún no hay más proyectos en esta organización"
              description="Crea uno desde una plantilla de perfil o importa geometría, predios y encuestas existentes."
            />
          ) : null}
        </Stack>

        <Stack gap={16}>
          {portfolio.attention.length > 0 ? (
            <Panel>
              <PanelHeader
                label="Atención requerida"
                badge={<DemoBadge facets={portfolio.attention.map((a) => a.provenance)} />}
              />
              <AttentionList>
                {portfolio.attention.map((item) => (
                  <AttentionRow
                    key={item.id}
                    severity={item.severity}
                    severityLabel={ATTENTION_SEVERITY_LABEL[item.severity]}
                    title={item.title}
                    note={item.note}
                    surfaceLabel={item.surfaceLabel}
                  />
                ))}
              </AttentionList>
            </Panel>
          ) : null}

          {portfolio.activity.length > 0 ? (
            <Panel>
              <PanelHeader
                label="Actividad reciente"
                badge={<DemoBadge facets={portfolio.activity.map((a) => a.provenance)} />}
              />
              <ActivityTable
                caption="Actividad reciente de la organización"
                rows={portfolio.activity.map((event) => ({
                  id: event.id,
                  time: formatIsoDateShort(event.occurredAt.toISOString().slice(0, 10)),
                  actor: event.actorLabel,
                  action: event.action,
                  object: event.objectLabel,
                }))}
              />
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader label="Módulos activos" />
            <PanelBody>
              <p className={styles.muted}>
                Lo que esta organización tiene contratado y encendido. Un módulo apagado no aparece
                en el menú y tampoco se abre escribiendo su dirección.
              </p>
              <div className={styles.chipRow}>
                {/*
                  The module's name, not its key. A consultant reads this panel to know what the
                  firm has; the key is what the code checks and belongs nowhere near it.
                */}
                {Object.entries(ctx.capabilities)
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => (
                    <Chip key={key}>{CAPABILITY_CATALOG[key as CapabilityKey].label}</Chip>
                  ))}
              </div>
            </PanelBody>
          </Panel>
        </Stack>
      </Columns>
    </WorkspaceShell>
  );
}
