import { appSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  assertPublishablePayload,
  assertPublishableRegime,
  CLIENT_PUBLICATION_SCHEMA_VERSION,
  PUBLICATION_WITHHELD_FIGURES,
  requireCapability,
  requirePermission,
  type ClientPublicationPayload,
  type MetricKey,
  type PublicFact,
  type PublicFactKey,
  type PublishedArea,
  type PublishedGeometry,
  type PublishedPlan,
  type Regime,
  type RequestContext,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";

import { facetsOf, loadProvenanceRecords } from "../projects/provenance";

/**
 * Building what a client may be shown (ADR-027).
 *
 * The builder is the only thing that decides what a publication contains. It starts from nothing
 * and *adds* the figures it is allowed to add — it never assembles the project and removes the
 * private parts — so a table added upstream next month contributes nothing here until somebody
 * deliberately writes it in.
 *
 * Everything it reads is aggregate and already public in kind: the study's own headline counts,
 * the corridor it studied, the shape of the management plan it proposes. It never opens
 * `survey_answer`, `field_assignment`, `human_review`, `ai_classification`, `quality_finding`,
 * `document_chunk` or `parcel`.
 */

/** How much detail the published outlines keep, in metres of the dataset's analysis CRS. */
const PUBLISHED_SIMPLIFY_M = 25;
const CANONICAL_SRID = 4326;

const count = (value: number) => new Intl.NumberFormat("es-EC").format(value);
const decimal = (value: number, digits = 1) =>
  new Intl.NumberFormat("es-EC", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

/**
 * Which operational metric becomes which published figure, and what the client is told it means.
 *
 * A closed map, in both directions. A metric that is not here is not publishable — which is how
 * `parcels_visited`, `revisits_scheduled`, `parcels_pending`, `productivity_per_day`,
 * `universe_confirmed` and `projected_close_date` stay out of a client's page without anybody
 * having to remember to exclude them.
 */
const PUBLISHABLE_METRICS: Readonly<
  Partial<
    Record<
      MetricKey,
      { readonly key: PublicFactKey; readonly label: string; readonly basis: string }
    >
  >
> = {
  corridor_length_km: {
    key: "corridor_length_km",
    label: "Longitud del corredor",
    basis: "Eje vial delimitado por el estudio.",
  },
  universe_estimated: {
    key: "parcel_universe",
    label: "Predios frentistas",
    basis: "Universo de predios frentistas identificado en el corredor.",
  },
  surveys_complete: {
    key: "socioeconomic_surveys",
    label: "Fichas socioeconómicas",
    basis: "Levantamiento socioeconómico del estudio concluido.",
  },
  consultation_participants: {
    key: "consultation_participants",
    label: "Participantes en asambleas",
    basis: "Asistencia registrada en las asambleas de consulta.",
  },
};

/** Where each published figure belongs on the client's page. */
const PARTICIPATION_FACTS: ReadonlySet<PublicFactKey> = new Set<PublicFactKey>([
  "socioeconomic_surveys",
  "consultation_participants",
]);

export interface WithheldFigure {
  readonly key: string;
  readonly label: string;
  readonly reason: string;
}

export interface PublicationDraft {
  readonly payload: ClientPublicationPayload;
  /** What the published figures rest on. Kept beside the payload, never inside it (ADR-027). */
  readonly sourceProvenanceIds: ReadonlyArray<string>;
  /** Figures the builder found and refused, with the reason. Internal surface only. */
  readonly withheld: ReadonlyArray<WithheldFigure>;
}

/**
 * Compose the draft a coordinator previews and publishes.
 *
 * Requires `client.portal` and `portal.preview`: preparing a publication is reading the project
 * through a lens, and the lens is still project data.
 */
export async function buildClientPublicationDraft(
  db: Database,
  ctx: RequestContext,
): Promise<PublicationDraft> {
  requireCapability(ctx, "client.portal");
  requirePermission(ctx, "portal.preview");
  if (ctx.projectId === null) {
    throw new Error("buildClientPublicationDraft requires a project context");
  }
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const project = await readProject(tx, ctx, projectId);
    const withheld: WithheldFigure[] = [...PUBLICATION_WITHHELD_FIGURES];
    const provenanceIds = new Set<string>();

    const { summaryFacts, participationFacts } = await readFigures(
      tx,
      ctx,
      projectId,
      provenanceIds,
      withheld,
    );
    const territory = await readTerritory(tx, ctx, projectId, provenanceIds);
    const managementPlan = await readManagementPlan(tx, ctx, projectId, provenanceIds);

    if (managementPlan) summaryFacts.push(...managementPlan.summaryFacts);

    const payload = assertPublishablePayload({
      schemaVersion: CLIENT_PUBLICATION_SCHEMA_VERSION,
      project,
      summary: {
        headline:
          "Resumen del estudio socioambiental, publicado por la consultora responsable. " +
          "Las cifras corresponden al expediente del estudio y no a la operación diaria.",
        facts: summaryFacts.filter((fact) => !PARTICIPATION_FACTS.has(fact.key)),
      },
      territory,
      participation: {
        facts: participationFacts,
        note:
          participationFacts.length > 0
            ? "Cifras agregadas del componente social. No incluyen información de personas."
            : null,
      },
      managementPlan: managementPlan
        ? {
            facts: managementPlan.facts,
            plans: managementPlan.plans,
            note: "Corresponde a lo que el plan propone; no registra su ejecución.",
          }
        : null,
      // No milestone or deliverable is modelled yet, and inventing one for a demonstration is
      // exactly what a client would be entitled to rely on. The surface says so instead.
      milestones: [],
      deliverables: [],
      forecast: null,
      notes: [
        "Esta publicación es una actualización con fecha. La consultora decide cuándo publicar " +
          "una nueva; entre publicaciones, lo que se muestra no cambia.",
      ],
    });

    return { payload, sourceProvenanceIds: [...provenanceIds], withheld };
  });
}

