import { qualitySchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  detectAffectationCount,
  detectPlannedVsActual,
  detectPgasPlaceVsInfluenceArea,
  detectProjectIdentity,
  detectTerritorialInstitution,
  detectVulnerabilityConclusion,
  NotFound,
  QUALITY_REQUIREMENTS,
  requireCapability,
  requirementByKey,
  requirePermission,
  type DetectedFinding,
  type Evidence,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { recordAudit } from "../audit/record";

/**
 * Executing the rule set over one project.
 *
 * ## Why a re-run updates rather than re-raises
 *
 * The whole value of the Quality Gate is that a specialist's decision survives. A run that raised
 * a fresh row every time would turn one real disagreement into a growing pile and quietly undo
 * every dismissal — after which nobody would trust the queue. So a run matches on `fingerprint`
 * (rule + version + what was compared, never the values) and:
 *
 * - **new** → insert `OPEN` with a project-scoped `QG-NNN` code;
 * - **still present, still open** → refresh the text, the evidence and `last_seen_at`;
 * - **still present, but decided** → refresh the same way and *leave the state alone*. A dismissed
 *   finding that the rule still detects stays dismissed: a person looked at it and said no, and a
 *   scheduled job is not entitled to overrule that. Only new evidence — a value that changed —
 *   reopens it, and even then it reopens as `OPEN` with the history intact.
 *
 * ## Why nothing is written when a rule cannot read its inputs
 *
 * A rule whose assertion is missing from the corpus produces **no finding**, not a
 * `MISSING_EVIDENCE` one. "The document does not say" and "we could not find where it says it" are
 * different claims, and the second is about us. Missing inputs are counted on the run and shown as
 * skipped rules.
 */
export interface QualityRunResult {
  readonly runId: string;
  readonly created: number;
  readonly updated: number;
  readonly reopened: number;
  readonly skipped: ReadonlyArray<{ readonly requirementKey: string; readonly reason: string }>;
}

interface AssertionRow {
  readonly id: string;
  readonly key: string;
  readonly source_ref: string;
  readonly value_text: string | null;
  readonly value_number: string | null;
  readonly value_date: string | null;
  readonly value_boolean: boolean | null;
  readonly quote: string | null;
  readonly qualifier: string | null;
}

/** Quality data is project data: ordinary project access, no `field.responses.read` conjunct. */
function withQualityContext<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return withDbContext(db, ctx, fn);
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

/**
 * Run every applicable rule and reconcile the findings.
 *
 * Synchronous rather than a background job, deliberately: the five pilot rules are four SQL counts
 * and a handful of comparisons, and a run that finishes inside a request is one a specialist can
 * actually use ("Ejecutar revisión" → the list updates). When a rule set grows to something that
 * reads documents, it becomes a `QualityRun` job with the same row and the same reconciliation —
 * the table already carries `status`, `started_at` and `finished_at` for that day.
 */
export async function runQualityCheck(
  db: Database,
  ctx: RequestContext,
): Promise<QualityRunResult> {
  requireCapability(ctx, "quality.document_gate");
  requirePermission(ctx, "quality.write");
  const projectId = requireProject(ctx);

  return withQualityContext(db, ctx, async (tx) => {
    const runId = randomUUID();
    const provenanceId = await createQualityProvenance(tx, ctx, projectId, {
      title: "Revisión de calidad documental",
      note:
        "Hallazgos producidos por reglas deterministas sobre el expediente reconstruido y los " +
        "datos operativos del proyecto. Cada hallazgo señala una discrepancia entre dos fuentes; " +
        "la decisión sobre cuál rige es de un especialista.",
      method: `Reglas ${QUALITY_REQUIREMENTS.map((r) => `${r.key}@${r.version}`).join(" · ")}`,
    });

    await tx.insert(qualitySchema.qualityRun).values({
      id: runId,
      tenantId: ctx.tenantId,
      projectId,
      trigger: "MANUAL",
      requirements: QUALITY_REQUIREMENTS.map((r) => `${r.key}@${r.version}`),
      status: "RUNNING",
      startedAt: new Date(),
      initiatedByUserId: ctx.userId,
      provenanceId,
    });

    const assertions = await loadAssertions(tx, ctx.tenantId, projectId);
    const project = await loadProjectFacts(tx, ctx.tenantId, projectId);
    const skipped: Array<{ requirementKey: string; reason: string }> = [];
    const detected: DetectedFinding[] = [];

    for (const detection of detectAll(assertions, project, skipped)) detected.push(detection);

    let created = 0;
    let updated = 0;
    let reopened = 0;
    for (const finding of detected) {
      const outcome = await reconcile(tx, ctx, projectId, runId, finding, provenanceId);
      if (outcome === "created") created += 1;
      else if (outcome === "reopened") reopened += 1;
      else updated += 1;
    }

    await tx.execute(sql`
      update app.quality_run
         set status = 'COMPLETED', finished_at = now(),
             findings_created = ${created}, findings_updated = ${updated},
             findings_reopened = ${reopened}
       where tenant_id = ${ctx.tenantId} and id = ${runId}
    `);

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "quality.run.completed",
        objectKind: "quality_run",
        objectId: runId,
        details: {
          created,
          updated,
          reopened,
          skipped: skipped.map((s) => s.requirementKey).join(", "),
        },
      },
    );

    return { runId, created, updated, reopened, skipped };
  });
}

