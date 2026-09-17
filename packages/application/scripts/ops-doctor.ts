import {
  appEnvSchema,
  assistantEnvSchema,
  documentReviewerEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  socialEnvSchema,
  storageEnvSchema,
} from "@eia/contracts";
import { createDatabase, createPool } from "@eia/db";
import {
  resolveAiAdapterAvailability,
  resolveClassifierAvailability,
  resolveDocumentReviewerAvailability,
  resolveStorageAvailability,
} from "@eia/domain";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { resolve } from "node:path";

/**
 * Is this deployment healthy, and what is stuck?
 *
 *   pnpm ops:doctor
 *
 * **Read-only.** Every statement is a `select`; nothing is written and nothing is repaired.
 *
 * ## Why a script and not an endpoint
 *
 * An unauthenticated diagnostics endpoint is an oracle: queue depths and failure counts tell an
 * outsider how busy a consultancy is, when its field days are, and when something broke. An
 * authenticated one needs a surface, a permission and a place in the rail — a product decision this
 * wave has not made. An operator script needs a database credential, which is the right bar for
 * "how is the deployment?", and it runs where the credential already is.
 *
 * ## What it will never print
 *
 * No survey answer, no document passage, no candidate's text, no filename, no object key, no
 * connection string, no token. It prints **counts, states, ages and identifiers of things** — the
 * same rule the worker's logs follow (SECURITY.md §10c, §10f, ADR-033).
 *
 * ## Exit code
 *
 * Non-zero when something is **stuck**: work claimed and never finished, or a queue whose oldest
 * item is older than a working day. A `WARN` is worth knowing; it does not fail the command.
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

type Level = "OK" | "WARN" | "FAIL";
let failures = 0;

function report(level: Level, area: string, detail: string): void {
  if (level === "FAIL") failures += 1;
  const mark = level === "OK" ? "·" : level === "WARN" ? "!" : "✗";
  process.stdout.write(`${mark} ${level.padEnd(4)} ${area.padEnd(26)} ${detail}\n`);
}

/** A queue item older than this has stopped being a backlog and started being a fault. */
const STUCK_HOURS = 12;
/** A claim older than this belongs to a worker that is gone (the stale-release interval is 15m). */
const STALE_CLAIM_MINUTES = 30;

const app = loadEnv("app", appEnvSchema, process.env);
const database = loadEnv("database", migratorDatabaseEnvSchema, process.env);
const pool = createPool(database.DATABASE_MIGRATOR_URL, {
  max: 2,
  applicationName: "eia-ops-doctor",
});
const db = createDatabase(pool);

async function rows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

async function one<T>(query: Parameters<typeof db.execute>[0]): Promise<T | null> {
  return (await rows<T>(query))[0] ?? null;
}

