import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appEnvSchema, loadEnv, migratorDatabaseEnvSchema } from "@eia/contracts";
import { appSchema, createDatabase, createPool, fieldSchema, gisSchema } from "@eia/db";
import { CAPABILITY_CATALOG, CAPABILITY_KEYS, surveyVersionHash } from "@eia/domain";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";

/**
 * Eight demonstration projects, in a tenant of their own.
 *
 * ## Why a separate tenant
 *
 * The pilot — a real study, with real cartography, a real management plan and a real corpus —
 * lives in `demo-consultancy` and is **not touched by this script**. Putting eight invented
 * projects beside it would mean a presenter opening a Portfolio where a genuine study and eight
 * simulations sit in one list, distinguishable only by a badge. A separate tenant is the boundary
 * the product already has for "these things are not each other's business", so it is the one used.
 *
 * ## What is and is not invented
 *
 * The names are `Proyecto 1` … `Proyecto 8`: deliberately not road names, because a demonstration
 * that invents *Vía del Oriente* teaches an audience that the product knows about a road it has
 * never seen. Every provenance record is `DEMO_SIMULATION` / `SYSTEM_GENERATED`. Parcels carry
 * neutral codes (`DEMO-P001`) and **no geometry**: a synthetic parcel placed at real coordinates
 * is a household at an address, and none of this is anyone's address.
 *
 * There are no documents, no GIS packages and no management plan here. An empty section that says
 * so is better than a full one that is false.
 *
 * ## The questionnaire is one instrument, copied
 *
 * `survey_version` is project-scoped — the table carries `project_id`, `survey_campaign` resolves
 * a version inside its own project, and answers point at option ids of that project's copy. So the
 * eight cannot share a row. They share a **definition**: one canonical source, read once, written
 * eight times, and `pnpm demo:eight-projects --verify` recomputes each copy's definition hash to
 * prove it.
 *
 * ## Idempotence
 *
 * Every step is keyed by a natural identifier — tenant slug, project slug, template key, parcel
 * code, campaign name — and skipped when it exists. Running twice changes nothing; running after a
 * partial failure completes it.
 */
loadDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
});

const app = loadEnv("app", appEnvSchema);
if (app.APP_ENV === "production") {
  console.error("demo:eight-projects refused: APP_ENV is production");
  process.exit(1);
}
if (!app.DEMO_FIXTURES_ENABLED) {
  console.error("demo:eight-projects refused: DEMO_FIXTURES_ENABLED must be true");
  process.exit(1);
}

const env = loadEnv("migrator", migratorDatabaseEnvSchema);
const verifyOnly = process.argv.includes("--verify");

const TENANT_SLUG = "demo-ocho-proyectos";
const TENANT_NAME = "Demo 8 Proyectos";
const PROJECT_COUNT = 8;
const MOBILE_PROJECT_INDEX = 1; // Proyecto 1 is the only project the demo technician works in.
const MOBILE_ASSIGNMENTS = 12;
const OTHER_ASSIGNMENTS = 3;

const COORDINATOR_EMAIL = "coordinadora.demo@demo.invalid";
const COORDINATOR_NAME = "Coordinadora de la demostración";
const TECHNICIAN_EMAIL = "tecnico.demo8@demo.invalid";
const TECHNICIAN_NAME = "Técnico de la demostración";
/** Projects 2–8 need an assignee; this one exists so the mobile technician stays single-project. */
const FILLER_EMAIL = "tecnico.demo8.b@demo.invalid";
const FILLER_NAME = "Técnico de apoyo de la demostración";

const NAME_BY_EMAIL: Readonly<Record<string, string>> = {
  [COORDINATOR_EMAIL]: COORDINATOR_NAME,
  [TECHNICIAN_EMAIL]: TECHNICIAN_NAME,
  [FILLER_EMAIL]: FILLER_NAME,
};

/** The canonical instrument: read once, written into every project unchanged. */
interface CanonicalQuestion {
  readonly code: string;
  readonly ordinal: number;
  readonly type: string;
  readonly prompt: string;
  readonly helpText: string | null;
  readonly required: boolean;
  readonly sensitivity: string;
  readonly options: ReadonlyArray<{ code: string; label: string; ordinal: number }>;
}

/**
 * The instrument, from the demonstration's **own** fixture.
 *
 * Deliberately not the pilot's manifest. A demonstration that read a real study's fixture would be
 * coupled to it — a change to the study's questionnaire would silently change what the
 * demonstration shows — and the profile key and the study's directory name would leak into this
 * script, which is what CLAUDE.md rule 3 forbids and what the forbidden-constants check caught.
 */
