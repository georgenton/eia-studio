import "server-only";

import { withDbContext } from "@eia/db";
import {
  loadTenantCapabilitySettings,
  type RequestContext,
  type TenantCapabilitySettings,
} from "@eia/domain";

import { getDb } from "./db";

/** Tenant capability rows for the shell's navigation presentation (never for authorization). */
export function getTenantCapabilitySettings(
  ctx: RequestContext,
): Promise<TenantCapabilitySettings> {
  return withDbContext(
    getDb(),
    { userId: ctx.userId, tenantId: ctx.tenantId, projectId: null },
    (tx) => loadTenantCapabilitySettings(tx, ctx.tenantId),
  );
}
