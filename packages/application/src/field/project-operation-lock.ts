import { type DbTx } from "@eia/db";
import { sql } from "drizzle-orm";

/**
 * Serialise the decisions that are about *the project's* current operation.
 *
 * Two of them cannot be made concurrently and neither is protected by a constraint. Opening a
 * campaign reads "is there already an identical draft?" and then inserts; activating one reads
 * "is another campaign active?" and then updates. In both, two transactions can read the world
 * before either writes to it, and come to the same conclusion.
 *
 * `SELECT ... FOR UPDATE` over the campaigns themselves does not help: it locks the rows it
 * returns, and the dangerous case is the one where it returns **none**, or returns different
 * rows to each caller. So the lock is taken on the row every such decision shares — the project —
 * and taken *before* anything is read, so the second transaction waits and then sees what the
 * first committed.
 *
 * It is a row lock inside the caller's own transaction, on the runtime role, under RLS: a project
 * the caller cannot see returns no row and the caller gets no lock. Not an advisory lock, which
 * would be a second namespace to reason about; not a mutex in Node, which would be one process
 * pretending to speak for all of them; and not a new table.
 */
export async function lockProjectForOperationChange(
  tx: DbTx,
  tenantId: string,
  projectId: string,
): Promise<void> {
  const locked = await tx.execute<{ id: string }>(
    sql`select id from app.project
         where tenant_id = ${tenantId} and id = ${projectId}
         for update`,
  );
  if ((locked.rows ?? []).length === 0) {
    // Under RLS this is what a project the caller cannot reach looks like. The use-cases above
    // have already resolved it, so arriving here means the context and the payload disagree.
    throw new Error("project operation lock: the project is not reachable in this context");
  }
}
