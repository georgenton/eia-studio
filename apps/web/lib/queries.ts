import "server-only";

import { withDbContext } from "@eia/db";
import { FIELD_OFFLINE_MODE_KEY, type RequestContext } from "@eia/domain";
import { sql } from "drizzle-orm";

import { getDb } from "./db";

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
