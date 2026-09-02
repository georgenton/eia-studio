import type { CapabilitySet } from "./capabilities/resolver";
import type { Permission } from "./permissions";
import type { ProjectRole, TenantRole } from "./roles";

/**
 * Immutable, server-built request context (ARCHITECTURE.md §3, TENANCY.md §4).
 * Only `tenancy/request-context.ts` produces instances, from verified memberships.
 * Nothing in it comes from the client except the tenant/project slugs used for lookup.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantMembershipId: string;
  readonly tenantRole: TenantRole;
  readonly projectId: string | null;
  readonly projectSlug: string | null;
  readonly projectMembershipId: string | null;
  readonly projectRole: ProjectRole | null;
  /** True when project access comes from OWNER implicit access (D-015), which is audited. */
  readonly implicitOwnerProjectAccess: boolean;
  readonly permissions: ReadonlySet<Permission>;
  readonly capabilities: CapabilitySet;
  readonly locale: string;
}

/** Context for background jobs: same shape, actor may be the system. */
export interface JobContext extends Omit<RequestContext, "requestId"> {
  readonly runId: string;
  readonly actor: "system" | { readonly userId: string };
}

export function freezeContext<T extends object>(ctx: T): Readonly<T> {
  return Object.freeze(ctx);
}
