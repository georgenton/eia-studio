import { withDbContext, type Database, type DbTx } from "@eia/db";
import { can, type RequestContext } from "@eia/domain";

/**
 * Every FieldFlow database access goes through here.
 *
 * The reason it exists is one line: `fieldResponsesAccess`. The RLS policies on assignments,
 * visits, responses and answers do not stop at "can this caller see the project" — they also ask
 * whether the caller may see rows that are not their own, and that answer comes from
 * `field.responses.read`.
 *
 * Deriving it in one place means a new read model cannot forget to pass it and quietly get a
 * technician's private view, or worse, be written to pass `true` unconditionally because that
 * made the query return something. The permission is resolved from the verified context, once.
 *
 * `fieldWorkflowAccess` is the same idea for the other half of §3.1's split. The privileged
 * counters of migration 0059 read the project's campaigns and assignments with BYPASSRLS, so what
 * decides whether a caller may have those counts cannot be the row policies — and must not be
 * `has_project_access` either, because a `FIELD_TECHNICIAN` passes that and holds no `field.read`.
 * It is the resolved permission, carried in, exactly like the line above.
 */
export function withFieldContext<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return withDbContext(
    db,
    {
      ...ctx,
      fieldResponsesAccess: can(ctx, "field.responses.read"),
      fieldWorkflowAccess: can(ctx, "field.read"),
    },
    fn,
  );
}

/** Whether this caller reads the project's responses, or only their own. */
export function readsAllFieldResponses(ctx: RequestContext): boolean {
  return can(ctx, "field.responses.read");
}
