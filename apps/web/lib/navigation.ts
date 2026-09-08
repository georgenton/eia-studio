import "server-only";

import {
  navigationPresentation,
  SURFACE_DEFINITIONS,
  WORKSPACE_RAIL_ORDER,
  type RequestContext,
  type TenantCapabilitySettings,
  type WorkspaceSurface,
} from "@eia/domain";
import type { NavEntry } from "@/components/navigation";

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

/**
 * The link out to the standalone client view.
 *
 * The rail already carries `Portal del cliente` as an ordinary surface — that is where the firm
 * prepares and publishes. This is the *client's* page, which is a different surface with its own
 * chrome (invariant 3, ADR-009), so it is reached from that surface rather than from the rail.
 */
export function clientViewPath(tenantSlug: string, projectSlug: string): string {
  return `/portal/${tenantSlug}/${projectSlug}`;
}
