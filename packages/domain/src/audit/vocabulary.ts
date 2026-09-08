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
  // FieldFlow (Slice 3). Material workflow events only: the row records *that* a response was
  // submitted, never what it said. Ordinary row mutations are not audited — an event store that
  // mirrors every write is noise nobody reads.
  "field.campaign.activated",
  "field.campaign.closed",
  "field.assignment.reassigned",
  "field.survey.published",
  "field.survey.submitted",
  // Social Intelligence (Slice 4). Two events, for the two moments that matter: text left this
  // system for a model, and a human settled what a response means. Neither row carries a word of
  // what was said — counts, codes and configuration only.
  "social.classification_run.started",
  "social.coding.reviewed",
  // Quality Gate (Slice 5). The run's counts, and the transition a decision produced. Never the
  // justification: a specialist's reasoning about a study lives on the finding, attributed and
  // permanent, and copying it into the audit log would put the same text in two places that can
  // disagree.
  "quality.run.completed",
  "quality.finding.decided",
  // Document intelligence (Slice 6). What was ingested, and that a question was asked of the
  // project's documents. Never the document text and never the question's answer: the passages
  // live in one place with one retention rule, and copying them here would create a second.
  "documents.version.ingested",
  "documents.assistant.asked",
  // Report generation (Slice 7). That a version was produced, from how many facts, and whether a
  // model wrote its prose. Never the chapter's text: the version holds it, immutably, once.
  "reports.version.generated",
  "reports.version.downloaded",
  // The client portal. Publishing is the moment something leaves the firm's own working record
  // and becomes what a customer is told, so it is audited; opening the preview is ordinary
  // reading and is not. The row carries the version and the figure count, never the payload.
  "portal.publication.published",
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
