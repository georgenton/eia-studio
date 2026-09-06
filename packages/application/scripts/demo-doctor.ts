import {
  appEnvSchema,
  assistantEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  socialEnvSchema,
} from "@eia/contracts";
import { createDatabase, createPool } from "@eia/db";
import { resolveAiAdapterAvailability, resolveClassifierAvailability } from "@eia/domain";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { resolve } from "node:path";

/**
 * Is this environment fit to be shown to the consultancy?
 *
 *   pnpm demo:doctor [--tenant demo-consultancy] [--project puente-del-amor]
 *
 * **Read-only.** Every statement is a `select`; nothing is written, nothing is repaired, and the
 * script refuses no environment — it reports on whichever database the connection names. It exists
 * because "the demo is broken" is discovered at the worst possible moment otherwise, and because
 * the difference between *missing* and *empty on purpose* is a distinction only the product knows.
 *
 * ## What it will not print
 *
 * No connection string, no credential, no token, no answer text, no respondent, no owner, no
 * parcel-level personal attribute — none of which exist in this product anyway, which is itself one
 * of the things worth being able to state. It prints counts, identifiers of *things* (a campaign's
 * name, a plan's code) and states.
 *
 * ## Exit code
 *
 * Non-zero only for conditions that would **materially break the walkthrough**: no project, no
 * imported cartography, no active field operation, no management plan, missing sign-in identities,
 * or — the one that is about honesty rather than function — deterministic classifier output stored
 * in a persistent environment, where nobody could afterwards tell it from a model's.
 *
 * A `WARN` is a thing worth knowing before the meeting; it does not fail the command.
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const tenantSlug = arg("tenant", "demo-consultancy");
const projectSlug = arg("project", "puente-del-amor");

type Level = "OK" | "WARN" | "FAIL";
const rows: Array<{ level: Level; check: string; detail: string }> = [];
const report = (level: Level, check: string, detail: string) => {
  rows.push({ level, check, detail });
};

const app = loadEnv("app", appEnvSchema);
const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const pool = createPool(migrator.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-demo-doctor",
  // Reads only, but a doctor that hangs is a doctor nobody runs before a meeting.
  statementTimeoutMs: 15_000,
});
const db = createDatabase(pool);

/** One scalar, or null when the query returned no row. */
async function one<T>(query: ReturnType<typeof sql>): Promise<T | null> {
  const result = await db.execute(query);
  return (result.rows[0] as T | undefined) ?? null;
}

/** Every row, for the checks that report *which* thing is missing rather than how many. */
async function all<T>(query: ReturnType<typeof sql>): Promise<ReadonlyArray<T>> {
  const result = await db.execute(query);
  return result.rows as ReadonlyArray<T>;
}

