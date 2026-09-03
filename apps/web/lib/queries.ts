import "server-only";

import { withDbContext } from "@eia/db";
import {
  FIELD_OFFLINE_MODE_KEY,
  type RequestContext,
  type TenantCapabilitySettings,
} from "@eia/domain";
import { loadTenantCapabilitySettings } from "@eia/application";
import { sql } from "drizzle-orm";

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

/**
 * The project's offline-capture policy, read from `project_configuration`.
 *
 * Returns the raw stored value; `readFieldOfflineMode` in the domain parses it and falls back to
 * the registry default. A missing row is the ordinary case for a project that never chose.
 */
export async function getProjectConfiguration(ctx: RequestContext): Promise<string | null> {
  if (ctx.projectId === null) return null;
  return withDbContext(getDb(), ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select value from app.project_configuration
      where tenant_id = ${ctx.tenantId} and project_id = ${ctx.projectId}
        and key = ${FIELD_OFFLINE_MODE_KEY}
      limit 1
    `);
    return (rows.rows[0] as unknown as { value: string } | undefined)?.value ?? null;
  });
}