try {
  /* ── what is configured, and what is therefore expected to move ───────────────────────────── */
  const storage = resolveStorageAvailability({
    appEnv: app.APP_ENV,
    ...((): { provider?: string; bucket?: string; region?: string; endpoint?: string } => {
      const env = loadEnv("storage", storageEnvSchema, process.env);
      return {
        ...(env.STORAGE_PROVIDER === undefined ? {} : { provider: env.STORAGE_PROVIDER }),
        ...(env.STORAGE_BUCKET === undefined ? {} : { bucket: env.STORAGE_BUCKET }),
        ...(env.STORAGE_REGION === undefined ? {} : { region: env.STORAGE_REGION }),
        ...(env.STORAGE_ENDPOINT === undefined ? {} : { endpoint: env.STORAGE_ENDPOINT }),
      };
    })(),
    credentialsPresent:
      process.env["STORAGE_ACCESS_KEY_ID"] !== undefined &&
      process.env["STORAGE_SECRET_ACCESS_KEY"] !== undefined,
  } as Parameters<typeof resolveStorageAvailability>[0]);
  report(
    storage.state === "AVAILABLE" ? "OK" : "WARN",
    "almacenamiento",
    // The provider and the state. Never the bucket, the endpoint or a credential.
    storage.state === "AVAILABLE" ? `${storage.provider} · live=${storage.live}` : storage.reason,
  );

  const social = loadEnv("social", socialEnvSchema, process.env);
  const classifier = resolveClassifierAvailability({
    appEnv: app.APP_ENV,
    classifier: social.SOCIAL_CLASSIFIER,
    model: social.SOCIAL_CLASSIFIER_MODEL,
    gatewayApiKeyPresent: social.AI_GATEWAY_API_KEY !== undefined,
  });
  report(
    classifier.state === "AVAILABLE" ? "OK" : "WARN",
    "clasificador social",
    classifier.state === "AVAILABLE"
      ? `${classifier.kind} · ${classifier.model}`
      : classifier.reason,
  );

  const assistantEnv = loadEnv("assistant", assistantEnvSchema, process.env);
  const assistant = resolveAiAdapterAvailability({
    appEnv: app.APP_ENV,
    variable: "ASSISTANT_GENERATOR",
    modelVariable: "ASSISTANT_GENERATOR_MODEL",
    feature: "assisted prose",
    adapter: assistantEnv.ASSISTANT_GENERATOR,
    model: assistantEnv.ASSISTANT_GENERATOR_MODEL,
    credentialPresent: assistantEnv.AI_GATEWAY_API_KEY !== undefined,
  });
  report(
    assistant.state === "AVAILABLE" ? "OK" : "WARN",
    "redacción asistida",
    assistant.state === "AVAILABLE" ? `${assistant.kind} · ${assistant.model}` : assistant.reason,
  );

  const reviewerEnv = loadEnv("documentReviewer", documentReviewerEnvSchema, process.env);
  const reviewer = resolveDocumentReviewerAvailability({
    appEnv: app.APP_ENV,
    reviewer: reviewerEnv.DOCUMENT_REVIEWER,
    model: reviewerEnv.DOCUMENT_REVIEWER_MODEL,
    gatewayApiKeyPresent: reviewerEnv.AI_GATEWAY_API_KEY !== undefined,
  });
  report(
    reviewer.state === "AVAILABLE" ? "OK" : "WARN",
    "revisión asistida (IA)",
    reviewer.state === "AVAILABLE" ? `${reviewer.kind} · ${reviewer.model}` : reviewer.reason,
  );

  /* ── document extraction ──────────────────────────────────────────────────────────────────── */
  const extraction = await one<{
    queued: number;
    processing: number;
    failed: number;
    requires_ocr: number;
    oldest_queued_hours: number | null;
    stale_claims: number;
  }>(sql`
    select
      count(*) filter (where processing_state = 'QUEUED')::int        as queued,
      count(*) filter (where processing_state = 'PROCESSING')::int    as processing,
      count(*) filter (where processing_state = 'FAILED')::int        as failed,
      count(*) filter (where processing_state = 'REQUIRES_OCR')::int  as requires_ocr,
      extract(epoch from (now() - min(imported_at) filter (where processing_state = 'QUEUED'))) / 3600
                                                                      as oldest_queued_hours,
      count(*) filter (
        where processing_state = 'PROCESSING'
          and extraction_claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})
      )::int                                                          as stale_claims
      from app.document_version
  `);
  if (extraction) {
    const age = extraction.oldest_queued_hours;
    report(
      extraction.stale_claims > 0 || (age !== null && age > STUCK_HOURS) ? "FAIL" : "OK",
      "extracción · cola",
      `en cola ${extraction.queued} · procesando ${extraction.processing} · ` +
        `reclamos vencidos ${extraction.stale_claims} · ` +
        `más antiguo ${age === null ? "—" : `${Math.round(age)} h`}`,
    );
    report(
      extraction.failed > 0 ? "WARN" : "OK",
      "extracción · resultados",
      `fallidos ${extraction.failed} · requieren OCR ${extraction.requires_ocr}`,
    );
  }

  /* ── AI document review ───────────────────────────────────────────────────────────────────── */
  const review = await one<{
    queued: number;
    processing: number;
    failed: number;
    refused_candidates: number;
    oldest_queued_hours: number | null;
    stale_claims: number;
  }>(sql`
    select
      count(*) filter (where status = 'QUEUED')::int      as queued,
      count(*) filter (where status = 'PROCESSING')::int  as processing,
      count(*) filter (where status = 'FAILED')::int      as failed,
      coalesce(sum(candidates_refused), 0)::int           as refused_candidates,
      extract(epoch from (now() - min(created_at) filter (where status = 'QUEUED'))) / 3600
                                                          as oldest_queued_hours,
      count(*) filter (
        where status = 'PROCESSING'
          and claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})
      )::int                                              as stale_claims
      from app.document_review_run
  `);
  if (review) {
    const age = review.oldest_queued_hours;
    report(
      review.stale_claims > 0 || (age !== null && age > STUCK_HOURS) ? "FAIL" : "OK",
      "revisión IA · cola",
      `en cola ${review.queued} · procesando ${review.processing} · ` +
        `reclamos vencidos ${review.stale_claims} · ` +
        `más antiguo ${age === null ? "—" : `${Math.round(age)} h`}`,
    );
    report(
      review.failed > 0 ? "WARN" : "OK",
      "revisión IA · resultados",
      // A refused candidate is one the product would not store — worth watching, never an outage.
      `ejecuciones fallidas ${review.failed} · candidatos rechazados ${review.refused_candidates}`,
    );
  }

  /* ── social classification ────────────────────────────────────────────────────────────────── */
  const classification = await one<{ pending: number; failed: number; stale_claims: number }>(sql`
    select
      count(*) filter (where status = 'PENDING')::int    as pending,
      count(*) filter (where status = 'FAILED')::int     as failed,
      count(*) filter (
        where status = 'PROCESSING'
          and claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})
      )::int                                             as stale_claims
      from app.ai_classification
  `);
  if (classification) {
    report(
      classification.stale_claims > 0 ? "FAIL" : classification.failed > 0 ? "WARN" : "OK",
      "clasificación · cola",
      `pendientes ${classification.pending} · fallidas ${classification.failed} · ` +
        `reclamos vencidos ${classification.stale_claims}`,
    );
  }

  /* ── field media, and the devices still holding it ────────────────────────────────────────── */
  const media = await one<{ total: number; recent: number }>(sql`
    select count(*)::int as total,
           count(*) filter (where created_at > now() - interval '7 days')::int as recent
      from app.field_media
  `);
  if (media) {
    report("OK", "fotografías de campo", `total ${media.total} · últimos 7 días ${media.recent}`);
  }

  /* ── field sync: what devices reported, and what failed ───────────────────────────────────── */
  const sync = await one<{ receipts: number; recent: number; superseded: number }>(sql`
    select count(*)::int as receipts,
           count(*) filter (where processed_at > now() - interval '24 hours')::int as recent,
           count(*) filter (where outcome::text = 'superseded')::int as superseded
      from app.field_sync_receipt
  `);
  if (sync) {
    report(
      "OK",
      "sincronización de campo",
      `recibos ${sync.receipts} · últimas 24 h ${sync.recent} · obsoletos ${sync.superseded}`,
    );
  }

  /* ── stored objects the database expects ──────────────────────────────────────────────────── */
  const objects = await rows<{ namespace: string; n: number; bytes: number }>(sql`
    select namespace::text as namespace, count(*)::int as n, coalesce(sum(size_bytes), 0)::bigint as bytes
      from app.stored_object group by 1 order by 1
  `);
  report(
    "OK",
    "objetos almacenados",
    objects.length === 0
      ? "ninguno"
      : objects
          .map((row) => `${row.namespace} ${row.n} (${Math.round(Number(row.bytes) / 1024)} KiB)`)
          .join(" · "),
  );

  /* ── template rendering ───────────────────────────────────────────────────────────────────── */
  const templates = await one<{
    versions: number;
    unreadable: number;
    blocked: number;
    active: number;
    generated: number;
  }>(sql`
    select
      count(*)::int                                                       as versions,
      count(*) filter (where validation_error is not null)::int           as unreadable,
      count(*) filter (where jsonb_array_length(coalesce(manifest->'unknown', '[]'::jsonb)) > 0)::int
                                                                          as blocked,
      count(*) filter (where state = 'ACTIVE')::int                       as active,
      (select count(*)::int from app.generated_document)                  as generated
      from app.report_template_version
  `);
  if (templates) {
    report(
      templates.unreadable > 0 ? "WARN" : "OK",
      "plantillas",
      `versiones ${templates.versions} · activas ${templates.active} · ` +
        `ilegibles ${templates.unreadable} · con marcadores no declarados ${templates.blocked} · ` +
        `documentos generados ${templates.generated}`,
    );
  }

  /* ── the audit log is being written ───────────────────────────────────────────────────────── */
  const audit = await one<{ n: number; last_hours: number | null }>(sql`
    select count(*)::int as n,
           extract(epoch from (now() - max(occurred_at))) / 3600 as last_hours
      from audit.log
  `);
  if (audit) {
    report(
      "OK",
      "registro de auditoría",
      `${audit.n} entradas · última hace ${audit.last_hours === null ? "—" : `${Math.round(audit.last_hours)} h`}`,
    );
  }

  process.stdout.write(
    failures === 0 ? "\nsin bloqueos operativos\n" : `\n${failures} condición(es) atascada(s)\n`,
  );
} finally {
  await pool.end();
}

process.exit(failures === 0 ? 0 : 1);
