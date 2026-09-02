import { FeatureDisabled } from "../errors";
import type { ProjectProfile } from "../profiles/index";
import { CAPABILITY_CATALOG, CAPABILITY_KEYS, type CapabilityKey } from "./catalog";

/** Tenant-level state per key: entitlement (plan/contract) and the tenant toggle. */
export interface TenantCapabilityState {
  readonly entitled: boolean;
  readonly enabled: boolean;
}

export type TenantCapabilitySettings = ReadonlyMap<CapabilityKey, TenantCapabilityState>;

/** Explicit project decision per key; may be `true` or `false`. Absent = fall through. */
export type ProjectCapabilityOverrides = ReadonlyMap<CapabilityKey, boolean>;

/** Defaults copied from the project's profile snapshot. Absent = fall through to enabled. */
export type ProjectProfileDefaults = ReadonlyMap<CapabilityKey, boolean>;

export interface ProjectCapabilityInput {
  readonly overrides?: ProjectCapabilityOverrides | undefined;
  readonly profileDefaults?: ProjectProfileDefaults | undefined;
}

/** Boolean effective capabilities (Gate 1 D-014). The only value authorization consults. */
export type CapabilitySet = Readonly<Record<CapabilityKey, boolean>>;

/** Shell-only presentation (never used for authorization). */
export type NavigationPresentation = "ACTIVE" | "ANNOUNCED" | "HIDDEN";

export interface ResolveInput {
  readonly tenant: TenantCapabilitySettings;
  /** Absent when resolving at tenant scope (Portfolio, Tenant Settings). */
  readonly project?: ProjectCapabilityInput | undefined;
}

/** TENANT_ALLOWED = entitled (plan) ∧ enabled (Tenant Settings › Módulos toggle). */
function tenantAllows(input: ResolveInput, key: CapabilityKey): boolean {
  const state = input.tenant.get(key);
  return state !== undefined && state.entitled && state.enabled;
}

/**
 * PROJECT_EFFECTIVE_ENABLED = explicit override ?? profile default ?? enabled.
 * A project may enable or disable a tenant-entitled capability; it can never widen beyond the
 * product and tenant layers, because those are separate conjuncts (IG0-H02).
 */
function projectEffectiveEnabled(input: ResolveInput, key: CapabilityKey): boolean {
  if (!input.project) return true;
  const override = input.project.overrides?.get(key);
  if (override !== undefined) return override;
  const profileDefault = input.project.profileDefaults?.get(key);
  if (profileDefault !== undefined) return profileDefault;
  return true;
}

/**
 * effective(cap) = PRODUCT_AVAILABLE ∧ TENANT_ALLOWED ∧ PROJECT_EFFECTIVE_ENABLED
 *                  ∧ ∀ d ∈ dependsOn(cap): effective(d)
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
      projectEffectiveEnabled(input, key) &&
      def.dependsOn.every((dep) => effective(dep));
    visiting.delete(key);
    memo.set(key, value);
    return value;
  };

  const result = {} as Record<CapabilityKey, boolean>;
  for (const key of CAPABILITY_KEYS) result[key] = effective(key);
  return Object.freeze(result);
}

/** Profile snapshot → default per key (enabled list → true, disabled list → false). */
export function profileCapabilityDefaults(profile: ProjectProfile): ProjectProfileDefaults {
  const map = new Map<CapabilityKey, boolean>();
  for (const key of profile.capabilities.enabled) map.set(key, true);
  for (const key of profile.capabilities.disabled) map.set(key, false);
  return map;
}

/** Shell-only: ANNOUNCED is a non-navigable placeholder; it is disabled for authorization. */
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

/**
 * Write-time guard: a project override of `true` is rejected when the product or the tenant does
 * not allow the capability. Setting `false` is always permitted (FEATURES.md §3).
 */
export function assertProjectOverrideAllowed(
  tenant: TenantCapabilitySettings,
  key: CapabilityKey,
  enabled: boolean,
): void {
  if (!enabled) return;
  const state = tenant.get(key);
  const productAvailable = CAPABILITY_CATALOG[key].productStatus === "AVAILABLE";
  if (!productAvailable || !state || !state.entitled || !state.enabled) {
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
