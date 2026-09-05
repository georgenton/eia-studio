import { listUserTenants } from "@eia/application";
import {
  PROJECT_ROLE_LABEL,
  TENANT_ROLE_LABEL,
  type RequestContext,
  type TenantCapabilitySettings,
  type WorkspaceSurface,
} from "@eia/domain";
import { AppShell, RailBrand, RailFooter, RailSection, TopbarUser } from "@eia/ui";

import { AccountMenu } from "./account-menu";
import {
  Breadcrumb,
  CapabilityNav,
  ContextSwitcher,
  type SwitcherOption,
} from "@/components/navigation";
import type { ReactNode } from "react";

import { getDb } from "@/lib/db";
import { buildWorkspaceNav, portalNavEntry, projectPath } from "@/lib/navigation";

export interface ShellProject {
  readonly slug: string;
  readonly name: string;
}

/**
 * The internal shell. Tenant and project context are rendered from the verified RequestContext,
 * never from a cookie or a client-held value, so what the user sees always matches what the
 * server authorized for this request (invariant 1).
 */
export async function WorkspaceShell({
  ctx,
  tenantSettings,
  projects,
  currentSurface,
  breadcrumb,
  userName,
  userEmail,
  drawer,
  children,
}: {
  ctx: RequestContext;
  tenantSettings: TenantCapabilitySettings;
  projects: ReadonlyArray<ShellProject>;
  currentSurface: WorkspaceSurface | null;
  breadcrumb: ReadonlyArray<{ label: string; href?: string }>;
  userName: string;
  /** Shown inside the account menu so a reviewer can see which identity they are on. */
  userEmail?: string | null;
  drawer?: ReactNode;
  children: ReactNode;
}) {
  const tenants = await listUserTenants(getDb(), ctx.userId);
  const tenantOptions: SwitcherOption[] = tenants.map((t) => ({
    value: t.slug,
    label: t.name,
    href: `/t/${t.slug}`,
  }));
  const projectOptions: SwitcherOption[] = projects.map((p) => ({
    value: p.slug,
    label: p.name,
    href: `/t/${ctx.tenantSlug}/p/${p.slug}`,
  }));

  // At tenant scope the rail still lists the workspace, pointed at the active project, so the
  // shell never collapses (invariant 1). The links are ordinary routes: each one rebuilds and
  // re-verifies its own context server-side.
  const activeProjectSlug = ctx.projectSlug ?? projects[0]?.slug ?? null;
  const { entries, currentKey } = buildWorkspaceNav(
    ctx,
    tenantSettings,
    currentSurface,
    activeProjectSlug,
  );
  const portal = portalNavEntry(ctx, tenantSettings);
  /*
   * Who the reader is, in their own words. The keys (`MEMBER`, `COORDINATOR`) are what the
   * authorization model checks; the topbar shows what the person actually is on this project.
   */
  const roleLabel = ctx.projectRole
    ? PROJECT_ROLE_LABEL[ctx.projectRole]
    : TENANT_ROLE_LABEL[ctx.tenantRole];

  return (
    <AppShell
      drawer={drawer}
      rail={
        <>
          <RailBrand label="EIA Studio" />
          <ContextSwitcher
            label="Organización"
            options={tenantOptions}
            value={ctx.tenantSlug}
            emptyLabel="Sin organizaciones"
          />
          <ContextSwitcher
            label="Proyecto activo"
            options={projectOptions}
            value={activeProjectSlug ?? ""}
            emptyLabel="Sin proyecto seleccionado"
          />
          <RailSection label="Espacio de trabajo">
            <CapabilityNav
              entries={[
                {
                  key: "portfolio",
                  label: "Cartera de proyectos",
                  href: `/t/${ctx.tenantSlug}`,
                  presentation: "ACTIVE",
                },
                ...entries,
                ...(portal ? [portal] : []),
              ]}
              currentKey={currentKey}
            />
          </RailSection>
          <RailFooter>
            <CapabilityNav
              entries={[
                {
                  key: "tenant-settings",
                  label: "Configuración de la organización",
                  href: null,
                  presentation: "ANNOUNCED",
                  badge: "PRÓXIMAMENTE",
                },
              ]}
              currentKey={null}
            />
          </RailFooter>
        </>
      }
      topbar={
        <>
          <Breadcrumb items={[...breadcrumb]} />
          <TopbarUser
            name={userName}
            role={roleLabel}
            menu={<AccountMenu email={userEmail ?? null} roleLabel={roleLabel} />}
          />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

export function tenantBreadcrumb(tenantName: string): Array<{ label: string; href?: string }> {
  return [{ label: tenantName }, { label: "Cartera de proyectos" }];
}

/**
 * The project's display name, from the portfolio the page already loaded.
 *
 * Every workspace page has `portfolio.projects` in hand, and passing the URL slug to the
 * breadcrumb instead reads as a different project on every surface but one — which is exactly what
 * happened until this existed. Falls back to the slug rather than to nothing: a breadcrumb that
 * silently loses its middle rung is worse than one showing an identifier.
 */
export function projectLabel(
  projects: ReadonlyArray<{ slug: string; name: string }>,
  slug: string,
): string {
  return projects.find((project) => project.slug === slug)?.name ?? slug;
}

export function projectBreadcrumb(
  ctx: RequestContext,
  tenantName: string,
  projectName: string,
  surfaceLabel: string,
  surfaceHref?: string,
): Array<{ label: string; href?: string }> {
  const items: Array<{ label: string; href?: string }> = [
    { label: tenantName, href: `/t/${ctx.tenantSlug}` },
  ];
  items.push(
    ctx.projectSlug
      ? { label: projectName, href: projectPath(ctx.tenantSlug, ctx.projectSlug, "") }
      : { label: projectName },
  );
  items.push(surfaceHref ? { label: surfaceLabel, href: surfaceHref } : { label: surfaceLabel });
  return items;
}
