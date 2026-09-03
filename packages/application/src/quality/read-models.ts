import { withDbContext, type Database, type DbTx } from "@eia/db";
import {
  availableDecisions,
  evidenceLocatorSchema,
  NotFound,
  requireCapability,
  requirementByKey,
  requirePermission,
  type EvidenceLocator,
  type EvidenceRole,
  type FindingDecision,
  type FindingSeverity,
  type FindingState,
  type FindingType,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * What the Quality Gate surface reads.
 *
 * Everything here requires `quality.read` and the capability, and returns only what the caller's
 * RLS context already permits. Two shaping decisions worth naming:
 *
 * - **the list is ordered by whether it needs attention, then by severity, then by age** — not by
 *   creation order. A queue whose top row is the oldest thing rather than the most pressing is a
 *   queue people stop opening;
 * - **evidence comes back with its locator parsed and validated**. A locator that no longer
 *   matches the schema is dropped with its finding still readable, rather than throwing: a
 *   malformed row from a future migration should degrade one evidence item, not the surface.
 */
export interface FindingSummary {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly type: FindingType;
  readonly severity: FindingSeverity;
  readonly state: FindingState;
  readonly requirementKey: string;
  readonly requirementVersion: string;
  readonly interdisciplinary: boolean;
  readonly detectedAt: string;
  readonly updatedAt: string;
  readonly parcelCode: string | null;
}

export interface FindingEvidenceItem {
  readonly role: EvidenceRole;
  readonly label: string;
  readonly quote: string;
  readonly locator: EvidenceLocator | null;
  /** The human-readable source, when the locator names one. Shown under the quote. */
  readonly sourceRef: string | null;
  /**
   * The ingested passage this evidence was transcribed from, once the document exists in the
   * system (Slice 6).
   *
   * **Resolved at read time, through the assertion.** A finding raised before ingestion gains a
   * document link the moment its assertion acquires one, without a single row of that finding being
   * rewritten — which is what ADR-020 §6 promised: enrichment, not revision.
   */
  readonly documentRef: {
    readonly code: string;
    readonly title: string;
    readonly versionLabel: string;
    readonly chunkOrdinal: number | null;
    readonly page: number | null;
  } | null;
}

export interface FindingReviewEntry {
  readonly decision: FindingDecision;
  readonly fromState: FindingState;
  readonly toState: FindingState;
  readonly justification: string;
  readonly reviewerName: string | null;
  readonly reviewedAt: string;
}

export interface FindingDetail extends FindingSummary {
  readonly explanation: string;
  readonly whyFlagged: string;
  readonly suggestedAction: string;
  readonly evidence: ReadonlyArray<FindingEvidenceItem>;
  readonly reviews: ReadonlyArray<FindingReviewEntry>;
  readonly availableDecisions: ReadonlyArray<FindingDecision>;
  readonly provenanceId: string;
}

export interface QualityOverview {
  readonly findings: ReadonlyArray<FindingSummary>;
  readonly counts: {
    readonly open: number;
    readonly underReview: number;
    readonly accepted: number;
    readonly dismissed: number;
    readonly resolved: number;
    readonly high: number;
  };
  readonly lastRun: {
    readonly id: string;
    readonly finishedAt: string | null;
    readonly created: number;
    readonly updated: number;
    readonly reopened: number;
    readonly requirements: ReadonlyArray<string>;
  } | null;
  /**
   * The rules that exist, whether or not any of them fired. Shown so a specialist knows what was
   * checked — a Quality Gate that only lists its findings cannot be distinguished from one that
   * never ran.
   */
  readonly requirements: ReadonlyArray<{
    readonly key: string;
    readonly version: string;
    readonly title: string;
    readonly what: string;
  }>;
}

/**
 * `tx.execute` returns raw driver rows, so a timestamp arrives as a string rather than a `Date`.
 * One normaliser, because the alternative is a `toISOString is not a function` at render time on
 * whichever column somebody forgets.
 */
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const ORDER = sql`
  case state when 'OPEN' then 0 when 'UNDER_REVIEW' then 1 when 'ACCEPTED' then 2
             when 'RESOLVED' then 3 else 4 end,
  case severity when 'high' then 0 when 'medium' then 1 else 2 end,
  detected_at
`;

export async function loadQualityOverview(
  db: Database,
  ctx: RequestContext,
): Promise<QualityOverview> {
  requireCapability(ctx, "quality.document_gate");
  requirePermission(ctx, "quality.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const findings = await tx.execute(sql`
      select f.id, f.finding_code, f.title, f.type::text as type, f.severity::text as severity,
             f.state::text as state, f.requirement_key, f.requirement_version,
             f.interdisciplinary_review_required, f.detected_at, f.updated_at,
             p.parcel_code
        from app.quality_finding f
        left join app.parcel p on p.tenant_id = f.tenant_id and p.id = f.parcel_id
       where f.tenant_id = ${ctx.tenantId} and f.project_id = ${projectId}
       order by ${ORDER}
    `);

    const counts = await tx.execute(sql`
      select
        count(*) filter (where state = 'OPEN')::int as open,
        count(*) filter (where state = 'UNDER_REVIEW')::int as under_review,
        count(*) filter (where state = 'ACCEPTED')::int as accepted,
        count(*) filter (where state = 'DISMISSED')::int as dismissed,
        count(*) filter (where state = 'RESOLVED')::int as resolved,
        count(*) filter (where severity = 'high' and state in ('OPEN','UNDER_REVIEW'))::int as high
        from app.quality_finding
       where tenant_id = ${ctx.tenantId} and project_id = ${projectId}
    `);

    const runs = await tx.execute(sql`
      select id, finished_at, findings_created, findings_updated, findings_reopened, requirements
        from app.quality_run
       where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and status = 'COMPLETED'
       order by created_at desc limit 1
    `);
    const run = runs.rows[0] as
      | {
          id: string;
          finished_at: Date | string | null;
          findings_created: number;
          findings_updated: number;
          findings_reopened: number;
          requirements: string[];
        }
      | undefined;

    const c = counts.rows[0] as Record<string, number>;
    return {
      findings: (findings.rows as unknown as FindingRow[]).map(toSummary),
      counts: {
        open: c.open ?? 0,
        underReview: c.under_review ?? 0,
        accepted: c.accepted ?? 0,
        dismissed: c.dismissed ?? 0,
        resolved: c.resolved ?? 0,
        high: c.high ?? 0,
      },
      lastRun: run
        ? {
            id: run.id,
            finishedAt: run.finished_at ? iso(run.finished_at) : null,
            created: run.findings_created,
            updated: run.findings_updated,
            reopened: run.findings_reopened,
            requirements: run.requirements,
          }
        : null,
      requirements: requirementCatalogue(),
    };
  });
}

export async function loadFindingDetail(
  db: Database,
  ctx: RequestContext,
  findingCode: string,
): Promise<FindingDetail> {
  requireCapability(ctx, "quality.document_gate");
  requirePermission(ctx, "quality.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const found = await tx.execute(sql`
      select f.id, f.finding_code, f.title, f.type::text as type, f.severity::text as severity,
             f.state::text as state, f.requirement_key, f.requirement_version,
             f.interdisciplinary_review_required, f.detected_at, f.updated_at,
             f.explanation, f.why_flagged, f.suggested_action, f.provenance_id,
             p.parcel_code
        from app.quality_finding f
        left join app.parcel p on p.tenant_id = f.tenant_id and p.id = f.parcel_id
       where f.tenant_id = ${ctx.tenantId} and f.project_id = ${projectId}
         and f.finding_code = ${findingCode}
    `);
    const row = found.rows[0] as unknown as
      | (FindingRow & {
          explanation: string;
          why_flagged: string;
          suggested_action: string;
          provenance_id: string;
        })
      | undefined;
    if (!row) throw new NotFound("finding");

    return {
      ...toSummary(row),
      explanation: row.explanation,
      whyFlagged: row.why_flagged,
      suggestedAction: row.suggested_action,
      provenanceId: row.provenance_id,
      evidence: await loadEvidence(tx, ctx.tenantId, row.id),
      reviews: await loadReviews(tx, ctx.tenantId, row.id),
      availableDecisions: availableDecisions(row.state as FindingState),
    };
  });
}

async function loadEvidence(
  tx: DbTx,
  tenantId: string,
  findingId: string,
): Promise<ReadonlyArray<FindingEvidenceItem>> {
  // The join is left-outer all the way down: an assertion with no ingested document, or a locator
  // that is not an assertion, yields a null reference and a perfectly readable finding.
  const result = await tx.execute(sql`
    select e.role::text as role, e.label, e.quote, e.locator,
           d.code as document_code, d.title as document_title,
           v.version_label, c.ordinal as chunk_ordinal, c.page_from, c.page_to
      from app.finding_evidence e
      left join app.document_assertion a
        on a.tenant_id = e.tenant_id
       and e.locator->>'kind' = 'assertion'
       and a.id = (e.locator->>'assertionId')::uuid
      left join app.document_version v on v.tenant_id = a.tenant_id and v.id = a.document_version_id
      left join app.source_document d on d.tenant_id = v.tenant_id and d.id = v.document_id
      left join app.document_chunk c on c.tenant_id = a.tenant_id and c.id = a.chunk_id
     where e.tenant_id = ${tenantId} and e.finding_id = ${findingId}
     order by case e.role when 'SOURCE_A' then 0 when 'SOURCE_B' then 1 else 2 end, e.ordinal
  `);
  return (
    result.rows as unknown as Array<{
      role: EvidenceRole;
      label: string;
      quote: string;
      locator: unknown;
      document_code: string | null;
      document_title: string | null;
      version_label: string | null;
      chunk_ordinal: number | null;
      page_from: number | null;
      page_to: number | null;
    }>
  ).map((row) => {
    const parsed = evidenceLocatorSchema.safeParse(row.locator);
    const locator = parsed.success ? parsed.data : null;
    return {
      role: row.role,
      label: row.label,
      quote: row.quote,
      locator,
      sourceRef: locator && locator.kind === "assertion" ? locator.sourceRef : null,
      documentRef:
        row.document_code && row.version_label
          ? {
              code: row.document_code,
              title: row.document_title ?? row.document_code,
              versionLabel: row.version_label,
              chunkOrdinal: row.chunk_ordinal === null ? null : Number(row.chunk_ordinal),
              // A passage spanning two pages cannot honestly name one, so it names none.
              page:
                row.page_from !== null && row.page_from === row.page_to
                  ? Number(row.page_from)
                  : null,
            }
          : null,
    };
  });
}

async function loadReviews(
  tx: DbTx,
  tenantId: string,
  findingId: string,
): Promise<ReadonlyArray<FindingReviewEntry>> {
  const result = await tx.execute(sql`
    select r.decision::text as decision, r.from_state::text as from_state,
           r.to_state::text as to_state, r.justification, r.reviewed_at, u.name as reviewer_name
      from app.specialist_review r
      left join app."user" u on u.id = r.reviewer_user_id
     where r.tenant_id = ${tenantId} and r.finding_id = ${findingId}
     order by r.reviewed_at
  `);
  return (
    result.rows as unknown as Array<{
      decision: FindingDecision;
      from_state: FindingState;
      to_state: FindingState;
      justification: string;
      reviewed_at: Date | string;
      reviewer_name: string | null;
    }>
  ).map((row) => ({
    decision: row.decision,
    fromState: row.from_state,
    toState: row.to_state,
    justification: row.justification,
    reviewerName: row.reviewer_name,
    reviewedAt: iso(row.reviewed_at),
  }));
}

interface FindingRow {
  id: string;
  finding_code: string;
  title: string;
  type: FindingType;
  severity: FindingSeverity;
  state: FindingState;
  requirement_key: string;
  requirement_version: string;
  interdisciplinary_review_required: boolean;
  detected_at: Date | string;
  updated_at: Date | string;
  parcel_code: string | null;
}

function toSummary(row: FindingRow): FindingSummary {
  return {
    id: row.id,
    code: row.finding_code,
    title: row.title,
    type: row.type,
    severity: row.severity,
    state: row.state,
    requirementKey: row.requirement_key,
    requirementVersion: row.requirement_version,
    interdisciplinary: row.interdisciplinary_review_required,
    detectedAt: iso(row.detected_at),
    updatedAt: iso(row.updated_at),
    parcelCode: row.parcel_code,
  };
}

/** Read from the code catalogue, which is where a rule's definition lives (ADR-020). */
function requirementCatalogue(): QualityOverview["requirements"] {
  return [
    "rule.affectation_count",
    "rule.territorial_institution",
    "rule.consultation_planned_vs_actual",
    "rule.vulnerability_conclusion",
    "rule.project_identity",
  ].map((key) => {
    const requirement = requirementByKey(key);
    return {
      key: requirement.key,
      version: requirement.version,
      title: requirement.title,
      what: requirement.what,
    };
  });
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}
