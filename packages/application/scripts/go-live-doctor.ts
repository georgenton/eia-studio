import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  evaluateReadiness,
  getSystemProfile,
  readFieldOfflineMode,
  resolveAiAdapterAvailability,
  resolveClassifierAvailability,
  resolveDocumentReviewerAvailability,
  resolveStorageAvailability,
  CAPABILITY_KEYS,
  type CapabilityKey,
  type CaptureChannel,
  type ReadinessRuleKey,
} from "@eia/domain";
import { FIELD_SYNC_PROTOCOL_VERSION } from "@eia/field-sync-contract";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";

/**
 * Can somebody make a production go/no-go decision, and what is still missing?
 *
 *   pnpm go-live:doctor
 *
 * **Read-only.** Every statement is a `select`; nothing is written and nothing is repaired.
 *
 * ## Why this is not `ops:doctor`
 *
 * They answer different questions for different people. `ops:doctor` asks *is this deployment
 * healthy and what is stuck?* — an operator's question, whose failure means somebody should look at
 * a queue tonight. This asks *is this programme ready to go live?*, whose answer is mostly about
 * decisions nobody has taken yet. Folding the second into the first would make `ops:doctor` fail on
 * staging for ever because production hosting has not been chosen, which is exactly how a red
 * signal stops meaning anything.
 *
 * ## Why it is a script and not a dashboard
 *
 * The same reason `ops:doctor` is (SECURITY.md §9, ADR-016): an unauthenticated readiness endpoint
 * is an oracle — it tells an outsider how many studies a firm is running and which are stuck. This
 * needs a database credential, which is the right bar for the question, and it runs where the
 * credential already is. **There is no HTTP endpoint.**
 *
 * ## What it will never do
 *
 * Invent a machine-readable state for a decision a machine did not make. Legal approval, the
 * physical-handset UAT and the restore drill are **not** columns in this database, and adding a
 * boolean for them would let a green tick stand in for a review nobody performed. Those print
 * `VERIFICACIÓN EXTERNA REQUERIDA` with the path to the runbook that actually records them.
 *
 * ## Exit code
 *
 * Non-zero for the one thing this script can call **wrong** rather than merely unfinished: the
 * database's migration ledger disagreeing with the repository. Everything else is a state.
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

type Level = "OK" | "WAIT" | "EXT" | "FAIL";
let failures = 0;
let external = 0;

function report(level: Level, area: string, detail: string): void {
  if (level === "FAIL") failures += 1;
  if (level === "EXT") external += 1;
  const mark = level === "OK" ? "·" : level === "FAIL" ? "✗" : level === "EXT" ? "?" : "!";
  process.stdout.write(`${mark} ${level.padEnd(4)} ${area.padEnd(30)} ${detail}\n`);
}

function heading(text: string): void {
  process.stdout.write(`\n${text}\n${"─".repeat(text.length)}\n`);
}

const app = loadEnv("app", appEnvSchema, process.env);
const database = loadEnv("database", migratorDatabaseEnvSchema, process.env);
const pool = createPool(database.DATABASE_MIGRATOR_URL, {
  max: 2,
  applicationName: "eia-go-live-doctor",
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
  /* ── código y base de datos ───────────────────────────────────────────────────────────────── */
  heading("CÓDIGO Y BASE DE DATOS");

  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), "../db/migrations/meta/_journal.json"), "utf8"),
  ) as { entries: ReadonlyArray<{ tag: string }> };
  const expected = journal.entries.length;
  const applied = await one<{ n: number }>(
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  const appliedCount = applied?.n ?? 0;
  report(
    appliedCount === expected ? "OK" : "FAIL",
    "migraciones",
    `repositorio ${expected} · base de datos ${appliedCount}` +
      (appliedCount === expected
        ? ""
        : appliedCount < expected
          ? " — la base está atrasada; ejecuta pnpm db:migrate"
          : " — la base está por delante del repositorio"),
  );
  report("OK", "entorno", `APP_ENV=${app.APP_ENV}`);

  /* ── infraestructura ──────────────────────────────────────────────────────────────────────── */
  heading("INFRAESTRUCTURA");

  const storageEnv = loadEnv("storage", storageEnvSchema, process.env);
  const storage = resolveStorageAvailability({
    appEnv: app.APP_ENV,
    ...(storageEnv.STORAGE_PROVIDER === undefined ? {} : { provider: storageEnv.STORAGE_PROVIDER }),
    ...(storageEnv.STORAGE_BUCKET === undefined ? {} : { bucket: storageEnv.STORAGE_BUCKET }),
    ...(storageEnv.STORAGE_REGION === undefined ? {} : { region: storageEnv.STORAGE_REGION }),
    ...(storageEnv.STORAGE_ENDPOINT === undefined ? {} : { endpoint: storageEnv.STORAGE_ENDPOINT }),
    credentialsPresent:
      process.env["STORAGE_ACCESS_KEY_ID"] !== undefined &&
      process.env["STORAGE_SECRET_ACCESS_KEY"] !== undefined,
  } as Parameters<typeof resolveStorageAvailability>[0]);
  report(
    storage.state === "AVAILABLE" ? "OK" : "WAIT",
    "almacenamiento de objetos",
    // The provider and the state. Never the bucket, the endpoint or a credential.
    storage.state === "AVAILABLE" ? `${storage.provider} · live=${storage.live}` : storage.reason,
  );

  /*
   * The three selectors, reported together because the question at go-live is one question: is any
   * model configured to read this programme's content? `unset` is the intended answer until the
   * review of SECURITY.md §10a says otherwise, so an unset selector is **OK** here rather than a
   * warning — the opposite of how `ops:doctor` reads it, which asks whether a feature works.
   */
  const social = loadEnv("social", socialEnvSchema, process.env);
  const classifier = resolveClassifierAvailability({
    appEnv: app.APP_ENV,
    classifier: social.SOCIAL_CLASSIFIER,
    model: social.SOCIAL_CLASSIFIER_MODEL,
    gatewayApiKeyPresent: social.AI_GATEWAY_API_KEY !== undefined,
  });
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
  const reviewerEnv = loadEnv("documentReviewer", documentReviewerEnvSchema, process.env);
  const reviewer = resolveDocumentReviewerAvailability({
    appEnv: app.APP_ENV,
    reviewer: reviewerEnv.DOCUMENT_REVIEWER,
    model: reviewerEnv.DOCUMENT_REVIEWER_MODEL,
    gatewayApiKeyPresent: reviewerEnv.AI_GATEWAY_API_KEY !== undefined,
  });
  const live = [classifier, assistant, reviewer].filter((a) => a.state === "AVAILABLE").length;
  report(
    live === 0 ? "OK" : "WAIT",
    "selectores de IA",
    live === 0
      ? "ninguno configurado — el estado previsto hasta que la revisión de privacidad lo autorice"
      : `${live} de 3 activos — requiere autorización explícita (SECURITY.md §10a)`,
  );

  const queues = await one<{ extraction: number; review: number; classification: number }>(sql`
    select (select count(*)::int from app.document_version
             where processing_state in ('QUEUED', 'PROCESSING'))                as extraction,
           (select count(*)::int from app.document_review_run
             where status in ('QUEUED', 'PROCESSING'))                             as review,
           (select count(*)::int from app.ai_classification where status = 'PENDING')
                                                                                as classification
  `);
  if (queues) {
    report(
      "OK",
      "colas de trabajo",
      `extracción ${queues.extraction} · revisión IA ${queues.review} · ` +
        `clasificación ${queues.classification}`,
    );
  }

  const templates = await one<{ versions: number; active: number; generated: number }>(sql`
    select count(*)::int                                                as versions,
           count(*) filter (where state = 'ACTIVE')::int                as active,
           (select count(*)::int from app.generated_document)           as generated
      from app.report_template_version
  `);
  if (templates) {
    report(
      templates.active > 0 ? "OK" : "WAIT",
      "plantillas de entregable",
      templates.active > 0
        ? `${templates.active} activa(s) de ${templates.versions} · ${templates.generated} documento(s) generado(s)`
        : "ninguna activa — se requieren las plantillas reales de la consultora (docs/CONSULTANCY_TEMPLATE_REQUEST.md)",
    );
  }

  /* ── móvil ────────────────────────────────────────────────────────────────────────────────── */
  heading("MÓVIL");

  report(
    "OK",
    "protocolo de sincronización",
    `versión ${FIELD_SYNC_PROTOCOL_VERSION} — todo dispositivo instalado debe hablarla`,
  );

  /*
   * Read from the repository rather than guessed: `extra.eas.projectId` is what links this
   * application to an EAS project, and the production profile's API URL is the one value that must
   * not still be a placeholder when a store build is made.
   */
  const appJson = JSON.parse(
    readFileSync(resolve(process.cwd(), "../../apps/field/app.json"), "utf8"),
  ) as { expo?: { extra?: { eas?: { projectId?: string } }; owner?: string } };
  const easJson = JSON.parse(
    readFileSync(resolve(process.cwd(), "../../apps/field/eas.json"), "utf8"),
  ) as { build?: Record<string, { env?: Record<string, string> }> };
  const easProjectId = appJson.expo?.extra?.eas?.projectId;
  report(
    easProjectId === undefined ? "WAIT" : "OK",
    "proyecto EAS",
    easProjectId === undefined
      ? "sin vincular — requiere una cuenta Expo (docs/FIELD_MOBILE_BUILDS.md)"
      : "vinculado",
  );
  const productionApi = easJson.build?.["production"]?.env?.["EXPO_PUBLIC_API_URL"] ?? "";
  report(
    productionApi.includes("REPLACE") ? "WAIT" : "OK",
    "URL de producción del móvil",
    productionApi.includes("REPLACE")
      ? "aún es un marcador de posición — depende de la decisión de hosting (G7)"
      : "configurada",
  );

  /* ── proyectos ────────────────────────────────────────────────────────────────────────────── */
  heading("PROYECTOS");

  const projects = await rows<{
    id: string;
    slug: string;
    name: string;
    official_title: string | null;
    location_label: string | null;
    profile_key: string;
    lifecycle: string;
    roles: string[] | null;
    datasets: number;
    parcels: number;
    published_versions: number;
    draft_versions: number;
    capture_channel: string | null;
    campaign_status: string | null;
    offline_mode: string | null;
    documents: number;
  }>(sql`
    select p.id, p.slug, p.name, p.official_title, p.location_label,
           p.profile_key, p.lifecycle::text as lifecycle,
           (select array_agg(pm.role::text) from app.project_membership pm
             where pm.project_id = p.id and pm.status = 'active')                  as roles,
           (select count(distinct sdv.id)::int from app.spatial_dataset_version sdv
             where sdv.project_id = p.id and sdv.is_active)                        as datasets,
           (select count(distinct g.parcel_id)::int from app.parcel_geometry g
             where g.project_id = p.id and g.is_active)                            as parcels,
           (select count(*)::int from app.survey_version v
             where v.project_id = p.id and v.status = 'PUBLISHED')                 as published_versions,
           (select count(*)::int from app.survey_version v
             where v.project_id = p.id and v.status = 'DRAFT')                     as draft_versions,
           (select c.capture_channel::text from app.survey_campaign c
             where c.project_id = p.id
             order by coalesce(c.activated_at, c.created_at) desc limit 1)         as capture_channel,
           (select c.status::text from app.survey_campaign c
             where c.project_id = p.id
             order by coalesce(c.activated_at, c.created_at) desc limit 1)         as campaign_status,
           (select cfg.value from app.project_configuration cfg
             where cfg.project_id = p.id and cfg.key = 'field.surveys.offline_mode')
                                                                                   as offline_mode,
           (select count(*)::int from app.source_document d where d.project_id = p.id)
                                                                                   as documents
      from app.project p
     order by p.created_at
  `);

  const capabilities = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<
    CapabilityKey,
    boolean
  >;

  const blockedByRule = new Map<ReadinessRuleKey, number>();
  const operableIds = new Set<string>();
  let operable = 0;
  let planning = 0;

  for (const project of projects) {
    if (project.lifecycle === "planning") planning += 1;
    const report_ = evaluateReadiness({
      project: {
        name: project.name,
        officialTitle: project.official_title,
        locationLabel: project.location_label,
        lifecycle: project.lifecycle,
      },
      roles: project.roles ?? [],
      // Every catalogue key assumed on: this script reads the database as a migrator, not as a
      // member, so it cannot resolve a project's effective capabilities. Assuming them on makes the
      // answer about the project's *content*, which is what an onboarding checklist is for, and
      // never reports a project ready that the resolver would then refuse.
      capabilities,
      cartography: { activeDatasets: project.datasets, parcelsWithGeometry: project.parcels },
      questionnaire: {
        publishedVersions: project.published_versions,
        draftVersions: project.draft_versions,
      },
      campaign: {
        captureChannel: (project.capture_channel as CaptureChannel | null) ?? null,
        status: project.campaign_status,
      },
      offlineMode: readFieldOfflineMode(project.offline_mode),
      corpus: { documents: project.documents },
      storage: {
        available: storage.state === "AVAILABLE",
        reason: storage.state === "AVAILABLE" ? null : storage.reason,
      },
    });
    if (report_.operable) {
      operable += 1;
      operableIds.add(project.id);
    }
    for (const key of report_.blocking) {
      blockedByRule.set(key, (blockedByRule.get(key) ?? 0) + 1);
    }
  }

  report("OK", "proyectos", `${projects.length} en total · ${planning} en planificación`);
  report(
    operable === projects.length ? "OK" : "WAIT",
    "operables",
    `${operable} de ${projects.length} cumplen las reglas obligatorias`,
  );
  if (blockedByRule.size > 0) {
    const worst = [...blockedByRule.entries()].sort((a, b) => b[1] - a[1]);
    for (const [rule, count] of worst) {
      report("WAIT", `regla ${rule}`, `bloquea ${count} proyecto(s)`);
    }
  }

  /* ── el programa de ocho vías ─────────────────────────────────────────────────────────────── */
  heading("PROGRAMA");

  /*
   * Counted **per profile, read from the rows** rather than against a hardcoded project type.
   *
   * The obvious version of this check filters for the pilot's profile key and compares with eight.
   * That would put "road" — this programme's project type — into product code, which CLAUDE.md
   * rule 3 forbids and the forbidden-strings check enforces. The rule is right: the next customer's
   * programme is not eight roads, and a diagnostic that only counts roads would quietly report
   * zero for them.
   *
   * So the script reports what it can see — how many projects exist under each profile, and how
   * many are operable — and the programme's own target of eight lives where a programme fact
   * belongs: docs/EIGHT_ROAD_ONBOARDING.md.
   */
  const byProfile = new Map<string, { total: number; operable: number }>();
  for (const project of projects) {
    const key = getSystemProfile(project.profile_key)?.key ?? project.profile_key;
    const entry = byProfile.get(key) ?? { total: 0, operable: 0 };
    entry.total += 1;
    if (operableIds.has(project.id)) entry.operable += 1;
    byProfile.set(key, entry);
  }
  if (byProfile.size === 0) {
    report("WAIT", "proyectos por perfil", "ninguno — la hoja es docs/EIGHT_ROAD_ONBOARDING.md");
  }
  for (const [profile, counts] of [...byProfile.entries()].sort()) {
    report(
      counts.operable === counts.total ? "OK" : "WAIT",
      `perfil ${profile}`,
      `${counts.total} proyecto(s) · ${counts.operable} operable(s) — ` +
        "la hoja de incorporación es docs/EIGHT_ROAD_ONBOARDING.md",
    );
  }

  /* ── lo que ninguna consulta puede responder ──────────────────────────────────────────────── */
  heading("VERIFICACIÓN EXTERNA");

  report(
    "EXT",
    "revisión de privacidad",
    "VERIFICACIÓN EXTERNA REQUERIDA — docs/PRODUCTION_PRIVACY_CHECKLIST.md",
  );
  report(
    "EXT",
    "UAT en equipo físico",
    "VERIFICACIÓN EXTERNA REQUERIDA — docs/FIELD_MOBILE_OFFLINE_UAT.md",
  );
  report(
    "EXT",
    "ensayo de restauración",
    "VERIFICACIÓN EXTERNA REQUERIDA — docs/PRODUCTION_RECOVERY.md §6",
  );
  report(
    "EXT",
    "decisión de infraestructura",
    "VERIFICACIÓN EXTERNA REQUERIDA — docs/PRODUCTION_INFRASTRUCTURE_DECISION.md",
  );

  process.stdout.write(
    `\n${failures} condición(es) incorrecta(s) · ` +
      `${external} verificación(es) externa(s) pendiente(s)\n` +
      "una verificación externa no es un fallo: es una decisión que nadie ha tomado todavía\n",
  );
} finally {
  await pool.end();
}

process.exit(failures === 0 ? 0 : 1);
