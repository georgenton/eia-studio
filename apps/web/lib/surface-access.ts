import "server-only";

import {
  FeatureDisabled,
  PermissionDenied,
  SURFACE_DEFINITIONS,
  surfaceForSegment,
  requireCapability,
  type RequestContext,
  type SurfaceDefinition,
  type WorkspaceSurface,
} from "@eia/domain";

import { getRequestContext } from "./context";

/**
 * The single capability-route policy of the workspace (ADR-016). Every project route resolves
 * through this function and no page re-derives the rule.
 *
 * The outcome is decided by the **effective capability**, never by navigation presentation:
 *
 * - effective `false`, for any reason (product status, tenant entitlement, project override,
 *   an unsatisfied dependency, or an ANNOUNCED module) → `not-found`. The route answers exactly
 *   as it would for a URL that means nothing, so the router cannot be used to enumerate a
 *   tenant's configuration or to learn who could enable a module;
 * - effective `true` and the surface is built → `ok`;
 * - effective `true` and the surface is not built yet → `not-implemented`, an explicit
 *   non-functional state for a user who *is* entitled to the module.
 *
 * Authentication and context failures keep their own outcomes, because they are not capability
 * decisions: an unauthenticated visitor is sent to sign in, and a tenant or project the user has
 * no membership for is `denied` — itself indistinguishable from a non-existent one.
 */
export type SurfaceAccess =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "denied"; readonly role: string | null; readonly restrictedData: string }
  /** Route must answer 404: the capability is not effective here. */
  | { readonly kind: "not-found" }
  | {
      readonly kind: "not-implemented";
      readonly ctx: RequestContext;
      readonly surface: SurfaceDefinition;
    }
  | {
      readonly kind: "ok";
      readonly ctx: RequestContext;
      readonly surface: SurfaceDefinition;
    };

async function accessFor(
  tenantSlug: string,
  projectSlug: string,
  surface: SurfaceDefinition,
): Promise<SurfaceAccess> {
  const result = await getRequestContext(tenantSlug, projectSlug);
  if (result.kind === "unauthenticated") return { kind: "unauthenticated" };
  if (result.kind === "denied") {
    return { kind: "denied", role: result.role, restrictedData: result.restrictedData };
  }
  const { ctx } = result;
  try {
    requireCapability(ctx, surface.capability);
  } catch (error) {
    if (error instanceof FeatureDisabled) return { kind: "not-found" };
    throw error;
  }
  return surface.implemented
    ? { kind: "ok", ctx, surface }
    : { kind: "not-implemented", ctx, surface };
}

/** Resolve a known surface by key (used by the routes this slice implements). */
export function resolveSurfaceAccess(
  tenantSlug: string,
  projectSlug: string,
  key: WorkspaceSurface,
): Promise<SurfaceAccess> {
  return accessFor(tenantSlug, projectSlug, SURFACE_DEFINITIONS[key]);
}

/**
 * Resolve a surface from a URL segment. An unknown segment is `not-found` before any context is
 * built, so an invented path never reaches the database.
 */
export async function resolveSurfaceAccessBySegment(
  tenantSlug: string,
  projectSlug: string,
  segment: string,
): Promise<SurfaceAccess> {
  const surface = surfaceForSegment(segment);
  if (!surface) return { kind: "not-found" };
  return accessFor(tenantSlug, projectSlug, surface);
}

/**
 * Map a domain error raised *inside* an authorized surface to the same policy: a capability that
 * turns out to be ineffective is still 404, a permission failure is still a denial.
 */
export function accessForDomainError(error: unknown): SurfaceAccess | null {
  if (error instanceof FeatureDisabled) return { kind: "not-found" };
  if (error instanceof PermissionDenied) {
    return { kind: "denied", role: error.role, restrictedData: error.restrictedData };
  }
  return null;
}
