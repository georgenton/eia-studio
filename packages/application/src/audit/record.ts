import { auditSchema, type DbTx } from "@eia/db";
import { assertSafeDetails, type AuditActor, type AuditEvent, type AuditScope } from "@eia/domain";

/**
 * Write one audit row inside the caller's transaction (SECURITY.md §9). The vocabulary and the
 * "no sensitive values" rule live in the domain (`assertSafeDetails`); only the persistence lives
 * here, which is why this function is in the application layer and not in `@eia/domain`.
 */
export async function recordAudit(
  tx: DbTx,
  scope: AuditScope,
  actor: AuditActor,
  event: AuditEvent,
): Promise<void> {
  assertSafeDetails(event.details);
  await tx.insert(auditSchema.log).values({
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    actorUserId: actor.userId,
    actorKind: actor.kind,
    action: event.action,
    objectKind: event.objectKind,
    objectId: event.objectId,
    reason: event.reason ?? null,
    requestId: actor.requestId,
    details: event.details ?? {},
  });
}
