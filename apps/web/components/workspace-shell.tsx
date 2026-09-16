import { listUserTenants } from "@eia/application";
import type { Translator } from "@eia/i18n";
import {
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

import { LocaleProvider } from "@/components/i18n/locale-provider";
import { getDb } from "@/lib/db";
import { getLocale, getTranslator } from "@/lib/locale";
import { buildWorkspaceNav, projectPath } from "@/lib/navigation";

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
  const t = await getTranslator();
  const locale = await getLocale();
  const { entries, currentKey } = buildWorkspaceNav(
    ctx,
    tenantSettings,
    currentSurface,
    t,
    activeProjectSlug,
  );
  /*
   * Who the reader is, in their own words. The keys (`MEMBER`, `COORDINATOR`) are what the
   * authorization model checks; the topbar shows what the person actually is on this project.
   */
  const roleLabel = ctx.projectRole
    ? t(`vocabulary.projectRole.${ctx.projectRole}` as Parameters<Translator>[0])
    : t(`vocabulary.tenantRole.${ctx.tenantRole}` as Parameters<Translator>[0]);

  return (
    <LocaleProvider locale={locale}>
      <AppShell
        drawer={drawer}
        rail={
          <>
            <RailBrand label="EIA Studio" />
            <ContextSwitcher
              label={t("shell.organisation")}
              options={tenantOptions}
              value={ctx.tenantSlug}
              emptyLabel={t("shell.noOrganisations")}
            />
            <ContextSwitcher
              label={t("shell.activeProject")}
              options={projectOptions}
              value={activeProjectSlug ?? ""}
              emptyLabel={t("shell.noProjectSelected")}
            />
            <RailSection label={t("shell.workspace")}>
              <CapabilityNav
                entries={[
                  {
                    key: "portfolio",
                    label: t("shell.portfolio"),
                    href: `/t/${ctx.tenantSlug}`,
                    presentation: "ACTIVE",
                  },
                  ...entries,
                ]}
                currentKey={currentKey}
              />
            </RailSection>
            <RailFooter>
              <CapabilityNav
                entries={[
                  {
                    key: "tenant-settings",
                    label: t("shell.tenantSettings"),
                    href: null,
                    presentation: "ANNOUNCED",
                    badge: t("shell.comingSoon"),
                  },
                ]}
                currentKey={null}
              />
            </RailFooter>
          </>
        }
        labels={{
          skipToContent: t("shell.skipToContent"),
          mainNavigation: t("shell.mainNavigation"),
        }}
        topbar={
          <>
            <Breadcrumb items={[...breadcrumb]} label={t("shell.breadcrumb")} />
            <TopbarUser
              name={userName}
              role={roleLabel}
              menu={<AccountMenu email={userEmail ?? null} roleLabel={roleLabel} />}
              menuLabel={t("auth.accountMenu", { name: userName })}
            />
          </>
        }
      >
        {children}
      </AppShell>
    </LocaleProvider>
  );
}

export function tenantBreadcrumb(
  tenantName: string,
  t: Translator,
): Array<{ label: string; href?: string }> {
  return [{ label: tenantName }, { label: t("shell.portfolio") }];
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
