import { listUserTenants } from "@eia/application";
import type { RequestContext, TenantCapabilitySettings, WorkspaceSurface } from "@eia/domain";
import { AppShell, RailBrand, RailFooter, RailSection, TopbarUser } from "@eia/ui";
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
  drawer,
  children,
}: {
  ctx: RequestContext;
  tenantSettings: TenantCapabilitySettings;
  projects: ReadonlyArray<ShellProject>;
  currentSurface: WorkspaceSurface | null;
  breadcrumb: ReadonlyArray<{ label: string; href?: string }>;
  userName: string;
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
  const role = ctx.projectRole ?? ctx.tenantRole;

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
          <RailSection label="Workspace">
            <CapabilityNav
              entries={[
                {
                  key: "portfolio",
                  label: "Portfolio",
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
                  label: "Tenant Settings",
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
            role={`${ctx.tenantRole}${role === ctx.tenantRole ? "" : ` / ${role}`}`}
          />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

export function tenantBreadcrumb(tenantName: string): Array<{ label: string; href?: string }> {
  return [{ label: tenantName }, { label: "Portfolio" }];
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
