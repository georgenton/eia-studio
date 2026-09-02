import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appEnvSchema, loadEnv, migratorDatabaseEnvSchema } from "@eia/contracts";
import { appSchema, createDatabase, createPool, gisSchema } from "@eia/db";
import {
  calculateForecast,
  CORRIDOR_GENERATOR_VERSION,
  corridorGeneratorInputSchema,
  FORECAST_ALGORITHM_VERSION,
  generateCorridor,
  GRANULARITIES,
  METRIC_KEYS,
  CANONICAL_SRID,
  ORIGINS,
  REGIMES,
  sridSchema,
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
    await tx
      .delete(appSchema.provenanceRecord)
      .where(eq(appSchema.provenanceRecord.projectId, projectId));

    const provenanceIds = new Map<string, string>();
    for (const record of provenanceByKey.values()) {
      const id = randomUUID();
      provenanceIds.set(record.key, id);
      await tx.insert(appSchema.provenanceRecord).values({
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

    const lineWkt = `LINESTRING(${corridor.alignment.map(([x, y]) => `${x} ${y}`).join(",")})`;
    const ringWkt = (ring: ReadonlyArray<readonly [number, number]>) =>
      `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(",")}))`;
    /*
     * The analysis CRS is checked against `spatial_ref_sys` before anything is written: it must
     * be registered, projected, metre-based and usable by ST_Transform. The check reads the CRS
     * definition, never the SRID number (IG2-009). Doing it here means a bad fixture fails with a
     * sentence, at the start, rather than as a PostGIS exception on the last insert.
     */
    const analysisSrid = await assertAnalysisSridUsable(tx, manifest.gis.analysisSrid);

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
      ].join(" · "),
    );
  });
} finally {
  await pool.end();
}