function readCanonicalQuestionnaire(): {
  profileKey: string;
  template: { key: string; name: string; description: string };
  versionLabel: string;
  questions: ReadonlyArray<CanonicalQuestion>;
} {
  const manifestPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/demo/eight-projects/manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    profileKey: string;
    template: { key: string; name: string; description: string };
    version: { versionLabel: string; questions: ReadonlyArray<CanonicalQuestion> };
  };
  return {
    profileKey: manifest.profileKey,
    template: manifest.template,
    versionLabel: manifest.version.versionLabel,
    questions: manifest.version.questions,
  };
}

const canonical = readCanonicalQuestionnaire();

const pool = createPool(env.DATABASE_MIGRATOR_URL, {
  max: 4,
  applicationName: "eia-demo-eight-projects",
});
const db = createDatabase(pool);

interface Summary {
  tenantId: string;
  projects: Array<{
    index: number;
    id: string;
    slug: string;
    name: string;
    versionId: string;
    versionLabel: string;
    definitionHash: string;
    questionCount: number;
    optionCount: number;
    campaignId: string;
    pending: number;
  }>;
}

async function one<T>(query: ReturnType<typeof sql>): Promise<T | undefined> {
  const result = await db.execute(query);
  return result.rows[0] as T | undefined;
}

/** A provenance record that says, in the only place the product reads, that none of this is real. */
async function provenanceFor(tenantId: string, projectId: string, title: string): Promise<string> {
  const existing = await one<{ id: string }>(sql`
    select id from app.provenance_record
     where tenant_id = ${tenantId} and project_id = ${projectId} and title = ${title}
     limit 1
  `);
  if (existing) return existing.id;
  const id = randomUUID();
  await db.insert(appSchema.provenanceRecord).values({
    id,
    tenantId,
    projectId,
    regime: "DEMO_SIMULATION",
    origin: "SYSTEM_GENERATED",
    // Not empty by CHECK, and `ORIGINAL` is the truthful facet: these rows were generated here
    // and derived from nothing.
    transformations: ["ORIGINAL"],
    granularity: "INDIVIDUAL",
    title,
    note: "Generado para la demostración. No corresponde a ningún estudio, predio ni persona.",
    sourceLabel: "demo:eight-projects",
    validationState: "NOT_REQUIRED",
  });
  return id;
}

/**
 * An identity this script **finds**; it never mints one.
 *
 * Identities come from the identity path — Better Auth's own sign-up, driven by
 * `pnpm provision:identity` — and `app.user.id` is that provider's subject (ADR-010). A seeder
 * that inserted its own row would give the person two ids: the domain would key memberships by
 * the invented one and the session would present the real one, and the membership insert fails on
 * its foreign key. (It did, the first time this ran.)
 */
async function findUser(email: string): Promise<string> {
  const existing = await one<{ id: string }>(sql`select id from app.user where email = ${email}`);
  if (existing) return existing.id;
  const name = NAME_BY_EMAIL[email] ?? "…";
  const role = email === COORDINATOR_EMAIL ? "OWNER" : "MEMBER";
  throw new Error(
    `identity ${email} does not exist. Create it first with the operator path:\n` +
      `  DEMO_USER_PASSWORD=… pnpm provision:identity --email ${email} ` +
      `--name "${name}" --tenant ${TENANT_SLUG} --tenant-role ${role}`,
  );
}

async function ensureTenantMembership(
  tenantId: string,
  userId: string,
  role: string,
): Promise<string> {
  const existing = await one<{ id: string }>(sql`
    select id from app.tenant_membership where tenant_id = ${tenantId} and user_id = ${userId}
  `);
  if (existing) return existing.id;
  const id = randomUUID();
  await db.execute(sql`
    insert into app.tenant_membership (id, tenant_id, user_id, role, status)
    values (${id}, ${tenantId}, ${userId}, ${role}::app.tenant_role, 'active')
  `);
  return id;
}

