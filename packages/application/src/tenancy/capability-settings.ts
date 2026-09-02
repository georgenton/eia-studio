import { appSchema, type DbTx } from "@eia/db";
import {
  getSystemProfile,
  isCapabilityKey,
  profileCapabilityDefaults,
  type CapabilityKey,
  type ProjectCapabilityOverrides,
  type ProjectProfileDefaults,
  type TenantCapabilitySettings,
} from "@eia/domain";
import { and, eq } from "drizzle-orm";

/** Tenant entitlement and toggle rows, in the resolver's input shape (RLS-scoped tx). */
export async function loadTenantCapabilitySettings(
  tx: DbTx,
  tenantId: string,
): Promise<TenantCapabilitySettings> {
  const rows = await tx
    .select({
      key: appSchema.tenantCapability.capabilityKey,
      entitled: appSchema.tenantCapability.entitled,
      enabled: appSchema.tenantCapability.enabled,
    })
    .from(appSchema.tenantCapability)
    .where(eq(appSchema.tenantCapability.tenantId, tenantId));
  const map = new Map<CapabilityKey, { entitled: boolean; enabled: boolean }>();
  for (const row of rows) {
    if (isCapabilityKey(row.key))
      map.set(row.key, { entitled: row.entitled, enabled: row.enabled });
  }
  return map;
}

/**
 * Explicit project overrides. An override row may be `true` or `false` (IG0-H02): it is the
 * project's decision layer, applied on top of the profile default and under the tenant ceiling.
 */
export async function loadProjectCapabilityOverrides(
  tx: DbTx,
  tenantId: string,
  projectId: string,
): Promise<ProjectCapabilityOverrides> {
  const rows = await tx
    .select({
      key: appSchema.projectCapabilitySetting.capabilityKey,
      enabled: appSchema.projectCapabilitySetting.enabled,
    })
    .from(appSchema.projectCapabilitySetting)
    .where(
      and(
        eq(appSchema.projectCapabilitySetting.tenantId, tenantId),
        eq(appSchema.projectCapabilitySetting.projectId, projectId),
      ),
    );
  const map = new Map<CapabilityKey, boolean>();
  for (const row of rows) {
    if (isCapabilityKey(row.key)) map.set(row.key, row.enabled);
  }
  return map;
}

/**
 * Profile defaults from the project's profile snapshot (`profile_key`). An unknown profile key
 * contributes no defaults; the tenant ceiling still applies, so this cannot widen access.
 */
export function projectProfileDefaults(profileKey: string): ProjectProfileDefaults {
  const profile = getSystemProfile(profileKey);
  return profile ? profileCapabilityDefaults(profile) : new Map();
}