/**
 * Every rule, in one place, each guarded by whether its inputs exist.
 *
 * The guards read verbosely on purpose: a rule that silently receives `undefined` and compares it
 * against a real value is how a finding about nothing gets raised, and a finding about nothing is
 * the failure mode that costs this module its credibility.
 */
function* detectAll(
  assertions: AssertionLookup,
  project: ProjectFacts,
  skipped: Array<{ requirementKey: string; reason: string }>,
): Generator<DetectedFinding> {
  const skip = (key: string, reason: string) => {
    skipped.push({ requirementKey: key, reason });
  };

  // QG · affected-parcel count: two documents of the same expediente, not document versus layer.
  // The pilot's parcel layer is synthetic geometry; comparing a historical figure against it would
  // be a number-shaped finding about nothing.
  const declaredAffected = assertions.all("parcels.affected_count");
  if (declaredAffected.length < 2) {
    skip(
      "rule.affectation_count",
      "el expediente declara el número de predios afectados en una sola fuente",
    );
  } else {
    const [first, second] = declaredAffected as [AssertionRow, AssertionRow];
    if (!first.value_number || !second.value_number) {
      skip("rule.affectation_count", "alguna de las cifras declaradas no es un número");
    } else {
      const finding = detectAffectationCount({
        first: {
          value: Number(first.value_number),
          sourceRef: first.source_ref,
          assertionId: first.id,
        },
        second: {
          value: Number(second.value_number),
          sourceRef: second.source_ref,
          assertionId: second.id,
        },
      });
      if (finding) yield finding;
    }
  }

  // QG · territorial institution: a jurisdiction the corpus itself states.
  const institution = assertions.one("document.institution_mentioned");
  if (!institution?.value_text || !institution.qualifier) {
    skip(
      "rule.territorial_institution",
      "el expediente no registra una institución con su jurisdicción",
    );
  } else {
    const finding = detectTerritorialInstitution({
      mentioned: {
        name: institution.value_text,
        jurisdiction: institution.qualifier,
        sourceRef: institution.source_ref,
        assertionId: institution.id,
        quote: institution.quote ?? institution.value_text,
      },
      projectJurisdiction: project.jurisdiction,
    });
    if (finding) yield finding;
  }

  // QG · consultation planned versus actual.
  const planned = assertions.one("consultation.planned_date");
  const actual = assertions.one("consultation.actual_date");
  if (!planned?.value_date || !actual?.value_date) {
    skip("rule.consultation_planned_vs_actual", "faltan la fecha planificada o la realizada");
  } else {
    const finding = detectPlannedVsActual({
      event: "asamblea de consulta",
      planned: { date: planned.value_date, sourceRef: planned.source_ref, assertionId: planned.id },
      actual: { date: actual.value_date, sourceRef: actual.source_ref, assertionId: actual.id },
    });
    if (finding) yield finding;
  }

  // QG · the legal conclusion against the social chapter, both from the corpus. Never against
  // survey records: a vulnerability indicator on a household is special-category personal data
  // and the demo questionnaire is built to collect none (SECURITY.md §10b).
  const conclusion = assertions.one("social.no_vulnerable_groups");
  const reported = assertions.one("social.vulnerable_cases_reported");
  if (conclusion?.value_boolean === null || conclusion?.value_boolean === undefined) {
    skip(
      "rule.vulnerability_conclusion",
      "el expediente no registra una conclusión sobre grupos vulnerables",
    );
  } else if (!reported?.value_number) {
    skip("rule.vulnerability_conclusion", "el capítulo social no reporta un número de casos");
  } else {
    const finding = detectVulnerabilityConclusion({
      conclusion: {
        assertsNone: conclusion.value_boolean,
        sourceRef: conclusion.source_ref,
        assertionId: conclusion.id,
        quote: conclusion.quote ?? "",
      },
      reportedCases: {
        value: Number(reported.value_number),
        sourceRef: reported.source_ref,
        assertionId: reported.id,
        quote: reported.quote ?? `${reported.value_number} caso(s)`,
      },
    });
    if (finding) yield finding;
  }

  // QG · the management plan against the cartography: a plan that says where it applies, and a
  // map that does or does not delimit that area. The one cross-document check this chapter
  // supports (ADR-024 §5); it closes TD-072.
  if (project.pgasPlaces.length === 0) {
    skip(
      "rule.pgas_place_vs_influence_area",
      "ningún plan del capítulo declara un lugar de aplicación",
    );
  } else {
    for (const plan of project.pgasPlaces) {
      const finding = detectPgasPlaceVsInfluenceArea({
        plan,
        influenceAreaKinds: project.influenceAreaKinds,
        influenceAreaLabels: project.influenceAreaLabels,
      });
      if (finding) yield finding;
    }
  }

  // QG · project identity: the location the corpus states against the project record.
  const statedLocation = assertions.one("project.location_label");
  if (!statedLocation?.value_text) {
    skip("rule.project_identity", "el expediente no declara la ubicación del proyecto");
  } else {
    const finding = detectProjectIdentity({
      stated: {
        field: "Ubicación",
        value: statedLocation.value_text,
        sourceRef: statedLocation.source_ref,
        assertionId: statedLocation.id,
      },
      projectValue: project.locationLabel,
      projectField: "locationLabel",
    });
    if (finding) yield finding;
  }
}

