import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appEnvSchema, loadEnv, migratorDatabaseEnvSchema } from "@eia/contracts";
import {
  appSchema,
  createDatabase,
  createPool,
  fieldSchema,
  gisSchema,
  socialSchema,
} from "@eia/db";
import {
  calculateForecast,
  CORRIDOR_GENERATOR_VERSION,
  corridorGeneratorInputSchema,
  FORECAST_ALGORITHM_VERSION,
  generateCorridor,
  GRANULARITIES,
  METRIC_KEYS,
  assertSurveyVersionPublishable,
  CANONICAL_SRID,
  captureChannelSchema,
  FIELD_OFFLINE_MODE_KEY,
  fieldOfflineModeSchema,
  ORIGINS,
  questionSensitivitySchema,
  questionTypeSchema,
  REGIMES,
  sridSchema,
  surveyOptionCodeSchema,
  surveyQuestionCodeSchema,
  socialTaxonomyHash,
  surveyVersionHash,
  TRANSFORMATIONS,
  VALIDATION_STATES,
} from "@eia/domain";
import { config as loadDotenv } from "dotenv";

import { assertAnalysisSridUsable } from "../src/gis/analysis-crs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Load a project fixture: its approved historical aggregates plus the demo operational values a
 * Command Center composition needs. The fixture directory is named on the command line
 * (`--fixture <dir>` under `fixtures/projects/`), so no pilot-project name lives in this script.
 *
 * Guards, in order: demo fixtures must be enabled, the environment must not be production, the
 * manifest must declare that it holds no personal data, and every value must name the provenance
 * record it belongs to. The forecast is not read from the manifest: it is **computed** by the
 * domain algorithm from the manifest's inputs, so what the screen shows is always reproducible.
 */
loadDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
});
const app = loadEnv("app", appEnvSchema);
if (!app.DEMO_FIXTURES_ENABLED || app.APP_ENV === "production") {
  console.error(
    "seed:demo-project refused: DEMO_FIXTURES_ENABLED must be true and APP_ENV must not be production",
  );
  process.exit(1);
}
const env = loadEnv("migrator", migratorDatabaseEnvSchema);

const provenanceSchema = z
  .object({
    key: z.string().min(1),
    regime: z.enum(REGIMES),
    origin: z.enum(ORIGINS),
    transformations: z.array(z.enum(TRANSFORMATIONS)).min(1),
    granularity: z.enum(GRANULARITIES).nullable(),
    title: z.string().min(1),
    note: z.string().min(1),
    sourceLabel: z.string().min(1).nullable(),
    sourceReference: z.string().min(1).nullable(),
    sourceVersion: z.string().min(1).nullable(),
    method: z.string().min(1).nullable(),
    capturedAt: z.iso.datetime().nullable(),
    /** When true the record's capture instant is the scenario clock, not a fixed date. */
    $capturedAtFromScenario: z.literal(true).optional(),
    validationState: z.enum(VALIDATION_STATES),
    validationNote: z.string().min(1).nullable(),
  })
  .strict();

