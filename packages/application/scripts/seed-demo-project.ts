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
  qualitySchema,
  socialSchema,
} from "@eia/db";
import {
  calculateForecast,
  FORECAST_ALGORITHM_VERSION,
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
import { importPgasChapter } from "../src/pgas/import";
import { ingestDocumentVersionInTx } from "../src/documents/ingest";
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
        /** The study's own cover title and the programme it belongs to (both optional). */
        officialTitle: z.string().min(1).optional(),
        programmeReference: z.string().min(1).optional(),
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
    /**
     * The project's cartography, as delivered by the consultancy.
     *
     * Until the package arrived this held the corridor generator's inputs and the geometry was
     * produced deterministically. It now names sanitized GeoJSON files extracted from the real
     * File Geodatabase (ADR-023): the geometry *is* in the fixture, because it is a fact of the
     * study rather than something an algorithm can reproduce. The generator and its schema remain
     * in the codebase for a project that has no package yet.
     */
    gis: z
      .object({
        $comment: z.string(),
        /** Projected CRS this project's lengths and areas are measured in (ADR-017). */
        analysisSrid: sridSchema,
        crsBasis: z.enum(["DEMO_ASSUMPTION", "SOURCE_DECLARED"]),
        alignmentLabel: z.string().min(1),
        /** What was received, so a figure on screen can be traced back to a file and a hash. */
        source: z
          .object({
            archive: z.string().min(1),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            receivedAt: z.string().min(1),
            dataset: z.string().min(1),
            sourceSrid: sridSchema,
            sanitization: z.string().min(1),
          })
          .strict(),
        /**
         * Declares that this project's existing parcels are placeholders for the incoming package
         * and may be renamed to its codes, in order along the corridor. A one-time transition,
         * written down rather than inferred (ADR-023); absent, an unmatched code creates a parcel.
         */
        placeholderRemap: z.literal("ordinal_along_corridor").optional(),
        files: z
          .object({
            alignment: z.string().min(1),
            parcels: z.string().min(1),
            affectations: z.string().min(1),
            chainage: z.string().min(1),
            influenceAreas: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    /** The management plan chapter as the consultancy delivered it (ADR-024). */
    pgas: z
      .object({
        $comment: z.string(),
        file: z.string().min(1),
      })
      .strict()
      .optional(),
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
    /**
     * Values read by hand out of the concluded study's corpus (Slice 5, ADR-020 §5).
     *
     * They live in the fixture rather than in code because they are one project's documents, and
     * they carry **no page number**: no document has been ingested, so a page would be a
     * fabricated citation in the one field whose purpose is that a finding can be checked.
     */
    /**
     * Short excerpts transcribed by hand from the concluded study's file (Slice 6).
     *
     * They live in the fixture because they are one project's documents, and they are labelled
     * `RECONSTRUCTED_EXCERPT`: the original PDFs are external source material and are not in this
     * system. `assertionKeys` links a document to the Quality Gate assertions that were read from
     * it, so a finding can cite the passage rather than only a reference typed by hand.
     */
    documents: z
      .object({
        $comment: z.string(),
        items: z
          .array(
            z
              .object({
                code: z.string().regex(/^DOC-\d{3,}$/),
                title: z.string().min(3),
                kind: z.enum(["report", "annex", "minutes", "plan", "legal", "other"]),
                versionLabel: z.string().min(1),
                sourceNote: z.string().min(3),
                pages: z
                  .array(
                    z
                      .object({ number: z.number().int().positive(), text: z.string().min(1) })
                      .strict(),
                  )
                  .min(1),
                assertionKeys: z.array(z.string().min(3)),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    quality: z
      .object({
        $comment: z.string(),
        assertions: z
          .array(
            z
              .object({
                key: z.string().min(3),
                sourceRef: z.string().min(3),
                valueText: z.string().min(1).optional(),
                valueNumber: z.number().optional(),
                valueDate: z
                  .string()
                  .regex(/^\d{4}-\d{2}-\d{2}$/)
                  .optional(),
                valueBoolean: z.boolean().optional(),
                quote: z.string().min(1).optional(),
                qualifier: z.string().min(1).optional(),
              })
              .strict()
              // Exactly one value, matching the CHECK in migration 0019: a row carrying two lets a
              // rule silently read the wrong one and raise a finding about nothing.
              .refine(
                (a) =>
                  [a.valueText, a.valueNumber, a.valueDate, a.valueBoolean].filter(
                    (v) => v !== undefined,
                  ).length === 1,
                { message: "an assertion holds exactly one value" },
              ),
          )
          .min(1),
      })
      .strict(),
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
        officialTitle: manifest.project.officialTitle ?? null,
        programmeReference: manifest.project.programmeReference ?? null,
      })
      .onConflictDoUpdate({
        target: [appSchema.project.tenantId, appSchema.project.slug],
        set: {
          name: manifest.project.name,
          lifecycle: manifest.project.lifecycle,
          locationLabel: manifest.project.locationLabel,
          officialTitle: manifest.project.officialTitle ?? null,
          programmeReference: manifest.project.programmeReference ?? null,
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
         -- Quality Gate (Slice 5), same discipline.
         and not exists (select 1 from app.document_assertion da where da.provenance_id = pr.id)
         and not exists (select 1 from app.quality_run qr where qr.provenance_id = pr.id)
         and not exists (select 1 from app.quality_finding qf where qf.provenance_id = pr.id)
         -- Documents (Slice 6).
         and not exists (select 1 from app.document_version dv where dv.provenance_id = pr.id)
         -- Reports (Slice 7): a generated version records how it was produced.
         and not exists (select 1 from app.report_version rv where rv.provenance_id = pr.id)
         -- The management plan (ADR-024): a superseded import run keeps its provenance, because
         -- a figure quoted from last month's plan must still be explainable.
         and not exists (select 1 from app.pgas_import_run ir where ir.provenance_id = pr.id)
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

    /** Counts of what the import actually did, printed at the end so a re-seed is auditable. */
    let gisImportReport: {
      parcelsMatched: number;
      parcelsCreated: number;
      parcelsUnmatched: number;
      affectations: number;
      orphanAffectations: number;
      influenceAreas: number;
      chainageDeclared: number;
      chainageUnmatched: number;
      sideDerived: number;
    } | null = null;

    /* ------------------------------------------------------------------------------------
     * GIS: the real cartography of the study, imported from the consultancy's package.
     *
     * Until this package arrived the corridor was produced by a deterministic generator, because
     * inventing a plausible corridor was more honest than pretending to have the real one. The
     * package is here now, so the geometry in `gis/*.geojson` is the study's own: the surveyed
     * centreline, the 141 fronting parcels with the codes the field sheet uses, the 71 affectation
     * polygons and the four influence areas the study delimited.
     *
     * **This is a supersede, not a rebuild** — the shape `docs/GIS_IMPORT_CONTRACT.md` §1
     * described before there was anything to import. A parcel keeps its UUID; its old boundary is
     * deactivated and a new one written against the new dataset version; the synthetic versions
     * stay, inactive, named by `supersedes_version_id`. Nothing is deleted, which is what lets this
     * run against persistent staging: an assignment, a visit, a response, a coding and a
     * specialist's decision all still point at the parcel they always did.
     *
     * Three things this import deliberately does **not** do (ADR-023):
     *
     *   - it carries **no owner-bearing attribute**. Names, deeds, compensation agreements,
     *     surveyor names, photographs and field notes were stripped before anything reached this
     *     repository, under an allowlist that denies by default. The compliance gate of
     *     SECURITY.md §10a is unopened and this import does not lean on it;
     *   - it **repairs nothing**. Code `090` still has an affectation and no parcel, `091` still
     *     has no declared chainage, `042a` is still a second spelling of `042A`. Those are the
     *     package's own inconsistencies and the Quality Gate's business, not an importer's;
     *   - it **measures nothing itself**. Lengths and areas come from PostGIS transforming the
     *     stored geometry into the dataset's analysis CRS, exactly as they did for the generator.
     * ---------------------------------------------------------------------------------- */
    const gisDir = resolve(root, "fixtures/projects", fixtureDir);
    const readLayer = <T>(file: string): T =>
      JSON.parse(readFileSync(resolve(gisDir, file), "utf8")) as T;

    interface Feature<P> {
      readonly properties: P;
      readonly geometry: unknown;
    }
    interface Collection<P> {
      readonly features: ReadonlyArray<Feature<P>>;
    }

    const alignmentLayer = readLayer<Collection<{ label: string | null }>>(
      manifest.gis.files.alignment,
    );
    const parcelLayer = readLayer<
      Collection<{
        code: string;
        areaM2: number | null;
        side: "left" | "right";
        sideSource: string;
        surveyState: string | null;
        affectedFlag: string | null;
        landUse: string | null;
      }>
    >(manifest.gis.files.parcels);
    const affectationLayer = readLayer<Collection<{ code: string; areaM2: number | null }>>(
      manifest.gis.files.affectations,
    );
    const influenceLayer = readLayer<
      Collection<{
        kind: "direct" | "indirect" | "direct_social" | "indirect_social";
        label: string;
      }>
    >(manifest.gis.files.influenceAreas);
    const chainageRuns = readLayer<
      Array<{
        code: string;
        startM: number | null;
        endM: number | null;
        side: "left" | "right" | null;
      }>
    >(manifest.gis.files.chainage);
    const chainageByCode = new Map(chainageRuns.map((run) => [run.code, run]));

    /*
     * Has this exact delivery already been imported? Compared by the archive's hash, which is what
     * actually identifies a package — a re-run with the same file does nothing at all.
     */
    const activeParcelVersion = await tx.execute(sql`
      select v.id, v.note
        from app.spatial_dataset_version v
        join app.spatial_dataset d on d.tenant_id = v.tenant_id and d.id = v.dataset_id
       where v.tenant_id = ${tenantId} and v.project_id = ${projectId}
         and d.kind = 'parcels' and v.is_active
       limit 1
    `);
    const currentParcelVersion = activeParcelVersion.rows[0] as
      { id: string; note: string | null } | undefined;
    const alreadyImported = currentParcelVersion?.note === manifest.gis.source.sha256;

    /*
     * The analysis CRS is checked against `spatial_ref_sys` before anything is written: it must be
     * registered, projected, metre-based and usable by ST_Transform. The check reads the CRS
     * definition, never the SRID number (IG2-009).
     */
    const analysisSrid = await assertAnalysisSridUsable(tx, manifest.gis.analysisSrid);

    if (!alreadyImported) {
      /**
       * The SRIDs are inlined with `sql.raw` because a bound parameter arrives as text and PostGIS
       * then reads "4326" as a proj string. `CANONICAL_SRID` is a compile-time constant, and
       * `analysisSrid` has just been validated against the catalogue and re-parsed as an integer,
       * so neither is user input by the time it reaches SQL.
       */
      const canonical = sql.raw(String(CANONICAL_SRID));
      const analysis = sql.raw(String(analysisSrid));
      /**
       * GeoJSON → canonical geometry, forced multi-part.
       *
       * `ST_Multi` because 20 of the 141 real parcels are two polygons and one affectation is
       * eight — a plot split by the road, or with a detached portion. The columns are multi-part
       * for that reason (ADR-023), and a single-part feature becomes a multi of one, losing
       * nothing. The package's coordinates are stored exactly as delivered.
       */
      const toCanonical = (geometry: unknown) =>
        sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), ${canonical}))`;
      /** Canonical geometry → the analysis CRS, where metres mean metres. */
      const forMetrics = (geometry: unknown) =>
        sql`ST_Transform(${toCanonical(geometry)}, ${analysis})`;

      /** Every dataset of this project, by kind, whether or not it exists yet. */
      const datasetIdByKind = new Map<string, string>(
        (
          (
            await tx.execute(sql`
              select kind, id from app.spatial_dataset
               where tenant_id = ${tenantId} and project_id = ${projectId}
            `)
          ).rows as unknown as ReadonlyArray<{ kind: string; id: string }>
        ).map((row) => [row.kind, row.id]),
      );
      const activeVersionByKind = new Map<string, string>(
        (
          (
            await tx.execute(sql`
              select d.kind, v.id from app.spatial_dataset_version v
                join app.spatial_dataset d on d.tenant_id = v.tenant_id and d.id = v.dataset_id
               where v.tenant_id = ${tenantId} and v.project_id = ${projectId} and v.is_active
            `)
          ).rows as unknown as ReadonlyArray<{ kind: string; id: string }>
        ).map((row) => [row.kind, row.id]),
      );

      const datasetSpec = [
        {
          kind: "alignment",
          label: manifest.gis.alignmentLabel,
          count: alignmentLayer.features.length,
          provenance: "alignment-imported",
        },
        {
          kind: "parcels",
          label: "Predios frentistas",
          count: parcelLayer.features.length,
          provenance: "parcels-imported",
        },
        {
          kind: "affectations",
          label: "Áreas afectadas",
          count: affectationLayer.features.length,
          provenance: "affectations-imported",
        },
        {
          kind: "influence_areas",
          label: "Áreas de influencia",
          count: influenceLayer.features.length,
          provenance: "influence-areas-imported",
        },
      ] as const;

      /** How many versions each dataset already has, so a re-import numbers itself. */
      const versionCountByKind = new Map<string, number>(
        (
          (
            await tx.execute(sql`
              select d.kind, count(*)::int as n from app.spatial_dataset_version v
                join app.spatial_dataset d on d.tenant_id = v.tenant_id and d.id = v.dataset_id
               where v.tenant_id = ${tenantId} and v.project_id = ${projectId}
               group by d.kind
            `)
          ).rows as unknown as ReadonlyArray<{ kind: string; n: number }>
        ).map((row) => [row.kind, row.n]),
      );

      const newVersionByKind = new Map<string, string>();
      for (const spec of datasetSpec) {
        let datasetId = datasetIdByKind.get(spec.kind);
        if (!datasetId) {
          datasetId = randomUUID();
          await tx.insert(gisSchema.spatialDataset).values({
            id: datasetId,
            tenantId,
            projectId,
            kind: spec.kind,
            label: spec.label,
          });
        }
        const supersedes = activeVersionByKind.get(spec.kind) ?? null;
        if (supersedes) {
          // Exactly one active version per dataset, enforced by a unique partial index: the old
          // one steps down in the same transaction as the new one steps up.
          await tx.execute(sql`
            update app.spatial_dataset_version set is_active = false
             where tenant_id = ${tenantId} and id = ${supersedes}
          `);
        }
        const versionId = randomUUID();
        newVersionByKind.set(spec.kind, versionId);
        await tx.insert(gisSchema.spatialDatasetVersion).values({
          id: versionId,
          tenantId,
          projectId,
          datasetId,
          versionLabel: `${spec.kind}_v${(versionCountByKind.get(spec.kind) ?? 0) + 1}`,
          origin: "imported",
          // What the package declared, before the transform to canonical storage. The influence
          // areas arrived in a different UTM zone and were reprojected on extraction; the version
          // records what the layer came in as, not one project-wide CRS.
          sourceSrid: manifest.gis.source.sourceSrid,
          analysisSrid,
          generatorVersion: null,
          featureCount: spec.count,
          isActive: true,
          supersedesVersionId: supersedes,
          // The delivery's hash identifies this version's content; a re-seed compares it.
          note: manifest.gis.source.sha256,
          producedAt: scenarioInstant,
          provenanceId: provenanceId(spec.provenance),
        });
      }

      // ── alignment ──────────────────────────────────────────────────────────────────────────
      const axis = alignmentLayer.features[0]!;
      await tx.delete(gisSchema.alignment).where(eq(gisSchema.alignment.projectId, projectId));
      await tx.insert(gisSchema.alignment).values({
        id: randomUUID(),
        tenantId,
        projectId,
        datasetVersionId: newVersionByKind.get("alignment")!,
        label: axis.properties.label ?? manifest.gis.alignmentLabel,
        geom: toCanonical(axis.geometry) as unknown as string,
        // Measured by PostGIS in the analysis CRS, never taken from the package's own arithmetic.
        lengthM: sql`ST_Length(${forMetrics(axis.geometry)})` as unknown as string,
        provenanceId: provenanceId("alignment-imported"),
      });

      /*
       * ── parcels ───────────────────────────────────────────────────────────────────────────
       *
       * Matching, in the order `docs/GIS_IMPORT_CONTRACT.md` §3 sets out: by `parcel_code` first.
       * A code the package brings and we already have keeps its UUID and every row that points at
       * it.
       *
       * Then the case the contract could not anticipate. The corridor this project was seeded with
       * was **a placeholder for this exact package** — 141 generated polygons standing in for 141
       * real ones, with invented codes because the real ones were unknown. None of those codes
       * matches, so a code-only import would create 141 new parcels beside 141 orphans and double
       * a figure the study published. When the manifest declares `placeholderRemap`, an unmatched
       * placeholder is instead **renamed** to the incoming code, in order along the corridor: both
       * sets are ordered by chainage, and the *n*th placeholder becomes the *n*th real parcel.
       *
       * That is a declared, one-time transition, not a matching rule. It is recorded in the
       * manifest so nobody has to infer it, and it applies only to parcels whose code the package
       * does not know — a real code is never reassigned.
       */
      const existingParcels = (
        await tx.execute(sql`
          select id, parcel_code, chainage_m from app.parcel
           where tenant_id = ${tenantId} and project_id = ${projectId}
           order by chainage_m nulls last, parcel_code
        `)
      ).rows as unknown as ReadonlyArray<{
        id: string;
        parcel_code: string;
        chainage_m: string | null;
      }>;
      const existingByCode = new Map(existingParcels.map((row) => [row.parcel_code, row]));
      const incoming = [...parcelLayer.features].sort((a, b) => {
        const at = chainageByCode.get(a.properties.code)?.startM ?? Number.MAX_SAFE_INTEGER;
        const bt = chainageByCode.get(b.properties.code)?.startM ?? Number.MAX_SAFE_INTEGER;
        return at - bt || a.properties.code.localeCompare(b.properties.code);
      });
      const incomingCodes = new Set(incoming.map((f) => f.properties.code));
      const placeholders = manifest.gis.placeholderRemap
        ? existingParcels.filter((row) => !incomingCodes.has(row.parcel_code))
        : [];
      let nextPlaceholder = 0;

      let parcelsMatched = 0;
      let parcelsCreated = 0;
      const parcelIdByCode = new Map<string, string>();
      const parcelVersionId = newVersionByKind.get("parcels")!;

      for (const feature of incoming) {
        const code = feature.properties.code;
        const run = chainageByCode.get(code);
        const reuse = existingByCode.get(code) ?? placeholders[nextPlaceholder];
        if (!existingByCode.has(code) && reuse) nextPlaceholder += 1;

        /*
         * The package's own `ESTADO` decides the status, rather than every parcel being declared
         * confirmed. It says `COMPLETO` for 119 of the 141, `INCOMPLETO` for 20 and `COMPLETA`
         * for 2 — the last a spelling variant, mapped the same way as `COMPLETO` here and
         * reported as an inconsistency rather than corrected in the fixture. An incomplete survey
         * is `estimated`: the boundary exists, the field work behind it does not yet.
         */
        const surveyState = (feature.properties.surveyState ?? "").toUpperCase();
        const values = {
          parcelCode: code,
          side: feature.properties.side,
          status: surveyState.startsWith("COMPLET")
            ? ("confirmed" as const)
            : ("estimated" as const),
          /*
           * Declared, not derived. The package states a start and an end abscissa per parcel;
           * `chainage_m` keeps its meaning as the single point the corridor orders by and takes
           * the start of the range (ADR-023). Where the package declares no range — code `091`
           * has no row at all — all three stay null and the reconciliation below derives the
           * single point from geometry, recording `centroid_projection`, so the two methods are
           * never confused on screen.
           */
          chainageM: run?.startM != null ? String(run.startM) : null,
          chainageStartM: run?.startM != null ? String(run.startM) : null,
          chainageEndM: run?.endM != null ? String(run.endM) : null,
          chainageMethod: run?.startM != null ? ("declared" as const) : null,
        };

        let parcelId: string;
        if (reuse) {
          parcelId = reuse.id;
          parcelsMatched += 1;
          await tx.execute(sql`
            update app.parcel
               set parcel_code = ${values.parcelCode},
                   -- The placeholder's sector label was the generator's invention; the package
                   -- states none, so the parcel stops claiming one.
                   sector_label = null,
                   side = ${values.side}::app.parcel_side,
                   status = ${values.status}::app.parcel_status,
                   chainage_m = ${values.chainageM},
                   chainage_start_m = ${values.chainageStartM},
                   chainage_end_m = ${values.chainageEndM},
                   chainage_method = ${values.chainageMethod}::app.chainage_method,
                   frontage_m = null,
                   provenance_id = ${provenanceId("parcels-imported")}
             where tenant_id = ${tenantId} and id = ${parcelId}
          `);
          // The old boundary is deactivated, never deleted: a figure produced from it stays
          // explainable, which is the whole point of versioning geometry (import contract §1).
          await tx.execute(sql`
            update app.parcel_geometry set is_active = false
             where tenant_id = ${tenantId} and parcel_id = ${parcelId} and is_active
          `);
        } else {
          parcelId = randomUUID();
          parcelsCreated += 1;
          await tx.insert(gisSchema.parcel).values({
            id: parcelId,
            tenantId,
            projectId,
            sectorLabel: null,
            frontageM: null,
            provenanceId: provenanceId("parcels-imported"),
            ...values,
          });
        }
        parcelIdByCode.set(code, parcelId);

        await tx.insert(gisSchema.parcelGeometry).values({
          id: randomUUID(),
          tenantId,
          projectId,
          parcelId,
          datasetVersionId: parcelVersionId,
          geom: toCanonical(feature.geometry) as unknown as string,
          // Area is computed by PostGIS in the analysis CRS, never read from the package's own
          // `AREA` column: two numbers for one fact drift, and only one is reproducible.
          areaM2: sql`ST_Area(${forMetrics(feature.geometry)})` as unknown as string,
          isActive: true,
          provenanceId: provenanceId("parcels-imported"),
        });
      }

      /*
       * Affectations, matched to a parcel by the code the package uses.
       *
       * One does not match: the package carries an affected area for code `090` and no parcel of
       * that code. It is **not** imported and **not** invented as a parcel — the study's universe
       * is the 141 `PREDIOS`, and adding a 142nd from an affectation would contradict the figure
       * the study published. The orphan is counted and reported, which is where an inconsistency
       * belongs.
       */
      await tx.delete(gisSchema.affectation).where(eq(gisSchema.affectation.projectId, projectId));
      let orphanAffectations = 0;
      for (const feature of affectationLayer.features) {
        const parcelId = parcelIdByCode.get(feature.properties.code);
        if (!parcelId) {
          orphanAffectations += 1;
          continue;
        }
        await tx.insert(gisSchema.affectation).values({
          id: randomUUID(),
          tenantId,
          projectId,
          parcelId,
          datasetVersionId: newVersionByKind.get("affectations")!,
          category: "right_of_way",
          geom: toCanonical(feature.geometry) as unknown as string,
          affectedAreaM2: sql`ST_Area(${forMetrics(feature.geometry)})` as unknown as string,
          provenanceId: provenanceId("affectations-imported"),
        });
      }

      await tx
        .delete(gisSchema.influenceArea)
        .where(eq(gisSchema.influenceArea.projectId, projectId));
      for (const feature of influenceLayer.features) {
        await tx.insert(gisSchema.influenceArea).values({
          id: randomUUID(),
          tenantId,
          projectId,
          datasetVersionId: newVersionByKind.get("influence_areas")!,
          kind: feature.properties.kind,
          label: feature.properties.label,
          geom: toCanonical(feature.geometry) as unknown as string,
          areaM2: sql`ST_Area(${forMetrics(feature.geometry)})` as unknown as string,
          provenanceId: provenanceId("influence-areas-imported"),
        });
      }

      gisImportReport = {
        parcelsMatched,
        parcelsCreated,
        parcelsUnmatched: Math.max(0, placeholders.length - nextPlaceholder),
        affectations: affectationLayer.features.length - orphanAffectations,
        orphanAffectations,
        influenceAreas: influenceLayer.features.length,
        chainageDeclared: incoming.filter(
          (f) => chainageByCode.get(f.properties.code)?.startM != null,
        ).length,
        chainageUnmatched: chainageRuns.filter((r) => !parcelIdByCode.has(r.code)).length,
        sideDerived: incoming.filter((f) => f.properties.sideSource !== "declared").length,
      };
    }

    /*
     * Chainage reconciliation.
     *
     * The package declares a start and an end abscissa for 140 of the 141 parcels, so the import
     * above wrote them and marked the method `declared`. One parcel — code `091` — has no row in
     * `ABSCISA_PREDIO` at all. Rather than leave it without a position on the corridor, its single
     * reference point is derived here the way every parcel's was before the package arrived:
     *
     *   parcel centroid → ST_LineLocatePoint on the active alignment → fraction along the line
     *   → × the alignment's length measured in the analysis CRS → metres.
     *
     * The `WHERE chainage_m IS NULL` is the load-bearing part. A derivation that overwrote a
     * declared abscissa would replace what the consultancy measured on the ground with what a
     * centroid implies, and the two would be indistinguishable afterwards because
     * `chainage_method` would say `centroid_projection` for both. It runs only where nothing was
     * declared, and it never writes a range: a derived point is a point.
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
                 ST_LineMerge(axis.geom),
                 -- The parcel centroid is projected into the *alignment's* CRS, so both sides of
                 -- the measurement live in one coordinate system.
                 ST_Centroid(ST_Transform(g.geom, axis.srid))
               ) * axis.length_m
             )::numeric, 1),
             chainage_method = 'centroid_projection'
        from app.parcel_geometry g, axis
       where g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
         and p.tenant_id = ${tenantId} and p.project_id = ${projectId}
         and p.chainage_m is null
      returning p.id
    `);

    /* ------------------------------------------------------------------------------------
     * PGAS: the management plan chapter, imported from the delivered document (ADR-024).
     *
     * Idempotent by the document's SHA-256: re-running with the same chapter writes nothing. A
     * revised chapter becomes a new run whose plans supersede the previous run's, which stay
     * queryable — the same shape as a spatial dataset version, for the same reason.
     *
     * The measures name institutions and roles, never individuals; the screen that established
     * that is in the intake workspace and is summarised in `docs/REAL_DATA_INTAKE.md`.
     * ---------------------------------------------------------------------------------- */
    let pgasReport = "PGAS: no declarado en el manifiesto";
    if (manifest.pgas) {
      const chapter = JSON.parse(
        readFileSync(resolve(root, "fixtures/projects", fixtureDir, manifest.pgas.file), "utf8"),
      ) as unknown;
      const result = await importPgasChapter(tx, {
        tenantId,
        projectId,
        provenanceId: provenanceId("pgas-chapter"),
        importedAt: scenarioInstant,
        chapter,
      });
      pgasReport = result.unchanged
        ? "PGAS: el capítulo ya estaba importado, sin cambios"
        : `PGAS importado: ${result.plans} planes · ${result.measures} medidas` +
          (result.supersededRunId ? " (supersede la importación anterior)" : "");
    }

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

    /**
     * The document excerpts (Slice 6), ingested through the real use-case.
     *
     * Not written directly: `ingestDocumentVersion` chunks deterministically, records the strategy
     * on the version and writes the provenance, and a seeder that bypassed it would produce rows
     * the product could not have produced. It is idempotent by content hash — identical text on a
     * re-seed changes nothing, so citations keep resolving.
     *
     * The seeder runs as the migrator, outside a request context, so it builds the minimal context
     * the use-case requires rather than pretending to be a session.
     */
    // No actor: the fixture is not a person, and the version records that honestly.
    const seedScope = { tenantId, projectId, userId: null };
    const documentVersionByAssertionKey = new Map<
      string,
      { versionId: string; chunkId: string | null }
    >();
    let documentsSeeded = 0;
    let documentChunks = 0;
    for (const item of manifest.documents.items) {
      const ingested = await ingestDocumentVersionInTx(tx, seedScope, {
        code: item.code,
        title: item.title,
        kind: item.kind,
        versionLabel: item.versionLabel,
        textSource: "RECONSTRUCTED_EXCERPT",
        containsPii: false,
        pages: item.pages,
        sourceNote: item.sourceNote,
      });
      documentsSeeded += 1;
      documentChunks += ingested.chunkCount;
      for (const key of item.assertionKeys) {
        if (!documentVersionByAssertionKey.has(key)) {
          documentVersionByAssertionKey.set(key, { versionId: ingested.versionId, chunkId: null });
        }
      }
    }

    /**
     * The corpus assertions (Slice 5).
     *
     * **Upserted on (key, source), never deleted and re-inserted.** A finding's evidence cites an
     * assertion by id; recreating the rows on every seed would leave every existing finding
     * pointing at an id that no longer exists. The taxonomy learned the same lesson one slice ago.
     *
     * **Findings, runs and specialist decisions are left entirely alone.** They are not demo state
     * this seeder owns: a finding must be the output of a rule that actually ran, and a decision is
     * a permanent record with somebody's name on it. Re-seeding a demo environment is not a reason
     * to erase either. `pnpm quality:run` — or the button on the surface — produces the findings.
     */
    let assertionsSeeded = 0;
    for (const assertion of manifest.quality.assertions) {
      await tx
        .insert(qualitySchema.documentAssertion)
        .values({
          id: randomUUID(),
          tenantId,
          projectId,
          key: assertion.key,
          sourceKind: "RECONSTRUCTED_CORPUS",
          sourceRef: assertion.sourceRef,
          valueText: assertion.valueText ?? null,
          valueNumber: assertion.valueNumber === undefined ? null : String(assertion.valueNumber),
          valueDate: assertion.valueDate ?? null,
          valueBoolean: assertion.valueBoolean ?? null,
          quote: assertion.quote ?? null,
          qualifier: assertion.qualifier ?? null,
          provenanceId: provenanceId("quality-corpus-assertions"),
        })
        .onConflictDoUpdate({
          target: [
            qualitySchema.documentAssertion.tenantId,
            qualitySchema.documentAssertion.projectId,
            qualitySchema.documentAssertion.key,
            qualitySchema.documentAssertion.sourceRef,
          ],
          set: {
            valueText: assertion.valueText ?? null,
            valueNumber: assertion.valueNumber === undefined ? null : String(assertion.valueNumber),
            valueDate: assertion.valueDate ?? null,
            valueBoolean: assertion.valueBoolean ?? null,
            quote: assertion.quote ?? null,
            qualifier: assertion.qualifier ?? null,
          },
        });
      assertionsSeeded += 1;
    }

    /**
     * Link each assertion to the excerpt it was transcribed from (Slice 6, ADR-020 §6).
     *
     * **Enrichment, never revision.** The assertion stays `RECONSTRUCTED_CORPUS` — it *is* a hand
     * transcription — and gains a pointer to the version now in the system, plus the chunk whose
     * text actually contains its quote. The chunk link is established by the words matching, not by
     * proximity or guesswork: if the quote appears in exactly one chunk, that chunk is the passage;
     * otherwise the link stays null rather than becoming a citation nobody could check.
     *
     * Findings already raised are untouched. Their evidence resolves the document reference through
     * the assertion at read time, so an old finding gains a link without being rewritten.
     */
    let assertionsLinked = 0;
    for (const [key, ref] of documentVersionByAssertionKey) {
      const rows = await tx.execute(sql`
        select id, quote from app.document_assertion
         where tenant_id = ${tenantId} and project_id = ${projectId} and key = ${key}
      `);
      for (const row of rows.rows as Array<{ id: string; quote: string | null }>) {
        let chunkId: string | null = ref.chunkId;
        if (row.quote) {
          const matches = await tx.execute(sql`
            select id from app.document_chunk
             where tenant_id = ${tenantId} and version_id = ${ref.versionId}
               and position(${row.quote} in text) > 0
          `);
          chunkId = matches.rows.length === 1 ? (matches.rows[0] as { id: string }).id : null;
        }
        await tx.execute(sql`
          update app.document_assertion
             set document_version_id = ${ref.versionId}, chunk_id = ${chunkId}
           where tenant_id = ${tenantId} and id = ${row.id}
        `);
        assertionsLinked += 1;
      }
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
        gisImportReport
          ? `GIS importado: ${gisImportReport.parcelsMatched} predios reutilizados, ` +
            `${gisImportReport.parcelsCreated} nuevos, ${gisImportReport.parcelsUnmatched} sin correspondencia · ` +
            `${gisImportReport.affectations} afectaciones (${gisImportReport.orphanAffectations} sin predio) · ` +
            `${gisImportReport.influenceAreas} áreas de influencia · ` +
            `abscisa declarada en ${gisImportReport.chainageDeclared}, ` +
            `${gisImportReport.chainageUnmatched} filas de abscisa sin predio · ` +
            `lado derivado en ${gisImportReport.sideDerived}`
          : "GIS: el paquete ya estaba importado, sin cambios",
        `abscisa derivada para ${chainage.rowCount ?? 0} predio(s) sin declaración (centroid_projection, CRS EPSG:${analysisSrid})`,
        `field: ${assignmentsSeeded} assignments · ${submissionsSeeded} submitted · offline_mode=${field.offlineMode}`,
        `documentos: ${documentsSeeded} · ${documentChunks} pasajes`,
        pgasReport,
        `quality: ${assertionsSeeded} afirmaciones del corpus (${assertionsLinked} con pasaje) · 0 hallazgos sembrados`,
        `social: taxonomy ${taxonomyVersionLabel} (${social.version.categories.length} categorías, ${taxonomyVersionsSeeded === 1 ? "nueva" : "reutilizada"}) · 0 clasificaciones sembradas`,
      ].join(" · "),
    );
  });
} finally {
  await pool.end();
}
