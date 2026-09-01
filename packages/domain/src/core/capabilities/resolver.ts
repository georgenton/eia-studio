import { FeatureDisabled } from "../errors";
import { CAPABILITY_CATALOG, CAPABILITY_KEYS, type CapabilityKey } from "./catalog";

/** Tenant-level state per key: entitlement (plan/contract) and the tenant toggle. */
export interface TenantCapabilityState {
  readonly entitled: boolean;
  readonly enabled: boolean;
}

/** Project-level override per key: only restriction is meaningful (absence = enabled). */
export interface ProjectCapabilityState {
  readonly enabled: boolean;
}

export type TenantCapabilitySettings = ReadonlyMap<CapabilityKey, TenantCapabilityState>;
export type ProjectCapabilitySettings = ReadonlyMap<CapabilityKey, ProjectCapabilityState>;

/** Boolean effective capabilities (Gate 1 D-014). The only value authorization consults. */
export type CapabilitySet = Readonly<Record<CapabilityKey, boolean>>;

/** Shell-only presentation (never used for authorization). */
export type NavigationPresentation = "ACTIVE" | "ANNOUNCED" | "HIDDEN";

export interface ResolveInput {
  readonly tenant: TenantCapabilitySettings;
  /** Absent when resolving at tenant scope (Portfolio, Tenant Settings). */
  readonly project?: ProjectCapabilitySettings | undefined;
}

function tenantAllows(input: ResolveInput, key: CapabilityKey): boolean {
  const state = input.tenant.get(key);
  return state !== undefined && state.entitled && state.enabled;
}

function projectAllows(input: ResolveInput, key: CapabilityKey): boolean {
  if (!input.project) return true;
  const state = input.project.get(key);
  return state === undefined ? true : state.enabled;
}

/**
 * effective(cap) = PRODUCT_AVAILABLE ∧ TENANT_ENTITLED ∧ TENANT_ENABLED ∧ PROJECT_ENABLED
 *                  ∧ ∀ d ∈ dependsOn(cap): effective(d)
 * A project override can never enable what the tenant lacks: the AND makes a corrupted row
 * harmless, and `assertProjectOverrideAllowed` rejects it at write time as well.
 */
export function resolveCapabilities(input: ResolveInput): CapabilitySet {
  const memo = new Map<CapabilityKey, boolean>();
  const visiting = new Set<CapabilityKey>();

  const effective = (key: CapabilityKey): boolean => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) throw new Error(`capability dependency cycle at ${key}`);
    visiting.add(key);
    const def = CAPABILITY_CATALOG[key];
    const value =
      def.productStatus === "AVAILABLE" &&
      tenantAllows(input, key) &&
      projectAllows(input, key) &&
      def.dependsOn.every((dep) => effective(dep));
    visiting.delete(key);
    memo.set(key, value);
    return value;
  };

  const result = {} as Record<CapabilityKey, boolean>;
  for (const key of CAPABILITY_KEYS) result[key] = effective(key);
  return Object.freeze(result);
}

/** Shell-only: ANNOUNCED is shown as a non-navigable placeholder; it is disabled for authorization. */
export function navigationPresentation(
  key: CapabilityKey,
  capabilities: CapabilitySet,
  tenant: TenantCapabilitySettings,
): NavigationPresentation {
  if (capabilities[key]) return "ACTIVE";
  const def = CAPABILITY_CATALOG[key];
  const state = tenant.get(key);
  if (def.productStatus === "ANNOUNCED" && state?.entitled && state.enabled) return "ANNOUNCED";
  return "HIDDEN";
}

/** Write-time guard: a project may restrict but never widen (FEATURES.md §3). */
export function assertProjectOverrideAllowed(
  tenant: TenantCapabilitySettings,
  key: CapabilityKey,
  enabled: boolean,
): void {
  if (!enabled) return;
  const state = tenant.get(key);
  if (!state || !state.entitled || !state.enabled) {
    throw new FeatureDisabled({
      capability: key,
      whoCanEnable: CAPABILITY_CATALOG[key].whoCanEnable,
    });
  }
}

/** Every server entry point calls this with the context's CapabilitySet (ADR-002). */
export function requireCapability(
  ctx: { readonly capabilities: CapabilitySet },
  key: CapabilityKey,
): void {
  if (!ctx.capabilities[key]) {
    throw new FeatureDisabled({
      capability: key,
      whoCanEnable: CAPABILITY_CATALOG[key].whoCanEnable,
    });
  }
}

export function emptyCapabilitySet(): CapabilitySet {
  const result = {} as Record<CapabilityKey, boolean>;
  for (const key of CAPABILITY_KEYS) result[key] = false;
  return Object.freeze(result);
}