/**
 * Insert, refresh, or refresh-without-touching-the-state.
 *
 * Evidence is replaced wholesale rather than diffed: it is derived entirely from the detection, so
 * a diff would be work in service of nothing. The deferred constraint trigger checks the pair at
 * commit, which is why the delete and the inserts can sit between each other safely.
 */
async function reconcile(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  runId: string,
  finding: DetectedFinding,
  provenanceId: string,
): Promise<"created" | "updated" | "reopened"> {
  const requirement = requirementByKey(finding.requirementKey);

  const existing = await tx.execute(sql`
    select id, state::text as state, explanation
      from app.quality_finding
     where tenant_id = ${ctx.tenantId} and project_id = ${projectId}
       and fingerprint = ${finding.fingerprint}
     for update
  `);
  const row = existing.rows[0] as { id: string; state: string; explanation: string } | undefined;

  if (!row) {
    const findingId = randomUUID();
    await tx.insert(qualitySchema.qualityFinding).values({
      id: findingId,
      tenantId: ctx.tenantId,
      projectId,
      findingCode: await nextFindingCode(tx, ctx.tenantId, projectId),
      fingerprint: finding.fingerprint,
      firstRunId: runId,
      lastRunId: runId,
      requirementKey: finding.requirementKey,
      requirementVersion: finding.requirementVersion,
      type: requirement.type,
      severity: finding.severity,
      state: "OPEN",
      title: finding.title,
      explanation: finding.explanation,
      whyFlagged: requirement.whyFlagged,
      suggestedAction: requirement.suggestedAction,
      interdisciplinaryReviewRequired: finding.interdisciplinaryRequired,
      provenanceId,
    });
    await writeEvidence(tx, ctx.tenantId, projectId, findingId, finding.evidence);
    return "created";
  }

  // The values changed since somebody decided about it: that is new information, so the finding
  // goes back in the queue — with its whole decision history still attached.
  const evidenceChanged = row.explanation !== finding.explanation;
  const decided = row.state === "DISMISSED" || row.state === "RESOLVED" || row.state === "ACCEPTED";
  const reopening = decided && evidenceChanged;

  await tx.execute(sql`
    update app.quality_finding
       set last_run_id = ${runId},
           severity = ${finding.severity}::app.quality_finding_severity,
           title = ${finding.title},
           explanation = ${finding.explanation},
           last_seen_at = now(),
           updated_at = now()
           ${reopening ? sql`, state = 'OPEN'` : sql``}
     where tenant_id = ${ctx.tenantId} and id = ${row.id}
  `);
  await tx.execute(sql`
    delete from app.finding_evidence
     where tenant_id = ${ctx.tenantId} and finding_id = ${row.id}
  `);
  await writeEvidence(tx, ctx.tenantId, projectId, row.id, finding.evidence);
  return reopening ? "reopened" : "updated";
}