try {
  /* ── the project itself ─────────────────────────────────────────────────────────────────── */
  const project = await one<{
    id: string;
    tenant_id: string;
    name: string;
    official_title: string | null;
    programme_reference: string | null;
    lifecycle: string;
  }>(sql`
    select p.id, p.tenant_id, p.name, p.official_title, p.programme_reference, p.lifecycle::text
      from app.project p
      join app.tenant t on t.id = p.tenant_id
     where t.slug = ${tenantSlug} and p.slug = ${projectSlug}
  `);

  if (!project) {
    report("FAIL", "proyecto", `no existe ${tenantSlug}/${projectSlug}`);
  } else {
    report(
      "OK",
      "proyecto",
      `${project.name} · ${project.lifecycle}` +
        (project.programme_reference ? ` · ${project.programme_reference}` : ""),
    );
    report(
      project.official_title ? "OK" : "WARN",
      "título oficial",
      project.official_title ? `${project.official_title.slice(0, 72)}…` : "sin título oficial",
    );
  }

  if (project) {
    const scope = sql`tenant_id = ${project.tenant_id} and project_id = ${project.id}`;

    /* ── cartography ──────────────────────────────────────────────────────────────────────── */
    const imported = await one<{ n: number }>(sql`
      select count(*)::int as n from app.spatial_dataset_version
       where ${scope} and is_active and origin = 'imported'
    `);
    report(
      (imported?.n ?? 0) > 0 ? "OK" : "FAIL",
      "cartografía importada",
      `${imported?.n ?? 0} dataset(s) activos de origen importado`,
    );

    const parcels = await one<{ n: number; with_geometry: number }>(sql`
      select count(*)::int as n,
             count(*) filter (
               where exists (select 1 from app.parcel_geometry g
                              where g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active)
             )::int as with_geometry
        from app.parcel p where ${scope}
    `);
    report(
      (parcels?.n ?? 0) > 0 ? "OK" : "FAIL",
      "predios",
      `${parcels?.n ?? 0} predios · ${parcels?.with_geometry ?? 0} con geometría activa`,
    );

    const alignment = await one<{ length_m: string | null }>(sql`
      select round(a.length_m)::text as length_m
        from app.alignment a
        join app.spatial_dataset_version v
          on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
       where a.tenant_id = ${project.tenant_id} and a.project_id = ${project.id}
       limit 1
    `);
    report(
      alignment?.length_m ? "OK" : "WARN",
      "eje vial",
      alignment?.length_m ? `${alignment.length_m} m medidos` : "sin eje activo",
    );

    const areas = await one<{ n: number }>(sql`
      select count(*)::int as n from app.influence_area ia
        join app.spatial_dataset_version v
          on v.tenant_id = ia.tenant_id and v.id = ia.dataset_version_id and v.is_active
       where ia.tenant_id = ${project.tenant_id} and ia.project_id = ${project.id}
    `);
    report(
      (areas?.n ?? 0) > 0 ? "OK" : "WARN",
      "áreas de influencia",
      `${areas?.n ?? 0} delimitadas`,
    );

    const affectations = await one<{ n: number }>(sql`
      select count(*)::int as n from app.affectation where ${scope}
    `);
    report("OK", "afectaciones", `${affectations?.n ?? 0} áreas afectadas`);

    /* ── the field operation ──────────────────────────────────────────────────────────────── */
    const campaign = await one<{
      id: string;
      name: string;
      status: string;
      assignments: number;
      submitted: number;
    }>(sql`
      select c.id, c.name, c.status::text as status,
             (select count(*)::int from app.field_assignment a
               where a.tenant_id = c.tenant_id and a.campaign_id = c.id) as assignments,
             (select count(*)::int from app.survey_instance i
                join app.field_assignment a2
                  on a2.tenant_id = i.tenant_id and a2.id = i.assignment_id
               where a2.campaign_id = c.id and i.status = 'SUBMITTED') as submitted
        from app.survey_campaign c
       where c.tenant_id = ${project.tenant_id} and c.project_id = ${project.id}
       order by (c.status = 'ACTIVE') desc, c.activated_at desc nulls last, c.created_at desc
       limit 1
    `);
    if (!campaign || campaign.status !== "ACTIVE") {
      report(
        "FAIL",
        "operativo actual",
        campaign ? `el más reciente está ${campaign.status}` : "no hay campaña de campo",
      );
    } else {
      report(
        "OK",
        "operativo actual",
        `${campaign.name} · ${campaign.assignments} asignaciones · ${campaign.submitted} fichas enviadas`,
      );
    }

    const closed = await one<{ n: number }>(sql`
      select count(*)::int as n from app.survey_campaign
       where ${scope} and status = 'CLOSED'
    `);
    if ((closed?.n ?? 0) > 0) {
      report("OK", "operativos anteriores", `${closed?.n} cerrado(s), conservados como historia`);
    }

    /* ── the management plan ──────────────────────────────────────────────────────────────── */
    const pgas = await one<{
      source_file: string;
      plans: number;
      programmes: number;
      measures: number;
    }>(sql`
      select r.source_file,
             (select count(*)::int from app.pgas_plan p
               where p.tenant_id = r.tenant_id and p.import_run_id = r.id) as plans,
             (select count(distinct coalesce(m.programme_title, '—'))::int
                from app.pgas_measure m
                join app.pgas_plan p2 on p2.tenant_id = m.tenant_id and p2.id = m.plan_id
               where p2.import_run_id = r.id) as programmes,
             (select count(*)::int from app.pgas_measure m2
                join app.pgas_plan p3 on p3.tenant_id = m2.tenant_id and p3.id = m2.plan_id
               where p3.import_run_id = r.id) as measures
        from app.pgas_import_run r
       where r.tenant_id = ${project.tenant_id} and r.project_id = ${project.id} and r.is_active
       limit 1
    `);
    if (!pgas) {
      report("FAIL", "plan de manejo", "no hay importación activa del capítulo");
    } else {
      report(
        "OK",
        "plan de manejo",
        `${pgas.plans} planes · ${pgas.programmes} programas · ${pgas.measures} medidas · ${pgas.source_file}`,
      );
    }

    /* ── consistency, documents, reports ──────────────────────────────────────────────────── */
    const findings = await one<{ total: number; open: number; decided: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where state = 'OPEN')::int as open,
             count(*) filter (where state <> 'OPEN')::int as decided
        from app.quality_finding where ${scope}
    `);
    report(
      (findings?.total ?? 0) > 0 ? "OK" : "WARN",
      "control de consistencia",
      `${findings?.total ?? 0} hallazgos · ${findings?.open ?? 0} abiertos · ${findings?.decided ?? 0} decididos`,
    );

    const documents = await one<{ docs: number; versions: number; chunks: number }>(sql`
      select (select count(*)::int from app.source_document where ${scope}) as docs,
             (select count(*)::int from app.document_version where ${scope}) as versions,
             (select count(*)::int from app.document_chunk where ${scope}) as chunks
    `);
    report(
      (documents?.docs ?? 0) > 0 ? "OK" : "WARN",
      "documentos",
      `${documents?.docs ?? 0} documentos · ${documents?.versions ?? 0} versiones · ${documents?.chunks ?? 0} pasajes`,
    );

    const reports = await one<{ versions: number }>(sql`
      select count(*)::int as versions from app.report_version where ${scope}
    `);
    report(
      "OK",
      "informes",
      `${reports?.versions ?? 0} versión(es) generadas` +
        ((reports?.versions ?? 0) === 0 ? " — se genera en vivo durante la demostración" : ""),
    );

    /* ── social ───────────────────────────────────────────────────────────────────────────── */
    const social = await one<{
      taxonomy: number;
      classifications: number;
      reviews: number;
      fake_rows: number;
    }>(sql`
      select (select count(*)::int from app.taxonomy_version
               where ${scope} and status = 'PUBLISHED') as taxonomy,
             (select count(*)::int from app.ai_classification where ${scope}) as classifications,
             (select count(*)::int from app.human_review where ${scope}) as reviews,
             (select count(*)::int from app.ai_classification c
                join app.classification_run r on r.tenant_id = c.tenant_id and r.id = c.run_id
               where c.tenant_id = ${project.tenant_id} and c.project_id = ${project.id}
                 and r.classifier_kind = 'fake') as fake_rows
    `);
    report(
      (social?.taxonomy ?? 0) > 0 ? "OK" : "WARN",
      "esquema de codificación",
      `${social?.taxonomy ?? 0} versión(es) publicadas`,
    );
    report(
      "OK",
      "codificación social",
      `${social?.classifications ?? 0} propuestas · ${social?.reviews ?? 0} validaciones`,
    );

    /*
     * The one honesty check with teeth. A deterministic stand-in's output and a model's are the
     * same shape once stored, so a persistent environment holding fake rows is an environment that
     * cannot answer "did a model write this?" (IG4-001).
     */
    if ((social?.fake_rows ?? 0) > 0) {
      report(
        app.APP_ENV === "local" || app.APP_ENV === "test" ? "OK" : "FAIL",
        "resultados del clasificador determinista",
        `${social?.fake_rows} fila(s) de un clasificador \`fake\` en APP_ENV=${app.APP_ENV}`,
      );
    }

    /* ── provenance integrity ─────────────────────────────────────────────────────────────── */
    const dangling = await one<{ n: number }>(sql`
      select count(*)::int as n
        from app.metric_snapshot m
       where m.tenant_id = ${project.tenant_id} and m.project_id = ${project.id}
         and not exists (select 1 from app.provenance_record pr
                          where pr.tenant_id = m.tenant_id and pr.id = m.provenance_id)
    `);
    report(
      (dangling?.n ?? 0) === 0 ? "OK" : "FAIL",
      "procedencia",
      (dangling?.n ?? 0) === 0
        ? "sin referencias colgantes"
        : `${dangling?.n} métricas sin registro`,
    );

    /* ── the identities the walkthrough signs in as ───────────────────────────────────────── */
    // Named one by one, and the missing ones are named back. A count alone reported "4 de 5" as
    // OK on staging while `revisor@demo.invalid` did not exist — and the reviewer is the identity
    // the walkthrough switches to in order to settle a finding, which is the whole Quality Gate
    // beat. The address is a synthetic `.invalid` account, not personal data.
    const expected = [
      "coordinadora@demo.invalid",
      "especialista@demo.invalid",
      "revisor@demo.invalid",
      "tecnico@demo.invalid",
      "admin@demo.invalid",
    ];
    const present = await all<{ email: string }>(sql`
      select u.email
        from app."user" u
        join app.tenant_membership tm on tm.user_id = u.id and tm.tenant_id = ${project.tenant_id}
       where u.email in (${sql.join(
         expected.map((email) => sql`${email}`),
         sql`, `,
       )})
    `);
    const have = new Set(present.map((row) => row.email));
    const missing = expected.filter((email) => !have.has(email));
    report(
      missing.length === 0
        ? "OK"
        : // Nobody can sign in at all without the coordinator; the rest lose one beat each.
          missing.includes("coordinadora@demo.invalid")
          ? "FAIL"
          : "WARN",
      "identidades de demostración",
      missing.length === 0
        ? "las 5 con membresía en la organización"
        : `faltan ${missing.length} de 5: ${missing.join(", ")} — no se podrá cambiar de identidad`,
    );
  }

  /* ── AI availability, from configuration alone ──────────────────────────────────────────── */
  const socialEnv = loadEnv("social", socialEnvSchema);
  const assistantEnv = loadEnv("assistant", assistantEnvSchema);
  const classifier = resolveClassifierAvailability({
    appEnv: app.APP_ENV,
    classifier: socialEnv.SOCIAL_CLASSIFIER,
    model: socialEnv.SOCIAL_CLASSIFIER_MODEL,
    gatewayApiKeyPresent: socialEnv.AI_GATEWAY_API_KEY !== undefined,
  });
  const assistant = resolveAiAdapterAvailability({
    appEnv: app.APP_ENV,
    variable: "ASSISTANT_GENERATOR",
    modelVariable: "ASSISTANT_GENERATOR_MODEL",
    feature: "la redacción asistida",
    adapter: assistantEnv.ASSISTANT_GENERATOR,
    model: assistantEnv.ASSISTANT_GENERATOR_MODEL,
    credentialPresent: assistantEnv.AI_GATEWAY_API_KEY !== undefined,
  });
  const describe = (a: typeof classifier) =>
    a.state === "AVAILABLE"
      ? `${a.live ? "en vivo" : "determinista"} · ${a.kind} · ${a.model}`
      : `no disponible · ${a.reason}`;
  // Availability is a state, not a fault: the deterministic half of the product works either way.
  report("OK", "codificación asistida", describe(classifier));
  report("OK", "redacción asistida", describe(assistant));

  /* ── the worker, where it is observable ─────────────────────────────────────────────────── */
  const worker = await one<{ n: number }>(sql`
    select count(*)::int as n from pg_stat_activity
     where application_name like 'eia-studio-worker%'
  `);
  report(
    "OK",
    "worker",
    (worker?.n ?? 0) > 0
      ? `${worker?.n} conexión(es) activas`
      : "sin conexión observable desde esta base (no implica que esté caído)",
  );

  /* ── output ─────────────────────────────────────────────────────────────────────────────── */
  const width = Math.max(...rows.map((r) => r.check.length));
  console.log(`\ndemo:doctor · ${tenantSlug}/${projectSlug} · APP_ENV=${app.APP_ENV}\n`);
  for (const row of rows) {
    console.log(`${row.level.padEnd(4)} ${row.check.padEnd(width)}  ${row.detail}`);
  }
  const failures = rows.filter((r) => r.level === "FAIL");
  const warnings = rows.filter((r) => r.level === "WARN");
  console.log(
    `\n${rows.length} comprobaciones · ${failures.length} FAIL · ${warnings.length} WARN\n`,
  );
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