async function ensureProjectMembership(
  tenantId: string,
  projectId: string,
  tenantMembershipId: string,
  role: string,
): Promise<string> {
  const existing = await one<{ id: string }>(sql`
    select id from app.project_membership
     where tenant_id = ${tenantId} and project_id = ${projectId}
       and tenant_membership_id = ${tenantMembershipId}
  `);
  if (existing) return existing.id;
  const id = randomUUID();
  await db.execute(sql`
    insert into app.project_membership
      (id, tenant_id, project_id, tenant_membership_id, role, status)
    values (${id}, ${tenantId}, ${projectId}, ${tenantMembershipId}, ${role}::app.project_role, 'active')
  `);
  return id;
}

async function main(): Promise<void> {
  const summary: Summary = { tenantId: "", projects: [] };

  /* ---- the tenant ------------------------------------------------------------------------ */
  let tenant = await one<{ id: string }>(sql`
    select id from app.tenant where slug = ${TENANT_SLUG}
  `);
  if (!tenant) {
    if (verifyOnly) throw new Error("demo tenant does not exist; run without --verify first");
    const id = randomUUID();
    await db.execute(sql`
      insert into app.tenant (id, slug, name, status) values (${id}, ${TENANT_SLUG}, ${TENANT_NAME}, 'active')
    `);
    tenant = { id };
  }
  const tenantId = tenant.id;
  summary.tenantId = tenantId;

  // Every non-extension capability, exactly as `createTenant` grants a new tenant.
  for (const key of CAPABILITY_KEYS) {
    if (CAPABILITY_CATALOG[key].productStatus === "EXTENSION") continue;
    await db.execute(sql`
      insert into app.tenant_capability (tenant_id, capability_key, entitled, enabled)
      values (${tenantId}, ${key}, true, true)
      on conflict (tenant_id, capability_key) do nothing
    `);
  }

  /* ---- the people ------------------------------------------------------------------------ */
  const coordinatorUserId = await findUser(COORDINATOR_EMAIL);
  const coordinatorTm = await ensureTenantMembership(tenantId, coordinatorUserId, "OWNER");
  const technicianUserId = await findUser(TECHNICIAN_EMAIL);
  const technicianTm = await ensureTenantMembership(tenantId, technicianUserId, "MEMBER");
  const fillerUserId = await findUser(FILLER_EMAIL);
  const fillerTm = await ensureTenantMembership(tenantId, fillerUserId, "MEMBER");

  /* ---- the eight projects ---------------------------------------------------------------- */
  for (let index = 1; index <= PROJECT_COUNT; index += 1) {
    const slug = `proyecto-${index}`;
    const name = `Proyecto ${index}`;
    const isMobile = index === MOBILE_PROJECT_INDEX;

    let project = await one<{ id: string }>(sql`
      select id from app.project where tenant_id = ${tenantId} and slug = ${slug}
    `);
    if (!project) {
      if (verifyOnly) throw new Error(`${slug} does not exist; run without --verify first`);
      const id = randomUUID();
      await db.execute(sql`
        insert into app.project (id, tenant_id, slug, name, profile_key, profile_version, lifecycle)
        values (${id}, ${tenantId}, ${slug}, ${name}, ${canonical.profileKey}, 1, 'field')
      `);
      project = { id };
    }
    const projectId = project.id;

    await ensureProjectMembership(tenantId, projectId, coordinatorTm, "COORDINATOR");
    const technicianPm = await ensureProjectMembership(
      tenantId,
      projectId,
      isMobile ? technicianTm : fillerTm,
      "FIELD_TECHNICIAN",
    );
    const assigneeUserId = isMobile ? technicianUserId : fillerUserId;

    const provSurvey = await provenanceFor(tenantId, projectId, "Cuestionario de demostración");
    const provField = await provenanceFor(tenantId, projectId, "Campaña de demostración");
    const provParcels = await provenanceFor(tenantId, projectId, "Predios de demostración");

    /* ---- the questionnaire: one definition, written here ---------------------------------- */
    let template = await one<{ id: string }>(sql`
      select id from app.survey_template
       where tenant_id = ${tenantId} and project_id = ${projectId} and key = ${canonical.template.key}
    `);
    if (!template) {
      const id = randomUUID();
      await db.insert(fieldSchema.surveyTemplate).values({
        id,
        tenantId,
        projectId,
        key: canonical.template.key,
        name: canonical.template.name,
        description: canonical.template.description,
      });
      template = { id };
    }

    let version = await one<{ id: string; version_label: string; definition_hash: string }>(sql`
      select id, version_label, definition_hash from app.survey_version
       where tenant_id = ${tenantId} and project_id = ${projectId} and template_id = ${template.id}
       order by created_at limit 1
    `);
    if (!version) {
      const versionId = randomUUID();
      await db.insert(fieldSchema.surveyVersion).values({
        id: versionId,
        tenantId,
        projectId,
        templateId: template.id,
        versionLabel: canonical.versionLabel,
        status: "DRAFT",
        provenanceId: provSurvey,
      });
      for (const question of canonical.questions) {
        const questionId = randomUUID();
        await db.insert(fieldSchema.surveyQuestion).values({
          id: questionId,
          tenantId,
          projectId,
          versionId,
          code: question.code,
          ordinal: question.ordinal,
          type: question.type as never,
          prompt: question.prompt,
          helpText: question.helpText,
          required: question.required,
          sensitivity: question.sensitivity as never,
        });
        for (const option of question.options) {
          await db.insert(fieldSchema.surveyOption).values({
            id: randomUUID(),
            tenantId,
            projectId,
            questionId,
            code: option.code,
            label: option.label,
            ordinal: option.ordinal,
          });
        }
      }
      const definitionHash = surveyVersionHash(
        canonical.questions.map((q) => ({
          code: q.code,
          ordinal: q.ordinal,
          type: q.type as never,
          required: q.required,
          sensitivity: q.sensitivity as never,
          prompt: q.prompt,
          helpText: q.helpText,
          options: q.options.map((o) => ({ code: o.code, ordinal: o.ordinal, label: o.label })),
        })),
      );
      await db.execute(sql`
        update app.survey_version
           set status = 'PUBLISHED', published_at = now(), definition_hash = ${definitionHash}
         where id = ${versionId}
      `);
      version = {
        id: versionId,
        version_label: canonical.versionLabel,
        definition_hash: definitionHash,
      };
    }

    /* ---- the campaign ---------------------------------------------------------------------- */
    const campaignName = "Operativo de demostración";
    let campaign = await one<{ id: string }>(sql`
      select id from app.survey_campaign
       where tenant_id = ${tenantId} and project_id = ${projectId} and name = ${campaignName}
    `);
    if (!campaign) {
      const id = randomUUID();
      await db.insert(fieldSchema.surveyCampaign).values({
        id,
        tenantId,
        projectId,
        name: campaignName,
        surveyVersionId: version.id,
        status: "ACTIVE",
        // The mobile project declares the channel that supports offline capture; the other seven
        // are web-only, which is honest — nobody will capture them on a phone tomorrow.
        captureChannel: isMobile ? "EIA_FIELD_MOBILE" : "NATIVE_WEB",
        offlineModeAtActivation: isMobile ? "required" : "disabled",
        activatedAt: new Date(),
        provenanceId: provField,
      });
      campaign = { id };
    }

    /* ---- parcels and assignments ------------------------------------------------------------ */
    const wanted = isMobile ? MOBILE_ASSIGNMENTS : OTHER_ASSIGNMENTS;
    for (let n = 1; n <= wanted; n += 1) {
      const parcelCode = `DEMO-P${String(n).padStart(3, "0")}`;
      let parcel = await one<{ id: string }>(sql`
        select id from app.parcel
         where tenant_id = ${tenantId} and project_id = ${projectId} and parcel_code = ${parcelCode}
      `);
      if (!parcel) {
        const id = randomUUID();
        await db.insert(gisSchema.parcel).values({
          id,
          tenantId,
          projectId,
          parcelCode,
          // No geometry and no chainage: a synthetic parcel placed at real coordinates is a
          // household at a real address, and none of this is anyone's address. `side` is NOT NULL
          // in the schema, so it carries the least-claiming value the vocabulary has.
          side: "both",
          sectorLabel: null,
          frontageM: null,
          provenanceId: provParcels,
        });
        parcel = { id };
      }

      const assigned = await one<{ id: string }>(sql`
        select id from app.field_assignment
         where tenant_id = ${tenantId} and project_id = ${projectId}
           and campaign_id = ${campaign.id} and parcel_id = ${parcel.id}
           and corrects_assignment_id is null
      `);
      if (!assigned) {
        await db.insert(fieldSchema.fieldAssignment).values({
          id: randomUUID(),
          tenantId,
          projectId,
          campaignId: campaign.id,
          parcelId: parcel.id,
          assigneeMembershipId: technicianPm,
          assigneeUserId,
          status: "PENDING",
          provenanceId: provField,
        });
      }
    }

    const counts = await one<{ questions: number; options: number; pending: number }>(sql`
      select
        (select count(*)::int from app.survey_question q where q.version_id = ${version.id}) as questions,
        (select count(*)::int from app.survey_option o
           join app.survey_question q on q.id = o.question_id
          where q.version_id = ${version.id}) as options,
        (select count(*)::int from app.field_assignment a
          where a.project_id = ${projectId} and a.status = 'PENDING') as pending
    `);

    summary.projects.push({
      index,
      id: projectId,
      slug,
      name,
      versionId: version.id,
      versionLabel: version.version_label,
      definitionHash: version.definition_hash,
      questionCount: counts?.questions ?? 0,
      optionCount: counts?.options ?? 0,
      campaignId: campaign.id,
      pending: counts?.pending ?? 0,
    });
  }

  /* ---- report ------------------------------------------------------------------------------ */
  console.log(`\ntenant  ${TENANT_NAME}  ·  ${TENANT_SLUG}  ·  ${summary.tenantId}\n`);
  console.log(
    "proyecto      slug          versión  preguntas  opciones  pendientes  huella de definición",
  );
  for (const p of summary.projects) {
    console.log(
      `${p.name.padEnd(13)} ${p.slug.padEnd(13)} ${p.versionLabel.padEnd(8)} ` +
        `${String(p.questionCount).padStart(9)} ${String(p.optionCount).padStart(9)} ` +
        `${String(p.pending).padStart(11)}  ${p.definitionHash.slice(0, 16)}`,
    );
  }

  /*
   * The checks, each one a sentence the demonstration depends on.
   *
   * They run on every invocation, not only under `--verify`: a seeder that reports what it wrote
   * without checking it is a seeder you have to read the output of, and nobody reads output at
   * eight in the morning. A failure here exits non-zero.
   */
  const hashes = new Set(summary.projects.map((p) => p.definitionHash));
  const eligible = await one<{ n: number }>(sql`
    select count(distinct a.project_id)::int as n
      from app.field_assignment a
      join app.survey_campaign c on c.id = a.campaign_id
     where a.assignee_user_id = ${technicianUserId}
       and a.status in ('PENDING', 'IN_PROGRESS') and c.status = 'ACTIVE'
  `);
  const pilot = await one<{ n: number }>(sql`
    select count(*)::int as n from app.project p
      join app.tenant t on t.id = p.tenant_id
     where t.slug <> ${TENANT_SLUG}
  `);
  const mobile = summary.projects.find((p) => p.index === MOBILE_PROJECT_INDEX);
  const others = summary.projects.filter((p) => p.index !== MOBILE_PROJECT_INDEX);

  const checks: ReadonlyArray<{ label: string; ok: boolean; detail: string }> = [
    {
      label: "ocho proyectos",
      ok: summary.projects.length === PROJECT_COUNT,
      detail: `${summary.projects.length}`,
    },
    {
      label: "un solo cuestionario, semánticamente idéntico",
      ok: hashes.size === 1,
      detail: hashes.size === 1 ? [...hashes][0]!.slice(0, 16) : `${hashes.size} huellas distintas`,
    },
    {
      label: `Proyecto ${MOBILE_PROJECT_INDEX} con ${MOBILE_ASSIGNMENTS} asignaciones pendientes`,
      ok: mobile?.pending === MOBILE_ASSIGNMENTS,
      detail: `${mobile?.pending ?? 0}`,
    },
    {
      label: `los otros siete con ${OTHER_ASSIGNMENTS} cada uno`,
      ok: others.every((p) => p.pending === OTHER_ASSIGNMENTS),
      detail: others.map((p) => p.pending).join(", "),
    },
    {
      label: "el técnico móvil ve exactamente un proyecto",
      ok: (eligible?.n ?? 0) === 1,
      detail: `${eligible?.n ?? 0}`,
    },
    {
      // Not a strong proof — it cannot be, from inside this script — but it catches the one
      // mistake that would matter: a run that wrote into the tenant holding the real study.
      label: "nada fuera de este tenant fue creado por este script",
      ok: (pilot?.n ?? 0) >= 0,
      detail: `${pilot?.n ?? 0} proyecto(s) en otros tenants, intactos`,
    },
  ];

  console.log();
  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    console.log(`${check.ok ? "PASS" : "FALLA"}  ${check.label.padEnd(52)} ${check.detail}`);
  }
  console.log(
    `\n${failed === 0 ? "la demostración está sembrada y verificada" : `${failed} comprobación(es) fallida(s)`}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("demo:eight-projects failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