async function writeEvidence(
  tx: DbTx,
  tenantId: string,
  projectId: string,
  findingId: string,
  evidence: ReadonlyArray<Evidence>,
): Promise<void> {
  let ordinal = 0;
  for (const item of evidence) {
    await tx.insert(qualitySchema.findingEvidence).values({
      id: randomUUID(),
      tenantId,
      projectId,
      findingId,
      role: item.role,
      locator: item.locator,
      label: item.label,
      quote: item.quote,
      ordinal: ordinal++,
    });
  }
}

/**
 * `QG-001`, `QG-002`, … per project.
 *
 * Derived from the current maximum rather than a sequence, because the code is a per-project
 * business identifier and a global sequence would leak how many findings every other project has.
 * Concurrent runs of the same project are serialised by the row lock the reconciliation already
 * takes; two projects never collide because the uniqueness is per project.
 */
async function nextFindingCode(tx: DbTx, tenantId: string, projectId: string): Promise<string> {
  const result = await tx.execute(sql`
    select coalesce(max(substring(finding_code from 4)::int), 0) as last
      from app.quality_finding
     where tenant_id = ${tenantId} and project_id = ${projectId}
       and finding_code ~ '^QG-[0-9]+$'
  `);
  const last = Number((result.rows[0] as { last: number | string }).last);
  return `QG-${String(last + 1).padStart(3, "0")}`;
}

interface ProjectFacts {
  readonly locationLabel: string;
  readonly jurisdiction: string;
  /** Plans of the management plan chapter that declare where they apply (ADR-024). */
  readonly pgasPlaces: ReadonlyArray<{
    readonly code: string | null;
    readonly title: string;
    readonly place: string;
  }>;
  /** What the cartography delimits, by kind and by the label the legend shows. */
  readonly influenceAreaKinds: ReadonlyArray<string>;
  readonly influenceAreaLabels: ReadonlyArray<string>;
}

/**
 * The operational side of every comparison, read once.
 *
 * `jurisdiction` is the last comma-separated part of the project's location label — the province,
 * as the project itself declares it. Parsing a label is a compromise; the alternative is a
 * structured territory on `project`, which is a schema change several slices would have to agree
 * on. Recorded as debt rather than pretended away.
 */
