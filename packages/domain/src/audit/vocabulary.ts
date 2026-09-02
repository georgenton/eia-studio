/**
 * Audit vocabulary and safety rules (SECURITY.md §9). Pure: the domain owns *what* may be
 * recorded; `@eia/application` owns *how* it is written (append-only, same transaction).
 */
export const AUDIT_ACTIONS = [
  "tenant.created",
  "tenant.membership.added",
  "tenant.membership.role_changed",
  "tenant.membership.removed",
  "project.created",
  "project.membership.added",
  "project.membership.removed",
  "capability.tenant.changed",
  "capability.project.changed",
  "access.owner_implicit_project",
  "access.denied",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEvent {
  readonly action: AuditAction;
  readonly objectKind: string;
  readonly objectId: string | null;
  readonly reason?: string | null;
  /** Small, non-sensitive facts (role names, capability keys, booleans). */
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuditActor {
  readonly userId: string | null;
  readonly kind: "user" | "system" | "job";
  readonly requestId: string | null;
}

export interface AuditScope {
  readonly tenantId: string;
  readonly projectId: string | null;
}

const FORBIDDEN_DETAIL_KEYS = /password|secret|token|cookie|authorization|phone|email/i;

export function assertSafeDetails(details: AuditEvent["details"]): void {
  if (!details) return;
  for (const key of Object.keys(details)) {
    if (FORBIDDEN_DETAIL_KEYS.test(key)) {
      throw new Error(`audit details must not contain sensitive key "${key}"`);
    }
  }
}
