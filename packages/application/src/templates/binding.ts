import { appSchema, pgasSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  draftBannerFor,
  InvalidInput,
  PLACEHOLDERS,
  requireCapability,
  requirePermission,
  type PlaceholderDefinition,
  type RequestContext,
  type TemplateBinding,
  type TemplateLocale,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";

/**
 * The one bounded object a template is rendered against (ADR-036 §5).
 *
 * ## Why this file is the only place values are assembled
 *
 * ADR-022's rule for the report generator was *the snapshot is the deliverable and the prose is a
 * rendering of it*. A template is another renderer, so the same shape applies one layer out:
 *
 * ```
 * validated data → deterministic binding → template → .docx
 * ```
 *
 * The renderer has no database access, the template has no database access, and no model is
 * anywhere on this path. Every value below is a deterministic read of a column or a count — a
 * project's own identity, a `metric_snapshot` somebody measured, the management plan's own rows.
 * **Nothing here reads an AI candidate, an AI classification, an open finding, a survey answer or
 * anything in the `pii` schema**, and the registry is the enumeration that makes those absences
 * checkable rather than merely intended.
 *
 * ## Why an absent value is `null` and never `0`
 *
 * A project that has not measured its corridor has no corridor length. Rendering `0` would be this
 * product inventing a measurement, and rendering an empty string would look like a deliberate
 * blank. `null` travels to the renderer, which prints the localized *no value* the caller supplies
 * — or refuses the document outright when the placeholder is one a document cannot be honest
 * without.
 */

/** Numbers are notation rather than copy, so they are formatted here; words are the catalogue's. */
const countFor = (locale: string, value: number) => new Intl.NumberFormat(locale).format(value);

const decimalFor = (locale: string, value: number) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    value,
  );

const dateFor = (locale: string, value: Date) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
    value,
  );

/** The metric keys the registry draws on, so a reader can see the mapping in one place. */
const METRIC_FOR_PLACEHOLDER: Readonly<Record<string, string>> = {
  "territory.corridor_length_km": "corridor_length_km",
  "territory.parcel_universe": "universe_confirmed",
  "social.surveys_complete": "surveys_complete",
  "social.consultation_participants": "consultation_participants",
};

export interface BuildBindingInput {
  readonly locale: TemplateLocale;
  /** The instant the document is being produced. Passed in so a test can fix it. */
  readonly generatedAt: Date;
}

/**
 * Read everything the registry declares, for one project, at one instant.
 *
 * Reads happen under the caller's RLS, so a binding can only ever carry this project's values —
 * two layers, as everywhere else: the query names the project and the policy names it again.
 */
export async function buildTemplateBinding(
  db: Database,
  ctx: RequestContext,
  input: BuildBindingInput,
): Promise<TemplateBinding> {
  requireCapability(ctx, "reports.social_generator");
  requirePermission(ctx, "reports.write");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const values = await readValues(tx, projectId, input);
    return {
      locale: input.locale,
      values: PLACEHOLDERS.map((definition) => ({
        key: definition.key,
        text: values.get(definition.key) ?? null,
      })),
    };
  });
}

async function readValues(
  tx: DbTx,
  projectId: string,
  input: BuildBindingInput,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const { locale } = input;

  const [project] = await tx
    .select({
      name: appSchema.project.name,
      officialTitle: appSchema.project.officialTitle,
      locationLabel: appSchema.project.locationLabel,
      programmeReference: appSchema.project.programmeReference,
    })
    .from(appSchema.project)
    .where(eq(appSchema.project.id, projectId));
  if (!project) throw new InvalidInput("this project cannot be read in this context");

  out.set("project.name", nonEmpty(project.name));
  out.set("project.official_title", nonEmpty(project.officialTitle));
  out.set("project.locality", nonEmpty(project.locationLabel));
  out.set("project.programme_reference", nonEmpty(project.programmeReference));

  // Metrics: a measured value with its own provenance record, or nothing. A key with no row is an
  // absence, not a zero.
  const metrics = await tx
    .select({
      key: appSchema.metricSnapshot.key,
      numericValue: appSchema.metricSnapshot.numericValue,
    })
    .from(appSchema.metricSnapshot)
    .where(eq(appSchema.metricSnapshot.projectId, projectId));
  const byKey = new Map(metrics.map((row) => [String(row.key), row.numericValue]));

  for (const [placeholder, metricKey] of Object.entries(METRIC_FOR_PLACEHOLDER)) {
    const raw = byKey.get(metricKey);
    if (raw === undefined || raw === null) {
      out.set(placeholder, null);
      continue;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      out.set(placeholder, null);
      continue;
    }
    const definition = definitionFor(placeholder);
    out.set(
      placeholder,
      definition.kind === "decimal" ? decimalFor(locale, numeric) : countFor(locale, numeric),
    );
  }

  // The management plan's own rows, of the import that is current. A project with no plan imported
  // has no counts — not three zeroes, which would read as a plan that proposes nothing.
  const pgas = await readPgasCounts(tx, projectId);
  out.set("pgas.plans", pgas === null ? null : countFor(locale, pgas.plans));
  out.set("pgas.programmes", pgas === null ? null : countFor(locale, pgas.programmes));
  out.set("pgas.measures", pgas === null ? null : countFor(locale, pgas.measures));

  out.set("generation.date", dateFor(locale, input.generatedAt));
  out.set("generation.locale", locale);
  // Supplied by this product, never by the template: what the banner says is not the author's to
  // choose (ADR-036 §7).
  out.set("generation.draft_banner", draftBannerFor(locale));

  return out;
}

interface PgasCounts {
  readonly plans: number;
  readonly programmes: number;
  readonly measures: number;
}

async function readPgasCounts(tx: DbTx, projectId: string): Promise<PgasCounts | null> {
  // The active run: a changed document is a new run whose rows supersede the previous one's
  // (ADR-024). Counting across every run would count a plan twice.
  const [run] = await tx
    .select({ id: pgasSchema.pgasImportRun.id })
    .from(pgasSchema.pgasImportRun)
    .where(
      and(
        eq(pgasSchema.pgasImportRun.projectId, projectId),
        eq(pgasSchema.pgasImportRun.isActive, true),
      ),
    );
  if (!run) return null;

  // A measure belongs to a plan, and a plan to the run: `pgas_measure` has no run column, so the
  // two counts about measures join through `pgas_plan` rather than assuming one.
  const result = await tx.execute(sql`
    select
      (select count(*)::int from app.pgas_plan p where p.import_run_id = ${run.id}) as plans,
      (select count(distinct m.programme_title)::int
         from app.pgas_measure m
         join app.pgas_plan p on p.tenant_id = m.tenant_id and p.id = m.plan_id
        where p.import_run_id = ${run.id} and m.programme_title is not null) as programmes,
      (select count(*)::int
         from app.pgas_measure m
         join app.pgas_plan p on p.tenant_id = m.tenant_id and p.id = m.plan_id
        where p.import_run_id = ${run.id}) as measures
  `);
  const row = result.rows[0] as { plans: number; programmes: number; measures: number } | undefined;
  if (!row) return null;
  return {
    plans: Number(row.plans),
    programmes: Number(row.programmes),
    measures: Number(row.measures),
  };
}

function definitionFor(key: string): PlaceholderDefinition {
  const definition = PLACEHOLDERS.find((entry) => entry.key === key);
  if (!definition) throw new InvalidInput(`no placeholder named ${key}`);
  return definition;
}

/** A blank column is an absence, not a value. */
function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new InvalidInput("this action needs a project context");
  return ctx.projectId;
}