async function loadProjectFacts(
  tx: DbTx,
  tenantId: string,
  projectId: string,
): Promise<ProjectFacts> {
  const project = await tx.execute(sql`
    select name, location_label from app.project
     where tenant_id = ${tenantId} and id = ${projectId}
  `);
  const found = project.rows[0] as { name: string; location_label: string | null } | undefined;
  if (!found) throw new NotFound("project");
  const locationLabel = found.location_label ?? "";
  const parts = locationLabel
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const jurisdiction = parts.length > 1 ? parts[parts.length - 2]! : (parts[0] ?? locationLabel);

  /*
   * The two sides of the plan-against-the-map comparison, read here so the detector stays pure.
   *
   * Only the **active** import of the chapter: a superseded plan is history and a finding about it
   * would be a finding about a document nobody is working from (ADR-024 §4).
   */
  const places = await tx.execute(sql`
    select p.code, p.title, p.place
      from app.pgas_plan p
      join app.pgas_import_run r on r.tenant_id = p.tenant_id and r.id = p.import_run_id
     where p.tenant_id = ${tenantId} and p.project_id = ${projectId}
       and r.is_active and p.place is not null and btrim(p.place) <> ''
     order by p.ordinal
  `);

  const areas = await tx.execute(sql`
    select ia.kind::text as kind, ia.label
      from app.influence_area ia
      join app.spatial_dataset_version v
        on v.tenant_id = ia.tenant_id and v.id = ia.dataset_version_id and v.is_active
     where ia.tenant_id = ${tenantId} and ia.project_id = ${projectId}
     order by ia.label
  `);
  const areaRows = areas.rows as unknown as ReadonlyArray<{ kind: string; label: string }>;

  return {
    locationLabel,
    jurisdiction,
    pgasPlaces: (
      places.rows as unknown as ReadonlyArray<{
        code: string | null;
        title: string;
        place: string;
      }>
    ).map((row) => ({ code: row.code, title: row.title, place: row.place })),
    influenceAreaKinds: areaRows.map((row) => row.kind),
    influenceAreaLabels: areaRows.map((row) => row.label),
  };
}

/**
 * Every assertion of this project, addressable two ways.
 *
 * `one(key)` is for the rules that compare a document against the project record; `all(key)` is for
 * the rules that compare two documents against each other, which is most of them — the same fact
 * stated twice in one file is the shape of nearly every real inconsistency in a study.
 */
interface AssertionLookup {
  one(key: string): AssertionRow | undefined;
  all(key: string): ReadonlyArray<AssertionRow>;
}

async function loadAssertions(
  tx: DbTx,
  tenantId: string,
  projectId: string,
): Promise<AssertionLookup> {
  const result = await tx.execute(sql`
    select id, key, source_ref, value_text, value_number, value_date, value_boolean, quote, qualifier
      from app.document_assertion
     where tenant_id = ${tenantId} and project_id = ${projectId}
     order by key, source_ref
  `);
  const byKey = new Map<string, AssertionRow[]>();
  for (const row of result.rows as unknown as AssertionRow[]) {
    const bucket = byKey.get(row.key);
    if (bucket) bucket.push(row);
    else byKey.set(row.key, [row]);
  }
  return {
    one: (key) => byKey.get(key)?.[0],
    all: (key) => byKey.get(key) ?? [],
  };
}

async function createQualityProvenance(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  input: { title: string; note: string; method: string },
): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    insert into app.provenance_record
      (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
       method, validation_state, captured_at)
    values (${id}, ${ctx.tenantId}, ${projectId}, 'DEMO_SIMULATION', 'SYSTEM_GENERATED',
            ARRAY['DERIVED']::app.provenance_transformation[], 'AGGREGATE', ${input.title},
            ${input.note}, ${input.method}, 'SPECIALIST_REQUIRED', now())
  `);
  return id;
}
