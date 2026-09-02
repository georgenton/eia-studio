import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appEnvSchema, loadEnv, migratorDatabaseEnvSchema } from "@eia/contracts";
import { appSchema, createDatabase, createPool } from "@eia/db";
import {
  calculateForecast,
  FORECAST_ALGORITHM_VERSION,
  GRANULARITIES,
  METRIC_KEYS,
  ORIGINS,
  REGIMES,
  TRANSFORMATIONS,
  VALIDATION_STATES,
} from "@eia/domain";
import { config as loadDotenv } from "dotenv";
import { eq } from "drizzle-orm";
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
     * session in any future month shows the same figures. It never falls back to the system date.
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
        demoScenarioDate: z.iso.date(),
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
        demoScenarioDate: manifest.project.demoScenarioDate,
      })
      .onConflictDoUpdate({
        target: [appSchema.project.tenantId, appSchema.project.slug],
        set: {
          name: manifest.project.name,
          lifecycle: manifest.project.lifecycle,
          locationLabel: manifest.project.locationLabel,
          profileVersion: manifest.project.profileVersion,
          demoScenarioDate: manifest.project.demoScenarioDate,
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

    console.log(
      [
        `project "${manifest.project.slug}" seeded`,
        `scenario ${manifest.demoScenario.scenarioDate}`,
        `${manifest.metrics.length} metrics`,
        `forecast ${result.projectedCloseDate} (delay ${result.delayDays}d, rate ${result.movingAveragePerDay}/día)`,
        `${manifest.attention.length} attention items`,
        `${manifest.activity.length} activity events`,
      ].join(" · "),
    );
  });
} finally {
  await pool.end();
}
