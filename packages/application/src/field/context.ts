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
 */
export function withFieldContext<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return withDbContext(db, { ...ctx, fieldResponsesAccess: can(ctx, "field.responses.read") }, fn);
}

/** Whether this caller reads the project's responses, or only their own. */
export function readsAllFieldResponses(ctx: RequestContext): boolean {
  return can(ctx, "field.responses.read");
}