async function readProject(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
): Promise<ClientPublicationPayload["project"]> {
  const rows = await tx
    .select({
      name: appSchema.project.name,
      locationLabel: appSchema.project.locationLabel,
      officialTitle: appSchema.project.officialTitle,
      programmeReference: appSchema.project.programmeReference,
    })
    .from(appSchema.project)
    .where(and(eq(appSchema.project.tenantId, ctx.tenantId), eq(appSchema.project.id, projectId)));
  const row = rows[0];
  if (!row) throw new Error("project not visible in context");
  return {
    name: row.name,
    officialTitle: row.officialTitle,
    locality: row.locationLabel ?? "—",
    programmeReference: row.programmeReference,
  };
}

async function readFigures(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  provenanceIds: Set<string>,
  withheld: WithheldFigure[],
): Promise<{ summaryFacts: PublicFact[]; participationFacts: PublicFact[] }> {
  const rows = await tx
    .select()
    .from(appSchema.metricSnapshot)
    .where(
      and(
        eq(appSchema.metricSnapshot.tenantId, ctx.tenantId),
        eq(appSchema.metricSnapshot.projectId, projectId),
      ),
    )
    .orderBy(appSchema.metricSnapshot.displayOrder);

  const records = await loadProvenanceRecords(
    tx,
    ctx,
    rows.map((row) => row.provenanceId),
  );

  const summaryFacts: PublicFact[] = [];
  const participationFacts: PublicFact[] = [];

  for (const row of rows) {
    const mapping = PUBLISHABLE_METRICS[row.key];
    if (!mapping) continue;
    const record = records.get(row.provenanceId);
    if (!record) continue;
    const facets = facetsOf(record);
    if (!isPublishable(facets.regime, facets.granularity)) {
      withheld.push({
        key: mapping.key,
        label: mapping.label,
        reason:
          "El único valor disponible para esta cifra no es publicable: procede de la operación " +
          "simulada de demostración.",
      });
      continue;
    }
    // The regime rule, stated once in the domain, applied here rather than remembered here.
    assertPublishableRegime(facets.regime, {
      figure: mapping.label,
      aggregate: facets.granularity === "AGGREGATE",
      declaredSafe: true,
    });

    const numeric = row.numericValue === null ? null : Number(row.numericValue);
    if (numeric === null || !Number.isFinite(numeric)) continue;
    const isDecimal = !Number.isInteger(numeric);
    const fact: PublicFact = {
      key: mapping.key,
      label: mapping.label,
      value: isDecimal ? decimal(numeric) : count(numeric),
      unit: mapping.key === "corridor_length_km" ? "km" : null,
      basis: mapping.basis,
    };
    provenanceIds.add(row.provenanceId);
    if (PARTICIPATION_FACTS.has(fact.key)) participationFacts.push(fact);
    else summaryFacts.push(fact);
  }

  return { summaryFacts, participationFacts };
}

/**
 * A figure may be published when it is the concluded study's own aggregate, or a live aggregate
 * the caller has declared safe. Everything else is refused before it reaches the payload.
 */
function isPublishable(regime: Regime, granularity: string | null): boolean {
  if (regime === "DEMO_SIMULATION") return false;
  if (regime === "LIVE_OPERATIONAL") return granularity === "AGGREGATE";
  return true;
}

