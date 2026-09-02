import "server-only";

import {
  CAPABILITY_CATALOG,
  navigationPresentation,
  SURFACE_DEFINITIONS,
  WORKSPACE_RAIL_ORDER,
  type RequestContext,
  type TenantCapabilitySettings,
  type WorkspaceSurface,
} from "@eia/domain";
import type { NavEntry } from "@eia/ui";

export function projectPath(tenantSlug: string, projectSlug: string, segment: string): string {
  const base = `/t/${tenantSlug}/p/${projectSlug}`;
  return segment === "" ? base : `${base}/${segment}`;
}

/**
 * Build the rail from the resolved CapabilitySet plus the shell-only presentation hint
 * (FEATURES.md §3). HIDDEN capabilities contribute nothing — no greyed-out row, no padlock —
 * and ANNOUNCED ones contribute a non-navigable placeholder. This is presentation only:
 * the routes themselves call `requireCapability`.
 */
export function buildWorkspaceNav(
  ctx: RequestContext,
  tenantSettings: TenantCapabilitySettings,
  currentSurface: WorkspaceSurface | null,
  /** Project the rail points at; on the Portfolio this is the active project, not the context. */
  activeProjectSlug: string | null = ctx.projectSlug,
): { entries: ReadonlyArray<NavEntry>; currentKey: string | null } {
  if (!activeProjectSlug) return { entries: [], currentKey: null };
  const entries: NavEntry[] = [];
  for (const key of WORKSPACE_RAIL_ORDER) {
    const surface = SURFACE_DEFINITIONS[key];
    const presentation = navigationPresentation(
      surface.capability,
      ctx.capabilities,
      tenantSettings,
    );
    if (presentation === "HIDDEN") continue;
    if (presentation === "ANNOUNCED") {
      entries.push({
        key,
        label: surface.label,
        href: null,
        presentation: "ANNOUNCED",
        badge: key === "reports" ? "FASE 3" : "PRÓXIMAMENTE",
      });
      continue;
    }
    entries.push({
      key,
      label: surface.label,
      href: projectPath(ctx.tenantSlug, activeProjectSlug, surface.segment),
      presentation: "ACTIVE",
    });
  }
  return { entries, currentKey: currentSurface };
}

/** The Client Portal is a separate surface (invariant 3); the rail only links out to it. */
export function portalNavEntry(
  ctx: RequestContext,
  tenantSettings: TenantCapabilitySettings,
): NavEntry | null {
  const presentation = navigationPresentation("client.portal", ctx.capabilities, tenantSettings);
  if (presentation === "HIDDEN") return null;
  return {
    key: "client-portal",
    label: CAPABILITY_CATALOG["client.portal"].label,
    href: null,
    presentation: "ANNOUNCED",
    badge: "PRÓXIMAMENTE",
  };
}
