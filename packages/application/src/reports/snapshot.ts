import { type DbTx } from "@eia/db";
import {
  DENOMINATOR_COPY,
  NotFound,
  SECTION_TITLES,
  type ReportFact,
  type ReportSection,
  type ReportSnapshot,
  type SocialSectionKey,
} from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * Computing what a social chapter says, from validated data only.
 *
 * Every figure here is arithmetic or SQL over rows a person settled. There is no model in this
 * file, and there is no path from an AI proposal to a fact: the theme distribution reads
 * `human_review` and nothing else, which is asserted directly rather than assumed (ADR-019,
 * ADR-022 §5).
 *
 * Values are formatted for `es-EC` at this point rather than at render time, because the snapshot
 * *is* what gets rendered — on screen, in the DOCX, and to a generator writing prose. One
 * formatting, one set of numbers, no chance of three renderings disagreeing.
 */
const count = (value: number) => new Intl.NumberFormat("es-EC").format(value);
const percent = (value: number) =>
  `${new Intl.NumberFormat("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100)} %`;

export interface SnapshotInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly surveyVersionId: string;
}

export async function buildSocialSnapshot(tx: DbTx, input: SnapshotInput): Promise<ReportSnapshot> {
  const project = await tx.execute(sql`
    select name from app.project where tenant_id = ${input.tenantId} and id = ${input.projectId}
  `);
  const projectRow = project.rows[0] as { name: string } | undefined;
  if (!projectRow) throw new NotFound("project");

  const version = await tx.execute(sql`
    select v.version_label, t.name as template_name
      from app.survey_version v
      join app.survey_template t on t.tenant_id = v.tenant_id and t.id = v.template_id
     where v.tenant_id = ${input.tenantId} and v.id = ${input.surveyVersionId}
  `);
  const versionRow = version.rows[0] as
    { version_label: string; template_name: string } | undefined;
  if (!versionRow) throw new NotFound("survey version");

  const regimes = new Set<string>();
  const sections: ReportSection[] = [];
  const section = (key: SocialSectionKey, summary: string, facts: ReportFact[]) => {
    sections.push({ key, title: SECTION_TITLES[key], ordinal: sections.length, summary, facts });
  };

  // ── universe ─────────────────────────────────────────────────────────────────────────────
  const universe = await tx.execute(sql`
    select
      count(*) filter (where i.status = 'SUBMITTED')::int as submitted,
      count(*)::int as total,
      count(distinct a.parcel_id) filter (where i.status = 'SUBMITTED')::int as parcels
      from app.survey_instance i
      left join app.field_visit fv on fv.tenant_id = i.tenant_id and fv.id = i.visit_id
      left join app.field_assignment a on a.tenant_id = fv.tenant_id and a.id = fv.assignment_id
     where i.tenant_id = ${input.tenantId} and i.project_id = ${input.projectId}
       and i.survey_version_id = ${input.surveyVersionId}
  `);
  const u = universe.rows[0] as { submitted: number; total: number; parcels: number };

  section(
    "universe",
    "Cobertura del levantamiento sobre la versión del cuestionario que se reporta. Sólo se " +
      "cuentan las fichas enviadas: los borradores de campo no participan en ninguna cifra.",
    [
      {
        key: "submitted",
        label: "Fichas enviadas",
        value: count(Number(u.submitted)),
        basis: `Versión ${versionRow.version_label} de «${versionRow.template_name}»`,
        source: {
          kind: "metric",
          metric: "field.instances_submitted",
          method:
            "Instancias de encuesta en estado SUBMITTED de esta versión del cuestionario, " +
            "contadas en el momento de la generación.",
        },
      },
      {
        key: "parcels_covered",
        label: "Predios con ficha enviada",
        value: count(Number(u.parcels)),
        basis: "Predios distintos alcanzados por una ficha enviada",
        source: {
          kind: "metric",
          metric: "field.parcels_with_submission",
          method: "Predios distintos referidos por una asignación cuya ficha fue enviada.",
        },
      },
    ],
  );

  // ── closed questions ─────────────────────────────────────────────────────────────────────
  const closed = await tx.execute(sql`
    select q.id, q.code, q.prompt, q.type::text as type,
           (select count(*)::int from app.survey_answer a
             join app.survey_instance i2 on i2.tenant_id = a.tenant_id and i2.id = a.instance_id
            where a.tenant_id = q.tenant_id and a.question_id = q.id and i2.status = 'SUBMITTED'
           ) as answered
      from app.survey_question q
     where q.tenant_id = ${input.tenantId} and q.project_id = ${input.projectId}
       and q.version_id = ${input.surveyVersionId}
       and q.type in ('SINGLE_CHOICE', 'MULTI_CHOICE', 'BOOLEAN')
     order by q.ordinal
  `);

  const closedFacts: ReportFact[] = [];
  for (const row of closed.rows as Array<{
    id: string;
    code: string;
    prompt: string;
    type: string;
    answered: number;
  }>) {
    const options = await tx.execute(sql`
      select coalesce(o.label, case when a.boolean_value then 'Sí' else 'No' end) as label,
             count(*)::int as n
        from app.survey_answer a
        join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
        left join app.survey_answer_option sel
          on sel.tenant_id = a.tenant_id and sel.answer_id = a.id
        left join app.survey_option o on o.tenant_id = sel.tenant_id and o.id = sel.option_id
       where a.tenant_id = ${input.tenantId} and a.question_id = ${row.id}
         and i.status = 'SUBMITTED'
       group by 1
       order by 2 desc, 1
    `);
    const answered = Number(row.answered);
    const rule = row.type === "MULTI_CHOICE" ? "answered_multi" : "answered";
    for (const option of options.rows as Array<{ label: string | null; n: number }>) {
      if (!option.label) continue;
      closedFacts.push({
        key: `${row.code}.${option.label}`,
        label: `${row.prompt} — ${option.label}`,
        value:
          answered === 0
            ? "—"
            : `${count(Number(option.n))} (${percent(Number(option.n) / answered)})`,
        basis: `${DENOMINATOR_COPY[rule].label}: ${count(answered)}. ${DENOMINATOR_COPY[rule].help}`,
        source: {
          kind: "metric",
          metric: `social.tabulation.${row.code}`,
          method:
            "Conteo determinista sobre respuestas enviadas de esta versión; el denominador es el " +
            "número de fichas que respondieron esta pregunta.",
        },
      });
    }
  }
  section(
    "closed_questions",
    "Tabulación determinista de las preguntas cerradas. Cada porcentaje declara su denominador; " +
      "en las preguntas de opción múltiple los porcentajes pueden sumar más de 100 %.",
    closedFacts,
  );

  // ── validated themes: human_review only ──────────────────────────────────────────────────
  const validated = await tx.execute(sql`
    select cat.code, cat.label, count(*)::int as n,
           (select version_label from app.taxonomy_version tv
             where tv.tenant_id = cat.tenant_id and tv.id = cat.version_id) as taxonomy_label
      from app.human_review_category link
      join app.human_review h on h.tenant_id = link.tenant_id and h.id = link.review_id
      join app.taxonomy_category cat on cat.tenant_id = link.tenant_id and cat.id = link.category_id
      join app.ai_classification c on c.tenant_id = h.tenant_id and c.id = h.classification_id
      join app.survey_answer a on a.tenant_id = c.tenant_id and a.id = c.answer_id
      join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
     where link.tenant_id = ${input.tenantId} and link.project_id = ${input.projectId}
       and i.survey_version_id = ${input.surveyVersionId}
     group by cat.code, cat.label, cat.tenant_id, cat.version_id
     order by 3 desc, 2
  `);
  const reviewed = await tx.execute(sql`
    select count(distinct h.id)::int as n
      from app.human_review h
      join app.ai_classification c on c.tenant_id = h.tenant_id and c.id = h.classification_id
      join app.survey_answer a on a.tenant_id = c.tenant_id and a.id = c.answer_id
      join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
     where h.tenant_id = ${input.tenantId} and h.project_id = ${input.projectId}
       and i.survey_version_id = ${input.surveyVersionId}
  `);
  const reviewCount = Number((reviewed.rows[0] as { n: number }).n);

  const themeFacts: ReportFact[] = (
    validated.rows as Array<{ code: string; label: string; n: number; taxonomy_label: string }>
  ).map((row) => ({
    key: `theme.${row.code}`,
    label: row.label,
    value: `${count(Number(row.n))} (${percent(Number(row.n) / reviewCount)})`,
    basis:
      `Respuestas abiertas con codificación validada: ${count(reviewCount)}. Una respuesta puede ` +
      "llevar varios temas, por lo que los porcentajes pueden sumar más de 100 %.",
    source: {
      kind: "human_review",
      reviews: Number(row.n),
      taxonomyVersionLabel: row.taxonomy_label,
    },
  }));

  // With nothing validated the section says so. It never falls back to AI proposals: a provisional
  // coding in a chapter is the failure ADR-019 exists to prevent (ADR-022 §5).
  if (themeFacts.length === 0) {
    themeFacts.push({
      key: "theme.none",
      label: "Temas validados",
      value: "—",
      basis: "Todavía no hay codificaciones validadas por un especialista para esta versión.",
      source: { kind: "human_review", reviews: 0, taxonomyVersionLabel: "—" },
    });
  }

  section(
    "validated_themes",
    "Distribución de temas de las respuestas abiertas, contada únicamente sobre codificaciones " +
      "validadas por un especialista. Las propuestas automáticas sin validar no entran en esta cifra.",
    themeFacts,
  );

  // ── quality findings ─────────────────────────────────────────────────────────────────────
  const findings = await tx.execute(sql`
    select finding_code, state::text as state, severity::text as severity, title
      from app.quality_finding
     where tenant_id = ${input.tenantId} and project_id = ${input.projectId}
     order by finding_code
  `);
  const findingFacts: ReportFact[] = (
    findings.rows as Array<{
      finding_code: string;
      state: string;
      severity: string;
      title: string;
    }>
  ).map((row) => ({
    key: `finding.${row.finding_code}`,
    label: `${row.finding_code} · ${row.title}`,
    value: STATE_LABEL[row.state] ?? row.state,
    basis: `Severidad ${SEVERITY_LABEL[row.severity] ?? row.severity}`,
    source: { kind: "quality_finding", findingCode: row.finding_code, state: row.state },
  }));
  section(
    "quality",
    "Discrepancias señaladas por la revisión de calidad y el estado en que las dejó un revisor. " +
      "Señalar una discrepancia no determina cuál de las dos fuentes rige ni declara conformidad.",
    findingFacts.length > 0
      ? findingFacts
      : [
          {
            key: "finding.none",
            label: "Hallazgos de calidad",
            value: "—",
            basis: "No se ha ejecutado una revisión de calidad sobre este proyecto.",
            source: { kind: "metric", metric: "quality.findings", method: "Conteo de hallazgos." },
          },
        ],
  );

  // ── sources: the documents and provenance the chapter rests on ───────────────────────────
  const documents = await tx.execute(sql`
    select d.code, d.title, v.version_label, v.source_note,
           (select id from app.document_chunk c
             where c.tenant_id = v.tenant_id and c.version_id = v.id order by c.ordinal limit 1
           ) as first_chunk,
           (select page_from from app.document_chunk c
             where c.tenant_id = v.tenant_id and c.version_id = v.id order by c.ordinal limit 1
           ) as first_page
      from app.source_document d
      join app.document_version v on v.tenant_id = d.tenant_id and v.id = d.current_version_id
     where d.tenant_id = ${input.tenantId} and d.project_id = ${input.projectId}
     order by d.code
  `);
  const sourceFacts: ReportFact[] = (
    documents.rows as Array<{
      code: string;
      title: string;
      version_label: string;
      source_note: string;
      first_chunk: string | null;
      first_page: number | null;
    }>
  )
    .filter((row) => row.first_chunk !== null)
    .map((row) => ({
      key: `document.${row.code}`,
      label: `${row.code} ${row.version_label} · ${row.title}`,
      value: row.version_label,
      basis: row.source_note,
      source: {
        kind: "document_chunk" as const,
        documentCode: row.code,
        versionLabel: row.version_label,
        page: row.first_page === null ? null : Number(row.first_page),
        chunkId: row.first_chunk!,
      },
    }));

  // Provenance of the project's own aggregate figures, with their facets, so the regimes a reader
  // must know about are on the page rather than implied.
  const provenance = await tx.execute(sql`
    select distinct on (p.regime, p.origin)
           p.id, p.regime::text as regime, p.origin::text as origin,
           p.transformations, p.granularity::text as granularity,
           coalesce(p.method, p.note) as note
      from app.provenance_record p
     where p.tenant_id = ${input.tenantId} and p.project_id = ${input.projectId}
     order by p.regime, p.origin, p.recorded_at
  `);
  for (const row of provenance.rows as unknown as Array<{
    id: string;
    regime: string;
    origin: string;
    transformations: string[] | string;
    granularity: string | null;
    note: string | null;
  }>) {
    regimes.add(row.regime);
    // `tx.execute` returns the raw driver row, so a Postgres array arrives as `{A,B}` rather than
    // as a JS array. Normalised here rather than at three call sites downstream.
    const transformations = Array.isArray(row.transformations)
      ? row.transformations
      : String(row.transformations)
          .replace(/^\{|\}$/g, "")
          .split(",")
          .filter(Boolean);
    sourceFacts.push({
      key: `provenance.${row.regime}.${row.origin}`,
      label: `${REGIME_LABEL[row.regime] ?? row.regime} · ${row.origin}`,
      value: transformations.join(" → "),
      basis: row.note ?? null,
      source: {
        kind: "provenance",
        provenanceId: row.id,
        facets: {
          regime: row.regime as never,
          origin: row.origin as never,
          transformations: transformations as never,
          granularity: (row.granularity ?? null) as never,
        },
        note: row.note ?? "Sin método declarado.",
      },
    });
  }

  section(
    "sources",
    "Documentos y registros de procedencia sobre los que se apoya este capítulo. Cada régimen " +
      "presente se declara: una cifra de demostración nunca se presenta como dato del estudio.",
    sourceFacts,
  );

  return {
    kind: "social_chapter",
    computedAt: new Date().toISOString(),
    projectName: projectRow.name,
    surveyVersionLabel: versionRow.version_label,
    sections,
    regimes: regimes.size > 0 ? [...regimes].sort() : ["HISTORICAL_OBSERVED"],
  };
}

const STATE_LABEL: Record<string, string> = {
  OPEN: "Abierto",
  UNDER_REVIEW: "En revisión",
  ACCEPTED: "Aceptado",
  DISMISSED: "Descartado",
  RESOLVED: "Resuelto",
};
const SEVERITY_LABEL: Record<string, string> = { high: "alta", medium: "media", low: "baja" };
const REGIME_LABEL: Record<string, string> = {
  HISTORICAL_OBSERVED: "Dato histórico observado",
  LIVE_OPERATIONAL: "Operación en curso",
  DEMO_SIMULATION: "Simulación de demostración",
};