async function readTerritory(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  provenanceIds: Set<string>,
): Promise<ClientPublicationPayload["territory"]> {
  /*
   * The centreline and the delimited areas, generalised in the dataset's own analysis CRS so the
   * tolerance is metres on the ground, then returned in the storage CRS. Nothing is written: the
   * stored geometry is the one the study delivered (TD-070).
   *
   * Parcels are not read. Not filtered out afterwards — not read: there is no join to
   * `app.parcel_geometry` anywhere in this file.
   */
  const alignmentRows = await tx.execute(sql`
    select a.label,
           a.provenance_id,
           ST_AsGeoJSON(
             ST_Transform(
               ST_SimplifyPreserveTopology(ST_Transform(a.geom, v.analysis_srid),
                                           ${sql.raw(String(PUBLISHED_SIMPLIFY_M))}),
               ${sql.raw(String(CANONICAL_SRID))}
             ), 5) as geojson
      from app.alignment a
      join app.spatial_dataset_version v
        on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
     where a.tenant_id = ${ctx.tenantId} and a.project_id = ${projectId}
     limit 1
  `);

  const influenceRows = await tx.execute(sql`
    select ia.label,
           ia.area_m2,
           ia.provenance_id,
           ST_AsGeoJSON(
             ST_Transform(
               ST_SimplifyPreserveTopology(ST_Transform(ia.geom, v.analysis_srid),
                                           ${sql.raw(String(PUBLISHED_SIMPLIFY_M))}),
               ${sql.raw(String(CANONICAL_SRID))}
             ), 5) as geojson
      from app.influence_area ia
      join app.spatial_dataset_version v
        on v.tenant_id = ia.tenant_id and v.id = ia.dataset_version_id and v.is_active
     where ia.tenant_id = ${ctx.tenantId} and ia.project_id = ${projectId}
     order by ia.area_m2
  `);

  const alignmentRow = alignmentRows.rows[0] as
    { label: string; provenance_id: string; geojson: string } | undefined;
  const influence = influenceRows.rows as unknown as ReadonlyArray<{
    label: string;
    area_m2: string;
    provenance_id: string;
    geojson: string;
  }>;

  const records = await loadProvenanceRecords(tx, ctx, [
    ...(alignmentRow ? [alignmentRow.provenance_id] : []),
    ...influence.map((row) => row.provenance_id),
  ]);

  const publishableGeometry = (provenanceId: string, figure: string): boolean => {
    const record = records.get(provenanceId);
    if (!record) return false;
    const regime = facetsOf(record).regime;
    if (regime === "DEMO_SIMULATION") return false;
    assertPublishableRegime(regime, { figure, aggregate: true, declaredSafe: true });
    return true;
  };

  let alignment: PublishedGeometry | null = null;
  if (alignmentRow && publishableGeometry(alignmentRow.provenance_id, "Eje vial")) {
    alignment = { label: alignmentRow.label, geometry: JSON.parse(alignmentRow.geojson) };
    provenanceIds.add(alignmentRow.provenance_id);
  }

  const influenceAreas: PublishedArea[] = [];
  for (const row of influence) {
    if (!publishableGeometry(row.provenance_id, row.label)) continue;
    influenceAreas.push({
      label: row.label,
      areaHa: Number(row.area_m2) / 10_000,
      geometry: JSON.parse(row.geojson),
    });
    provenanceIds.add(row.provenance_id);
  }

  return {
    alignment,
    influenceAreas,
    note: "El trazado y las áreas delimitadas se muestran generalizados para su representación en pantalla.",
  };
}

async function readManagementPlan(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  provenanceIds: Set<string>,
): Promise<{
  facts: PublicFact[];
  summaryFacts: PublicFact[];
  plans: PublishedPlan[];
} | null> {
  const runRows = await tx.execute(sql`
    select r.id, r.provenance_id
      from app.pgas_import_run r
     where r.tenant_id = ${ctx.tenantId} and r.project_id = ${projectId} and r.is_active
     limit 1
  `);
  const run = runRows.rows[0] as { id: string; provenance_id: string } | undefined;
  if (!run) return null;

  const records = await loadProvenanceRecords(tx, ctx, [run.provenance_id]);
  const record = records.get(run.provenance_id);
  if (!record) return null;
  const regime = facetsOf(record).regime;
  if (regime === "DEMO_SIMULATION") return null;
  assertPublishableRegime(regime, {
    figure: "Plan de Manejo Ambiental y Social",
    aggregate: true,
    declaredSafe: true,
  });

  const planRows = await tx.execute(sql`
    select p.code,
           p.title,
           count(m.id)::int as measures,
           count(distinct m.programme_title)::int as programmes
      from app.pgas_plan p
      left join app.pgas_measure m on m.tenant_id = p.tenant_id and m.plan_id = p.id
     where p.tenant_id = ${ctx.tenantId} and p.project_id = ${projectId} and p.import_run_id = ${run.id}
     group by p.id, p.code, p.title, p.ordinal
     order by p.ordinal
  `);
  const rows = planRows.rows as unknown as ReadonlyArray<{
    code: string | null;
    title: string;
    measures: number;
    programmes: number;
  }>;
  if (rows.length === 0) return null;

  const plans: PublishedPlan[] = rows.map((row) => ({
    code: row.code,
    title: row.title,
    measures: row.measures,
  }));
  const measures = rows.reduce((total, row) => total + row.measures, 0);
  // A *programme* is a banner row inside a plan, so it is counted per plan and summed: two plans
  // that happen to use the same banner title propose two programmes, not one (ADR-024).
  const programmes = rows.reduce((total, row) => total + row.programmes, 0);

  provenanceIds.add(run.provenance_id);

  const basis = "Plan de Manejo Ambiental y Social propuesto por el estudio.";
  const facts: PublicFact[] = [
    { key: "pgas_plans", label: "Planes", value: count(plans.length), unit: null, basis },
    { key: "pgas_programmes", label: "Programas", value: count(programmes), unit: null, basis },
    { key: "pgas_measures", label: "Medidas", value: count(measures), unit: null, basis },
  ];
  return { facts, summaryFacts: [], plans };
}
