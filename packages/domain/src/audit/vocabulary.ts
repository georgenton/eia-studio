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
  // Preparing a project, and the one column that moves it out of planning (ADR-030).
  "project.intake.updated",
  "project.activated",
  // An upload is authorised once and proved once (ADR-031). Neither line carries a filename: an
  // audit entry is read by more people than the row is, and a filename can name a person.
  "storage.upload.intent_issued",
  "storage.upload.finalized",
  "document.version.uploaded",
  "document.version.extracted",
  /**
   * A short-lived link to an original file was minted (ADR-034).
   *
   * SECURITY.md §9 already requires auditing "presigned URL issuance for PII objects", and a
   * delivered study is exactly that kind of object — its `privacy_classification` is a claim
   * somebody made, and `REVIEW_REQUIRED` means nobody has looked. So every issuance is recorded,
   * not only the ones somebody declared sensitive.
   */
  "document.version.download_issued",
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
  /*
   * Writing a questionnaire inside the product (ADR-037). Two lines, for the two moments that
   * matter: a new definition was opened for editing, and somebody decided households may be asked
   * it. Saving a draft is not audited — a draft is a document being written, and a row per
   * keystroke is noise nobody reads; what the draft finally said is what publication records.
   *
   * Neither line carries a prompt, an option's words or a section heading: a questionnaire's text
   * lives on the version, once, and a second copy here would be a second thing to keep in step.
   */
  "field.survey.drafted",
  "field.survey.published",
  "field.survey.submitted",
  "field.media.declared",
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
  /*
   * AI document review (Wave 3, ADR-035). Three moments, and the first is the one the compliance
   * review will ask about: **passages of this project's documents left for a model**. The line
   * records the lens, how many versions were in the corpus, the adapter, the model and whether
   * the call was live — never a passage, never a candidate's words, never a document's filename.
   *
   * `refused` is audited too, and deliberately: a run stopped by the privacy gate is a decision
   * the product made about somebody's data, and a refusal that left no trace would be
   * indistinguishable from a run nobody attempted.
   */
  "documents.review.run_started",
  "documents.review.run_refused",
  "documents.review.candidate_decided",
  /*
   * The template library (Wave 3, ADR-036). Three moments: a firm's own `.docx` was registered as
   * a version, somebody decided documents may be produced from it, and one was produced.
   *
   * Never the filename — a template is named by whoever wrote it, and an audit line is read by
   * more people than the row is (ADR-031 §1). Never the rendered bytes, and never a value the
   * document printed.
   */
  "templates.version.uploaded",
  "templates.version.activated",
  "templates.document.generated",
  "templates.document.download_issued",
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
