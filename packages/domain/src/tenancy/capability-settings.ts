import { appSchema, type DbTx } from "@eia/db";
import { and, eq } from "drizzle-orm";

import {
  isCapabilityKey,
  type CapabilityKey,
  type ProjectCapabilitySettings,
  type TenantCapabilitySettings,
} from "../core/capabilities/index";

/** Load tenant-level capability rows into the resolver's input shape (RLS-scoped tx). */
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

export async function loadProjectCapabilitySettings(
  tx: DbTx,
  tenantId: string,
  projectId: string,
): Promise<ProjectCapabilitySettings> {
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
  const map = new Map<CapabilityKey, { enabled: boolean }>();
  for (const row of rows) {
    if (isCapabilityKey(row.key)) map.set(row.key, { enabled: row.enabled });
  }
  return map;
}