const manifestSchema = z
  .object({
    $comment: z.string(),
    safetyClassification: z
      .object({
        containsPersonalData: z.literal(false),
        level: z.string(),
        excludes: z.array(z.string()).min(1),
        reviewedBy: z.string(),
        note: z.string(),
      })
      .strict(),
    tenantSlug: z.string().min(1),
    /**
     * The scenario clock (IG1-003). Every DEMO_SIMULATION value is derived from it, so a demo
     * session in any future month shows the same figures, and it never falls back to the system
     * date. It is fixture metadata: the loader turns it into persisted timestamps on the derived
     * rows — the forecast's `as_of_date` and `calculated_at`, the activity feed's `occurred_at`,
     * the capture instant of the demo provenance records — and nothing keeps it on `project`
     * (IG1-009).
     */
    demoScenario: z
      .object({
        $comment: z.string(),
        scenarioDate: z.iso.date(),
        scenarioTime: z.string().regex(/^\d{2}:\d{2}$/),
      })
      .strict(),
    project: z
      .object({
        slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
        name: z.string().min(1),
        locationLabel: z.string().min(1),
        profileKey: z.string().min(1),
        profileVersion: z.string().min(1),
        lifecycle: z.enum(["planning", "field", "analysis", "review", "delivered", "closed"]),
      })
      .strict(),
    provenance: z.record(z.string(), provenanceSchema),
    metrics: z
      .array(
        z
          .object({
            key: z.enum(METRIC_KEYS),
            numericValue: z.number().optional(),
            dateValue: z.iso.date().optional(),
            note: z.string().min(1),
            displayOrder: z.number().int(),
            provenance: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    forecast: z
      .object({
        $comment: z.string(),
        pending: z.number().int().min(0),
        dailyCompletions: z.array(z.number().int().min(0)).min(1),
        windowDays: z.number().int().min(1),
        targetDate: z.iso.date(),
        activeTechnicians: z.number().int().min(0),
        assignedTechnicians: z.number().int().min(0),
        assumptions: z.array(z.string().min(1)).min(1),
        provenance: z.string().min(1),
      })
      .strict(),
    attention: z.array(
      z
        .object({
          severity: z.enum(["high", "medium", "low"]),
          title: z.string().min(1),
          note: z.string().min(1),
          surfaceLabel: z.string().min(1),
          surfaceKey: z.string().nullable(),
          actionLabel: z.string().min(1),
          displayOrder: z.number().int(),
          provenance: z.string().min(1),
        })
        .strict(),
    ),
    /** Deterministic GIS generation inputs; the geometry itself is never stored in the fixture. */
    gis: z
      .object({
        $comment: z.string(),
        generator: z.literal(CORRIDOR_GENERATOR_VERSION),
        /** Projected CRS this project's lengths and areas are measured in (ADR-017). */
        analysisSrid: sridSchema,
        crsBasis: z.enum(["DEMO_ASSUMPTION", "SOURCE_DECLARED"]),
        alignmentLabel: z.string().min(1),
        input: corridorGeneratorInputSchema,
      })
      .strict(),
    /** FieldFlow demonstration: questionnaire, campaign, technicians, synthetic location. */
    field: z
      .object({
        $comment: z.string(),
        offlineMode: fieldOfflineModeSchema,
        captureChannel: captureChannelSchema,
        template: z
          .object({ key: z.string().min(1), name: z.string().min(1), description: z.string() })
          .strict(),
        version: z
          .object({
            versionLabel: z.string().min(1),
            questions: z.array(
              z
                .object({
                  code: surveyQuestionCodeSchema,
                  ordinal: z.number().int().min(0),
                  type: questionTypeSchema,
                  prompt: z.string().min(1),
                  helpText: z.string().nullable(),
                  required: z.boolean(),
                  sensitivity: questionSensitivitySchema,
                  options: z.array(
                    z
                      .object({
                        code: surveyOptionCodeSchema,
                        label: z.string().min(1),
                        ordinal: z.number().int().min(0),
                      })
                      .strict(),
                  ),
                })
                .strict(),
            ),
          })
          .strict(),
        campaign: z
          .object({
            name: z.string().min(1),
            status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]),
            startsOnOffsetDays: z.number().int(),
            targetOnOffsetDays: z.number().int(),
            assignmentCount: z.number().int().min(1).max(60),
            completedCount: z.number().int().min(0).max(60),
          })
          .strict(),
        technician: z.object({ email: z.string().min(3), name: z.string().min(1) }).strict(),
        secondTechnician: z.object({ email: z.string().min(3), name: z.string().min(1) }).strict(),
        syntheticLocation: z
          .object({
            $comment: z.string(),
            longitude: z.number(),
            latitude: z.number(),
            accuracyM: z.number().positive(),
          })
          .strict(),
      })
      .strict(),
    /**
     * The reconstructed coding scheme (Slice 4). Declared in the fixture, never in code: the
     * categories a study codes against are project data, and this one is explicitly a
     * reconstruction rather than a scheme the consultancy handed over.
     */
    social: z
      .object({
        $comment: z.string(),
        taxonomy: z
          .object({
            key: z.string().min(3),
            name: z.string().min(1),
            description: z.string().min(1),
          })
          .strict(),
        version: z
          .object({
            versionLabel: z.string().min(1),
            sourceNote: z.string().min(1),
            categories: z
              .array(
                z
                  .object({
                    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
                    label: z.string().min(2),
                    description: z.string().min(10),
                    ordinal: z.number().int().min(0),
                  })
                  .strict(),
              )
              .min(2),
          })
          .strict(),
      })
      .strict(),
    activity: z.array(
      z
        .object({
          /** Days from the scenario date; 0 is the scenario day, negative is earlier. */
          dayOffset: z.number().int().max(0),
          time: z.string().regex(/^\d{2}:\d{2}$/),
          actorLabel: z.string().min(1),
          action: z.string().min(1),
          objectLabel: z.string().min(1).nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const fixtureIndex = process.argv.indexOf("--fixture");
const fixtureDir = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
if (!fixtureDir || !/^[a-z0-9-]{3,60}$/.test(fixtureDir)) {
  console.error("seed:demo-project: pass --fixture <directory under fixtures/projects>");
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = resolve(root, "fixtures/projects", fixtureDir, "manifest.json");
const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

/** Provenance records are addressed by their declared `key`, not by their position in the file. */
const provenanceByKey = new Map(
  Object.values(manifest.provenance).map((record) => [record.key, record]),
);
for (const metric of manifest.metrics) {
  if (!provenanceByKey.has(metric.provenance)) {
    throw new Error(`metric ${metric.key} names an unknown provenance record`);
  }
}
for (const item of manifest.attention) {
  if (!provenanceByKey.has(item.provenance)) {
    throw new Error(`attention item "${item.title}" names an unknown provenance record`);
  }
}
if (!provenanceByKey.has(manifest.forecast.provenance)) {
  throw new Error("forecast names an unknown provenance record");
}

/**
 * The scenario clock, resolved once. Nothing in this script reads the system date: every
 * DEMO_SIMULATION instant is derived from here, which is what makes the demo reproducible.
 */
const scenarioInstant = new Date(
  `${manifest.demoScenario.scenarioDate}T${manifest.demoScenario.scenarioTime}:00.000Z`,
);
const scenarioDay = (offsetDays: number, time: string): Date =>
  new Date(
    `${new Date(
      Date.parse(`${manifest.demoScenario.scenarioDate}T00:00:00.000Z`) + offsetDays * 86_400_000,
    )
      .toISOString()
      .slice(0, 10)}T${time}:00.000Z`,
  );

const pool = createPool(env.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-studio-seed-demo-project",
});
const db = createDatabase(pool);

try {
  await db.transaction(async (tx) => {
    const tenants = await tx
      .select({ id: appSchema.tenant.id })
      .from(appSchema.tenant)
      .where(eq(appSchema.tenant.slug, manifest.tenantSlug));
    const tenantId = tenants[0]?.id;
    if (!tenantId)
      throw new Error(`tenant ${manifest.tenantSlug} not found; run db:seed:dev first`);

    const [project] = await tx
      .insert(appSchema.project)
      .values({
        tenantId,
        slug: manifest.project.slug,
        name: manifest.project.name,
        profileKey: manifest.project.profileKey,
        profileVersion: manifest.project.profileVersion,
        lifecycle: manifest.project.lifecycle,
        locationLabel: manifest.project.locationLabel,
      })
      .onConflictDoUpdate({
        target: [appSchema.project.tenantId, appSchema.project.slug],
        set: {
          name: manifest.project.name,
          lifecycle: manifest.project.lifecycle,
          locationLabel: manifest.project.locationLabel,
          profileVersion: manifest.project.profileVersion,
        },
      })
      .returning({ id: appSchema.project.id });
    const projectId = project!.id;

    // Reload is idempotent: derived rows are replaced, then provenance, then re-inserted.
    await tx
      .delete(appSchema.metricSnapshot)
      .where(eq(appSchema.metricSnapshot.projectId, projectId));
    await tx
      .delete(appSchema.forecastSnapshot)
      .where(eq(appSchema.forecastSnapshot.projectId, projectId));
    await tx
      .delete(appSchema.attentionItem)
      .where(eq(appSchema.attentionItem.projectId, projectId));
    await tx
      .delete(appSchema.activityEvent)
      .where(eq(appSchema.activityEvent.projectId, projectId));
    await tx
      .delete(appSchema.provenanceInput)
      .where(eq(appSchema.provenanceInput.projectId, projectId));
    // Records written by an older run with random ids are removed; the deterministic ones are
    // updated in place below, so nothing that still references them is ever orphaned.
    await tx.execute(sql`
      delete from app.provenance_record pr
       where pr.project_id = ${projectId}
         and not exists (select 1 from app.survey_campaign c where c.provenance_id = pr.id)
         and not exists (select 1 from app.survey_version v where v.provenance_id = pr.id)
         and not exists (select 1 from app.field_assignment a where a.provenance_id = pr.id)
         and not exists (select 1 from app.field_visit fv where fv.provenance_id = pr.id)
         and not exists (select 1 from app.survey_instance si where si.provenance_id = pr.id)
         and not exists (select 1 from app.spatial_dataset_version dv where dv.provenance_id = pr.id)
         and not exists (select 1 from app.parcel p where p.provenance_id = pr.id)
         and not exists (select 1 from app.parcel_geometry g where g.provenance_id = pr.id)
         and not exists (select 1 from app.affectation af where af.provenance_id = pr.id)
         and not exists (select 1 from app.alignment al where al.provenance_id = pr.id)
         -- Social (Slice 4). A provenance-bearing table added later and forgotten here is a
         -- re-seed that fails on a foreign key, which is the loud version of the failure; the
         -- quiet version would be a dangling reference. Both are avoided by listing every one.
         and not exists (select 1 from app.taxonomy_version tv where tv.provenance_id = pr.id)
         and not exists (select 1 from app.classification_run cr where cr.provenance_id = pr.id)
         and not exists (select 1 from app.ai_classification ac where ac.provenance_id = pr.id)
         and not exists (select 1 from app.human_review hr where hr.provenance_id = pr.id)
    `);
    /*
     * Provenance ids are **derived from the fixture key**, not random.
     *
     * They used to be deleted and re-inserted with fresh UUIDs on every run. That was invisible
     * while every provenance-bearing row was also recreated, and became a dangling reference the
     * moment something was legitimately *reused* — a published questionnaire, or a campaign whose
     * assignments carry submitted responses that must not be deleted. A deterministic id means a
     * re-seed updates the record in place and every reference stays valid, which is what
     * idempotent actually has to mean here.
     */
    const provenanceIdFor = (key: string): string => {
      const digest = createHash("sha1").update(`${projectId}:${key}`).digest();
      const bytes = Buffer.from(digest.subarray(0, 16));
      // RFC 4122 variant and version bits, so the value is a well-formed UUID.
      bytes[6] = (bytes[6]! & 0x0f) | 0x50;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = bytes.toString("hex");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };

    const provenanceIds = new Map<string, string>();
    for (const record of provenanceByKey.values()) {
      const id = provenanceIdFor(record.key);
      provenanceIds.set(record.key, id);
      await tx
        .insert(appSchema.provenanceRecord)
        .values({
          id,
          tenantId,
          projectId,
          regime: record.regime,
          origin: record.origin,
          transformations: record.transformations,
          granularity: record.granularity,
          title: record.title,
          note: record.note,
          sourceLabel: record.sourceLabel,
          sourceReference: record.sourceReference,
          sourceVersion: record.sourceVersion,
          method: record.method,
          capturedAt: record.$capturedAtFromScenario
            ? scenarioInstant
            : record.capturedAt
              ? new Date(record.capturedAt)
              : null,
          validationState: record.validationState,
          validationNote: record.validationNote,
        })
        .onConflictDoUpdate({
          target: appSchema.provenanceRecord.id,
          set: {
            regime: record.regime,
            origin: record.origin,
            transformations: record.transformations,
            granularity: record.granularity,
            title: record.title,
            note: record.note,
            sourceLabel: record.sourceLabel,
            sourceReference: record.sourceReference,
            sourceVersion: record.sourceVersion,
            method: record.method,
            validationState: record.validationState,
            validationNote: record.validationNote,
          },
        });
    }
    const provenanceId = (key: string): string => {
      const id = provenanceIds.get(key);
      if (!id) throw new Error(`unknown provenance key ${key}`);
      return id;
    };

    // The forecast is DERIVED from the operational metrics: record the lineage edge so the
    // drawer can state what it was calculated from.
    await tx.insert(appSchema.provenanceInput).values({
      tenantId,
      projectId,
      provenanceId: provenanceId(manifest.forecast.provenance),
      inputProvenanceId: provenanceId("operations-demo"),
    });

    for (const metric of manifest.metrics) {
      await tx.insert(appSchema.metricSnapshot).values({
        id: randomUUID(),
        tenantId,
        projectId,
        key: metric.key,
        numericValue: metric.numericValue === undefined ? null : String(metric.numericValue),
        dateValue: metric.dateValue ?? null,
        note: metric.note,
        displayOrder: metric.displayOrder,
        observedAt: scenarioInstant,
        provenanceId: provenanceId(metric.provenance),
      });
    }

    const result = calculateForecast({
      pending: manifest.forecast.pending,
      dailyCompletions: manifest.forecast.dailyCompletions,
      windowDays: manifest.forecast.windowDays,
      calculatedFrom: manifest.demoScenario.scenarioDate,
      targetDate: manifest.forecast.targetDate,
      activeTechnicians: manifest.forecast.activeTechnicians,
      assignedTechnicians: manifest.forecast.assignedTechnicians,
      assumptions: manifest.forecast.assumptions,
    });
    await tx.insert(appSchema.forecastSnapshot).values({
      id: randomUUID(),
      tenantId,
      projectId,
      algorithmVersion: FORECAST_ALGORITHM_VERSION,
      // The scenario clock is persisted here, with the calculation it anchors (IG1-009).
      asOfDate: manifest.demoScenario.scenarioDate,
      pending: manifest.forecast.pending,
      dailyCompletions: manifest.forecast.dailyCompletions,
      windowDays: manifest.forecast.windowDays,
      movingAveragePerDay: String(result.movingAveragePerDay),
      requiredRatePerDay:
        result.requiredRatePerDay === null ? null : String(result.requiredRatePerDay),
      activeTechnicians: manifest.forecast.activeTechnicians,
      assignedTechnicians: manifest.forecast.assignedTechnicians,
      targetDate: manifest.forecast.targetDate,
      projectedCloseDate: result.projectedCloseDate,
      delayDays: result.delayDays,
      assumptions: manifest.forecast.assumptions,
      calculatedAt: scenarioInstant,
      provenanceId: provenanceId(manifest.forecast.provenance),
    });

    for (const item of manifest.attention) {
      await tx.insert(appSchema.attentionItem).values({
        id: randomUUID(),
        tenantId,
        projectId,
        severity: item.severity,
        title: item.title,
        note: item.note,
        surfaceLabel: item.surfaceLabel,
        surfaceKey: item.surfaceKey,
        actionLabel: item.actionLabel,
        displayOrder: item.displayOrder,
        provenanceId: provenanceId(item.provenance),
      });
    }

    for (const event of manifest.activity) {
      await tx.insert(appSchema.activityEvent).values({
        id: randomUUID(),
        tenantId,
        projectId,
        occurredAt: scenarioDay(event.dayOffset, event.time),
        actorLabel: event.actorLabel,
        action: event.action,
        objectLabel: event.objectLabel,
        provenanceId: provenanceId("activity-demo"),
      });
    }

    /* ------------------------------------------------------------------------------------
     * GIS: a reconstructed alignment and synthetic parcels, produced by the deterministic
     * generator rather than checked in as geometry, so the same seed always yields the same
     * corridor and every polygon is traceable to the code that made it.
     *
     * Geometry is persisted in the canonical CRS (EPSG:4326) exactly as the generator emits it.
     * Metres come from PostGIS transforming that geometry into the dataset's analysis CRS, which
     * is fixture configuration, not a constant of the product (ADR-017).
     * ---------------------------------------------------------------------------------- */
    const corridor = generateCorridor(manifest.gis.input);

    /*
     * Reuse an identical corridor rather than rebuilding it.
     *
     * A parcel's UUID is its identity (ADR-017, GIS_IMPORT_CONTRACT), and field assignments now
     * reference it. Deleting and recreating parcels on every seed would reissue those ids — the
     * exact thing an official import is forbidden to do — and the foreign key says so. So the
     * generator's output is compared against what is already stored, and only a genuinely
     * different corridor is rebuilt.
     */
    const existingCorridor = await tx.execute(sql`
      select v.generator_version, v.feature_count,
             (select count(*)::int from app.parcel p
               where p.tenant_id = v.tenant_id and p.project_id = v.project_id) as parcel_count
      from app.spatial_dataset_version v
      join app.spatial_dataset d on d.tenant_id = v.tenant_id and d.id = v.dataset_id
      where v.tenant_id = ${tenantId} and v.project_id = ${projectId}
        and d.kind = 'parcels' and v.is_active
      limit 1
    `);
    const storedCorridor = existingCorridor.rows[0] as unknown as
      { generator_version: string | null; feature_count: number; parcel_count: number } | undefined;
    const corridorMatches =
      storedCorridor !== undefined &&
      storedCorridor.generator_version === corridor.generatorVersion &&
      storedCorridor.feature_count === corridor.parcels.length &&
      storedCorridor.parcel_count === corridor.parcels.length;

    if (!corridorMatches) {
      await tx.delete(gisSchema.affectation).where(eq(gisSchema.affectation.projectId, projectId));
      await tx
        .delete(gisSchema.parcelGeometry)
        .where(eq(gisSchema.parcelGeometry.projectId, projectId));
      await tx.delete(gisSchema.parcel).where(eq(gisSchema.parcel.projectId, projectId));
      await tx.delete(gisSchema.alignment).where(eq(gisSchema.alignment.projectId, projectId));
      await tx
        .delete(gisSchema.spatialDatasetVersion)
        .where(eq(gisSchema.spatialDatasetVersion.projectId, projectId));
      await tx
        .delete(gisSchema.spatialDataset)
        .where(eq(gisSchema.spatialDataset.projectId, projectId));
    }

    /*
     * The analysis CRS is checked against `spatial_ref_sys` before anything is written: it must be
     * registered, projected, metre-based and usable by ST_Transform. The check reads the CRS
     * definition, never the SRID number (IG2-009). It runs whether or not the corridor is rebuilt,
     * because the chainage derivation below measures in it either way.
     */
    const analysisSrid = await assertAnalysisSridUsable(tx, manifest.gis.analysisSrid);

    if (!corridorMatches) {
      const lineWkt = `LINESTRING(${corridor.alignment.map(([x, y]) => `${x} ${y}`).join(",")})`;
      const ringWkt = (ring: ReadonlyArray<readonly [number, number]>) =>
        `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(",")}))`;
      /**
       * The SRIDs are inlined with `sql.raw` because a bound parameter arrives as text and PostGIS
       * then reads "4326" as a proj string. `CANONICAL_SRID` is a compile-time constant, and
       * `analysisSrid` has just been validated against the catalogue and re-parsed as an integer,
       * so neither is user input by the time it reaches SQL.
       */
      const canonical = sql.raw(String(CANONICAL_SRID));
      const analysis = sql.raw(String(analysisSrid));
      /** WKT → canonical geometry, stored as the generator emitted it. */
      const toCanonical = (wkt: string) => sql`ST_GeomFromText(${wkt}, ${canonical})`;
      /**
       * Canonical geometry → an analysis CRS, where metres mean metres.
       *
       * Which analysis CRS is a property of the **dataset whose measurement it is** (IG2-009). In
       * this fixture all three layers share one, so the parameter looks redundant; it is not. An
       * official import can bring parcels in one CRS and an alignment in another, and then a
       * parcel's area must come from the parcels dataset while the corridor's length and every
       * chainage along it must come from the alignment dataset. Passing it explicitly is what stops
       * a future import from measuring a road with a parcel layer's CRS.
       */
      const forMetrics = (wkt: string, srid = analysis) =>
        sql`ST_Transform(${toCanonical(wkt)}, ${srid})`;

      const datasets = {
        alignment: { id: randomUUID(), versionId: randomUUID() },
        parcels: { id: randomUUID(), versionId: randomUUID() },
        affectations: { id: randomUUID(), versionId: randomUUID() },
      } as const;

      const datasetSpec = [
        {
          kind: "alignment" as const,
          label: manifest.gis.alignmentLabel,
          ids: datasets.alignment,
          versionLabel: "alignment_v1",
          featureCount: 1,
          provenance: "alignment-reconstructed",
        },
        {
          kind: "parcels" as const,
          label: "Predios frentistas",
          ids: datasets.parcels,
          versionLabel: "parcels_v1",
          featureCount: corridor.parcels.length,
          provenance: "parcels-synthetic",
        },
        {
          kind: "affectations" as const,
          label: "Afectación por derecho de vía",
          ids: datasets.affectations,
          versionLabel: "affectations_v1",
          featureCount: corridor.parcels.filter((p) => p.affectationRing).length,
          provenance: "affectations-synthetic",
        },
      ];

      for (const spec of datasetSpec) {
        await tx.insert(gisSchema.spatialDataset).values({
          id: spec.ids.id,
          tenantId,
          projectId,
          kind: spec.kind,
          label: spec.label,
        });
        await tx.insert(gisSchema.spatialDatasetVersion).values({
          id: spec.ids.versionId,
          tenantId,
          projectId,
          datasetId: spec.ids.id,
          versionLabel: spec.versionLabel,
          origin: "generated",
          // The generator works in a local metric frame and emits lon/lat, so canonical storage is
          // also what it produced; the analysis CRS is where this project's metres are measured.
          sourceSrid: CANONICAL_SRID,
          analysisSrid: analysisSrid,
          generatorVersion: corridor.generatorVersion,
          featureCount: spec.featureCount,
          isActive: true,
          supersedesVersionId: null,
          producedAt: scenarioInstant,
          note: manifest.gis.$comment,
          provenanceId: provenanceId(spec.provenance),
        });
      }

      await tx.insert(gisSchema.alignment).values({
        id: randomUUID(),
        tenantId,
        projectId,
        datasetVersionId: datasets.alignment.versionId,
        label: manifest.gis.alignmentLabel,
        geom: toCanonical(lineWkt) as unknown as string,
        // Measured by PostGIS in the analysis CRS, never taken from the generator's own arithmetic.
        lengthM: sql`ST_Length(${forMetrics(lineWkt)})` as unknown as string,
        provenanceId: provenanceId("alignment-reconstructed"),
      });

      for (const generated of corridor.parcels) {
        const parcelId = randomUUID();
        await tx.insert(gisSchema.parcel).values({
          id: parcelId,
          tenantId,
          projectId,
          parcelCode: generated.parcelCode,
          sectorLabel: generated.sectorLabel,
          side: generated.side,
          status: generated.status,
          // Chainage is derived from geometry after the parcels are in place (see below), not
          // carried over from the generator: two numbers for one fact drift.
          chainageM: null,
          chainageMethod: null,
          frontageM: String(generated.frontageM),
          provenanceId: provenanceId("parcels-synthetic"),
        });
        const polygon = ringWkt(generated.ring as ReadonlyArray<readonly [number, number]>);
        await tx.insert(gisSchema.parcelGeometry).values({
          id: randomUUID(),
          tenantId,
          projectId,
          parcelId,
          datasetVersionId: datasets.parcels.versionId,
          geom: toCanonical(polygon) as unknown as string,
          // Area is computed by PostGIS in the analysis CRS, never in the generator.
          areaM2: sql`ST_Area(${forMetrics(polygon)})` as unknown as string,
          isActive: true,
          provenanceId: provenanceId("parcels-synthetic"),
        });
        if (generated.affectationRing) {
          const strip = ringWkt(
            generated.affectationRing as ReadonlyArray<readonly [number, number]>,
          );
          await tx.insert(gisSchema.affectation).values({
            id: randomUUID(),
            tenantId,
            projectId,
            parcelId,
            datasetVersionId: datasets.affectations.versionId,
            category: "right_of_way",
            geom: toCanonical(strip) as unknown as string,
            affectedAreaM2: sql`ST_Area(${forMetrics(strip)})` as unknown as string,
            provenanceId: provenanceId("affectations-synthetic"),
          });
        }
      }
    }

    /*
     * Chainage, derived (IG2-003). One deterministic method, computed by PostGIS from the
     * geometry that is actually stored:
     *
     *   parcel centroid → ST_LineLocatePoint on the active alignment → fraction along the line
     *   → × the alignment's length measured in the analysis CRS → metres.
     *
     * It is `centroid_projection` and not `frontage_midpoint` because a frontage midpoint would
     * claim we know where each parcel meets the road, and for synthetic polygons we do not: the
     * centroid is a fact of the geometry we have. Deriving it here rather than carrying the
     * generator's own number means there is one chainage, not two that can disagree.
     *
     * Chainage is a reference along the corridor. It is never identity: the parcel's UUID and its
     * business code are unaffected by it.
     */
    const chainage = await tx.execute(sql`
      with axis as (
        -- The alignment dataset's own analysis CRS, read from its version row: a distance along
        -- the road is the road layer's measurement, never the parcel layer's.
        select ST_Transform(a.geom, v.analysis_srid) as geom,
               v.analysis_srid as srid,
               ST_Length(ST_Transform(a.geom, v.analysis_srid)) as length_m
        from app.alignment a
        join app.spatial_dataset_version v
          on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
        where a.tenant_id = ${tenantId} and a.project_id = ${projectId}
        limit 1
      )
      update app.parcel p
         set chainage_m = round((
               ST_LineLocatePoint(
                 axis.geom,
                 -- The parcel centroid is projected into the *alignment's* CRS, so both sides of
                 -- the measurement live in one coordinate system.
                 ST_Centroid(ST_Transform(g.geom, axis.srid))
               ) * axis.length_m
             )::numeric, 1),
             chainage_method = 'centroid_projection'
        from app.parcel_geometry g, axis
       where g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
         and p.tenant_id = ${tenantId} and p.project_id = ${projectId}
      returning p.id
    `);

    /* ------------------------------------------------------------------------------------
     * FieldFlow: a reconstructed questionnaire and a small demonstration campaign.
     *
     * Deliberately *not* the study's 119 socioeconomic surveys. That figure is a historical
     * aggregate from a concluded study and stays a HISTORICAL_OBSERVED metric; this is a
     * DEMO_SIMULATION campaign with a much smaller universe, chosen so the two can never be
     * mistaken for each other on a screen or in a query.
     * ---------------------------------------------------------------------------------- */
    const field = manifest.field;

    /*
     * Idempotent *without* deleting the questionnaire.
     *
     * The immutability triggers refuse to delete a published version, and they are right to: a
     * questionnaire that answers reference is never removed. So re-seeding finds what already
     * exists rather than recreating it, and publishes a **new version** when the fixture's
     * definition has actually changed — which is exactly the behaviour the product requires of a
     * real questionnaire edit.
     */
    await tx
      .delete(fieldSchema.projectConfiguration)
      .where(eq(fieldSchema.projectConfiguration.projectId, projectId));

    // Offline policy is project configuration, not a capability (D-020, ADR-018).
    await tx.insert(fieldSchema.projectConfiguration).values({
      id: randomUUID(),
      tenantId,
      projectId,
      key: FIELD_OFFLINE_MODE_KEY,
      value: field.offlineMode,
    });

    const existingTemplate = await tx.execute(sql`
      select id from app.survey_template
      where tenant_id = ${tenantId} and project_id = ${projectId} and key = ${field.template.key}
    `);
    const templateId =
      (existingTemplate.rows[0] as unknown as { id: string } | undefined)?.id ?? randomUUID();
    if (existingTemplate.rows.length === 0) {
      await tx.insert(fieldSchema.surveyTemplate).values({
        id: templateId,
        tenantId,
        projectId,
        key: field.template.key,
        name: field.template.name,
        description: field.template.description,
      });
    }

    // Publishable *before* it is published: after publication the definition cannot be corrected.
    assertSurveyVersionPublishable(field.version.questions);
    const definitionHash = surveyVersionHash(field.version.questions);

    // A published version whose definition already matches is reused, not rebuilt. A fixture whose
    // questions have changed produces a *new* version instead, exactly as a real edit would.
    const publishedMatch = await tx.execute(sql`
      select id, version_label from app.survey_version
      where tenant_id = ${tenantId} and template_id = ${templateId}
        and status = 'PUBLISHED' and definition_hash = ${definitionHash}
      order by created_at limit 1
    `);
    const reused = publishedMatch.rows[0] as unknown as
      { id: string; version_label: string } | undefined;

    const optionIdByCode = new Map<string, string>();
    let versionId: string;
    let versionLabel: string;

    if (reused) {
      versionId = reused.id;
      versionLabel = reused.version_label;
      const optionRows = await tx.execute(sql`
        select q.code as question_code, o.code as option_code, o.id
        from app.survey_option o
        join app.survey_question q on q.tenant_id = o.tenant_id and q.id = o.question_id
        where o.tenant_id = ${tenantId} and q.version_id = ${versionId}
      `);
      for (const row of optionRows.rows as unknown as ReadonlyArray<{
        question_code: string;
        option_code: string;
        id: string;
      }>) {
        optionIdByCode.set(`${row.question_code}:${row.option_code}`, row.id);
      }
    } else {
      const priorVersions = await tx.execute(sql`
        select count(*)::int as n from app.survey_version
        where tenant_id = ${tenantId} and template_id = ${templateId}
      `);
      const next = ((priorVersions.rows[0] as unknown as { n: number }).n ?? 0) + 1;
      versionId = randomUUID();
      versionLabel = next === 1 ? field.version.versionLabel : `v${next}`;
      await tx.insert(fieldSchema.surveyVersion).values({
        id: versionId,
        tenantId,
        projectId,
        templateId,
        versionLabel,
        status: "DRAFT",
        provenanceId: provenanceId("field-questionnaire-reconstructed"),
      });
      await seedQuestions(versionId, { tenantId, projectId });
      await tx
        .update(fieldSchema.surveyVersion)
        .set({ status: "PUBLISHED", publishedAt: scenarioInstant, definitionHash })
        .where(eq(fieldSchema.surveyVersion.id, versionId));
    }

    // Ids are passed in rather than captured: a closure crosses a control-flow boundary, so the
    // narrowing that proved `tenantId` non-undefined at the top of this transaction does not
    // reach inside. Threading them through is clearer than convincing the checker.
    async function seedQuestions(
      targetVersionId: string,
      scope: { tenantId: string; projectId: string },
    ): Promise<void> {
      for (const question of field.version.questions) {
        const questionId = randomUUID();
        await tx.insert(fieldSchema.surveyQuestion).values({
          id: questionId,
          tenantId: scope.tenantId,
          projectId: scope.projectId,
          versionId: targetVersionId,
          code: question.code,
          ordinal: question.ordinal,
          type: question.type,
          prompt: question.prompt,
          helpText: question.helpText,
          required: question.required,
          sensitivity: question.sensitivity,
        });
        for (const option of question.options) {
          const optionId = randomUUID();
          optionIdByCode.set(`${question.code}:${option.code}`, optionId);
          await tx.insert(fieldSchema.surveyOption).values({
            id: optionId,
            tenantId: scope.tenantId,
            projectId: scope.projectId,
            questionId,
            code: option.code,
            label: option.label,
            ordinal: option.ordinal,
          });
        }
      }
    }

    const campaignRows = await tx.execute(sql`
      select id from app.survey_campaign
      where tenant_id = ${tenantId} and project_id = ${projectId} and name = ${field.campaign.name}
    `);
    const campaignId =
      (campaignRows.rows[0] as unknown as { id: string } | undefined)?.id ?? randomUUID();
    const campaignExists = campaignRows.rows.length > 0;
    const dayOffset = (days: number) =>
      new Date(scenarioInstant.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    if (!campaignExists) {
      await tx.insert(fieldSchema.surveyCampaign).values({
        id: campaignId,
        tenantId,
        projectId,
        name: field.campaign.name,
        surveyVersionId: versionId,
        status: field.campaign.status,
        captureChannel: field.captureChannel,
        offlineModeAtActivation: field.campaign.status === "DRAFT" ? null : field.offlineMode,
        startsOn: dayOffset(field.campaign.startsOnOffsetDays),
        targetOn: dayOffset(field.campaign.targetOnOffsetDays),
        activatedAt: field.campaign.status === "DRAFT" ? null : scenarioInstant,
        provenanceId: provenanceId("field-campaign-demo"),
      });
    }

    // Technicians must already exist as project members; `pnpm e2e:prepare` provisions them.
    const technicianRows = await tx.execute(sql`
      select u.id as user_id, u.email, pm.id as membership_id
      from app."user" u
      join app.tenant_membership tm on tm.tenant_id = ${tenantId} and tm.user_id = u.id
      join app.project_membership pm
        on pm.tenant_id = ${tenantId} and pm.project_id = ${projectId}
       and pm.tenant_membership_id = tm.id
      where u.email in (${field.technician.email}, ${field.secondTechnician.email})
    `);
    const technicians = technicianRows.rows as unknown as ReadonlyArray<{
      user_id: string;
      email: string;
      membership_id: string;
    }>;
    const primary = technicians.find((t) => t.email === field.technician.email);
    const secondary = technicians.find((t) => t.email === field.secondTechnician.email);

    let assignmentsSeeded = 0;
    let submissionsSeeded = 0;

    if (!primary) {
      console.warn(
        `field: no project membership for ${field.technician.email}; campaign seeded without ` +
          "assignments. Run `pnpm e2e:prepare` to provision the synthetic technicians.",
      );
    } else {
      // A small slice of the corridor, taken deterministically so re-seeding is reproducible.
      const targetParcels = await tx.execute(sql`
        select id, parcel_code from app.parcel
        where tenant_id = ${tenantId} and project_id = ${projectId}
        order by chainage_m nulls last, parcel_code
        limit ${field.campaign.assignmentCount}
      `);
      const parcels = targetParcels.rows as unknown as ReadonlyArray<{
        id: string;
        parcel_code: string;
      }>;

      // Assignments already placed on a previous run are left exactly as they are — including the
      // visits and submitted responses hanging off them, which are immutable by design. Re-seeding
      // fills gaps; it does not re-do work.
      const placed = await tx.execute(sql`
        select parcel_id from app.field_assignment
        where tenant_id = ${tenantId} and campaign_id = ${campaignId}
      `);
      const alreadyAssigned = new Set(
        (placed.rows as unknown as ReadonlyArray<{ parcel_id: string }>).map(
          (row) => row.parcel_id,
        ),
      );

      for (const [index, target] of parcels.entries()) {
        // Every third assignment goes to the second technician, so "another technician's work
        // is invisible" is something the demo can actually demonstrate.
        const owner: { user_id: string; email: string; membership_id: string } =
          secondary && index % 3 === 2 ? secondary : primary;
        const completed = index < field.campaign.completedCount && owner.email === primary.email;

        if (alreadyAssigned.has(target.id)) {
          assignmentsSeeded += 1;
          if (completed) submissionsSeeded += 1;
          continue;
        }

        const assignmentId = randomUUID();
        await tx.insert(fieldSchema.fieldAssignment).values({
          id: assignmentId,
          tenantId,
          projectId,
          campaignId,
          parcelId: target.id,
          assigneeMembershipId: owner.membership_id,
          assigneeUserId: owner.user_id,
          status: completed ? "COMPLETED" : "PENDING",
          assignedAt: new Date(scenarioInstant.getTime() - 5 * 86_400_000),
          completedAt: completed
            ? new Date(scenarioInstant.getTime() - (4 - index) * 3_600_000)
            : null,
          provenanceId: provenanceId("field-campaign-demo"),
        });
        assignmentsSeeded += 1;

        if (!completed) continue;

        const visitStart = new Date(scenarioInstant.getTime() - (5 - index) * 3_600_000);
        const visitId = randomUUID();
        await tx.execute(sql`
          insert into app.field_visit
            (id, tenant_id, project_id, assignment_id, technician_user_id, status, started_at,
             completed_at, location, location_accuracy_m, location_captured_at, location_outcome,
             provenance_id)
          values (
            ${visitId}, ${tenantId}, ${projectId}, ${assignmentId}, ${owner.user_id},
            'COMPLETED', ${visitStart}, ${new Date(visitStart.getTime() + 40 * 60_000)},
            ST_SetSRID(ST_MakePoint(
              ${field.syntheticLocation.longitude + index * 0.0008},
              ${field.syntheticLocation.latitude + index * 0.0004}
            ), 4326),
            ${field.syntheticLocation.accuracyM}, ${visitStart}, 'captured',
            ${provenanceId("field-campaign-demo")}
          )
        `);

        const instanceId = randomUUID();
        await tx.insert(fieldSchema.surveyInstance).values({
          id: instanceId,
          tenantId,
          projectId,
          assignmentId,
          visitId,
          surveyVersionId: versionId,
          respondentUserId: owner.user_id,
          status: "IN_PROGRESS",
          startedAt: visitStart,
          provenanceId: provenanceId("field-campaign-demo"),
        });

        // Deterministic synthetic answers. Nothing here is a real person's words.
        const tenure = ["owner_occupier", "tenant", "owner_absent", "caretaker", "owner_occupier"][
          index % 5
        ]!;
        const activity = ["agriculture", "livestock", "commerce", "agriculture", "employment"][
          index % 5
        ]!;
        const concerns = [
          "Preocupa el polvo durante la construcción y el acceso al predio mientras dure la obra.",
          "Consulta por el cruce peatonal cerca de la escuela.",
          "Interesa saber si el acceso vehicular al predio se mantendrá durante los trabajos.",
          "Preocupa el ruido en horario nocturno.",
          "Espera que la vía mejore el traslado de productos al mercado.",
        ];

        const answerFor = async (
          questionCode: string,
          values: {
            text?: string;
            number?: number;
            boolean?: boolean;
            date?: string;
            option?: string;
            options?: ReadonlyArray<string>;
          },
        ) => {
          const questionRows = await tx.execute(sql`
            select id from app.survey_question
            where tenant_id = ${tenantId} and version_id = ${versionId} and code = ${questionCode}
          `);
          const questionRow = questionRows.rows[0] as unknown as { id: string } | undefined;
          if (!questionRow) return;
          const answerId = randomUUID();
          await tx.insert(fieldSchema.surveyAnswer).values({
            id: answerId,
            tenantId,
            projectId,
            instanceId,
            questionId: questionRow.id,
            textValue: values.text ?? null,
            numberValue: values.number === undefined ? null : String(values.number),
            booleanValue: values.boolean ?? null,
            dateValue: values.date ?? null,
            optionId: values.option
              ? (optionIdByCode.get(`${questionCode}:${values.option}`) ?? null)
              : null,
          });
          for (const optionCode of values.options ?? []) {
            const optionId = optionIdByCode.get(`${questionCode}:${optionCode}`);
            if (!optionId) continue;
            await tx.insert(fieldSchema.surveyAnswerOption).values({
              id: randomUUID(),
              tenantId,
              projectId,
              answerId,
              optionId,
            });
          }
        };

        await answerFor("tenure_category", { option: tenure });
        await answerFor("main_activity", { option: activity });
        await answerFor("expected_benefits", {
          options: index % 2 === 0 ? ["access", "market"] : ["transport_cost", "services"],
        });
        await answerFor("has_concern", { boolean: index % 2 === 0 });
        if (index % 2 === 0) await answerFor("concern_text", { text: concerns[index % 5]! });
        await answerFor("household_size", { number: 2 + (index % 5) });
        await answerFor("interview_date", { date: dayOffset(-(5 - index)) });

        await tx
          .update(fieldSchema.surveyInstance)
          .set({ status: "SUBMITTED", submittedAt: new Date(visitStart.getTime() + 35 * 60_000) })
          .where(eq(fieldSchema.surveyInstance.id, instanceId));
        submissionsSeeded += 1;
      }
    }

    /**
     * The reconstructed coding scheme (Slice 4).
     *
     * Idempotent in the way this seeder has had to learn to be: a published taxonomy version is
     * immutable and classifications point at it, so a re-seed *reuses* the matching published
     * version rather than deleting and recreating it. Only a genuinely different definition —
     * a different content hash — publishes a new version, which is exactly the behaviour the
     * product requires of a real refinement.
     */
    const social = manifest.social;
    const taxonomyDefinitionHashValue = socialTaxonomyHash(social.version.categories);

    const existingTaxonomy = await tx.execute(sql`
      select id from app.taxonomy
       where tenant_id = ${tenantId} and project_id = ${projectId} and key = ${social.taxonomy.key}
    `);
    let taxonomyId = (existingTaxonomy.rows[0] as { id: string } | undefined)?.id;
    if (!taxonomyId) {
      taxonomyId = randomUUID();
      await tx.insert(socialSchema.taxonomy).values({
        id: taxonomyId,
        tenantId,
        projectId,
        key: social.taxonomy.key,
        name: social.taxonomy.name,
        description: social.taxonomy.description,
      });
    } else {
      await tx
        .update(socialSchema.taxonomy)
        .set({ name: social.taxonomy.name, description: social.taxonomy.description })
        .where(eq(socialSchema.taxonomy.id, taxonomyId));
    }

    const matchingVersion = await tx.execute(sql`
      select id, version_label from app.taxonomy_version
       where tenant_id = ${tenantId} and taxonomy_id = ${taxonomyId}
         and status = 'PUBLISHED' and definition_hash = ${taxonomyDefinitionHashValue}
       limit 1
    `);
    let taxonomyVersionsSeeded = 0;
    let taxonomyVersionLabel =
      (matchingVersion.rows[0] as { version_label: string } | undefined)?.version_label ?? null;

    if (!taxonomyVersionLabel) {
      const priorVersions = await tx.execute(sql`
        select count(*)::int as n from app.taxonomy_version
         where tenant_id = ${tenantId} and taxonomy_id = ${taxonomyId}
      `);
      const next = ((priorVersions.rows[0] as unknown as { n: number }).n ?? 0) + 1;
      const taxonomyVersionId = randomUUID();
      taxonomyVersionLabel = next === 1 ? social.version.versionLabel : `v${next}`;
      await tx.insert(socialSchema.taxonomyVersion).values({
        id: taxonomyVersionId,
        tenantId,
        projectId,
        taxonomyId,
        versionLabel: taxonomyVersionLabel,
        status: "DRAFT",
        sourceNote: social.version.sourceNote,
        provenanceId: provenanceId("social-taxonomy-reconstructed"),
      });
      for (const category of social.version.categories) {
        await tx.insert(socialSchema.taxonomyCategory).values({
          id: randomUUID(),
          tenantId,
          projectId,
          versionId: taxonomyVersionId,
          code: category.code,
          label: category.label,
          description: category.description,
          ordinal: category.ordinal,
        });
      }
      // Published last, exactly as the application would: the triggers refuse category writes
      // afterwards, so a seeder that published first would be unable to write its own categories.
      await tx
        .update(socialSchema.taxonomyVersion)
        .set({
          status: "PUBLISHED",
          publishedAt: scenarioInstant,
          definitionHash: taxonomyDefinitionHashValue,
        })
        .where(eq(socialSchema.taxonomyVersion.id, taxonomyVersionId));
      taxonomyVersionsSeeded = 1;
    }

    // No AI classifications are seeded, here or anywhere. A proposal in the database must have
    // come from a model that actually ran; a fabricated one would be indistinguishable from a
    // real result and would corrupt every later comparison (Slice 4 §68).

    console.log(
      [
        `project "${manifest.project.slug}" seeded`,
        `scenario ${manifest.demoScenario.scenarioDate}`,
        `${manifest.metrics.length} metrics`,
        `forecast ${result.projectedCloseDate} (delay ${result.delayDays}d, rate ${result.movingAveragePerDay}/día)`,
        `${manifest.attention.length} attention items`,
        `${manifest.activity.length} activity events`,
        `GIS ${corridor.parcels.length} parcels · alignment ${(corridor.alignmentLengthM / 1000).toFixed(2)} km · ${corridor.generatorVersion}`,
        `chainage derived for ${chainage.rowCount ?? 0} parcels (centroid_projection, alignment CRS EPSG:${analysisSrid})`,
        `field: ${assignmentsSeeded} assignments · ${submissionsSeeded} submitted · offline_mode=${field.offlineMode}`,
        `social: taxonomy ${taxonomyVersionLabel} (${social.version.categories.length} categorías, ${taxonomyVersionsSeeded === 1 ? "nueva" : "reutilizada"}) · 0 clasificaciones sembradas`,
      ].join(" · "),
    );
  });
} finally {
  await pool.end();
}
