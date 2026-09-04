import {
  boolean,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, provenanceRecord } from "./app";

/**
 * The environmental and social management plan the study proposes (ADR-024).
 *
 * Three tables, because the delivered document has three levels — an import, its plans, and their
 * measures — and no more, because a *programme* in that document is a banner row with a title and
 * nothing else. Giving it a table would invent an entity the source does not contain, and would
 * make the two plans whose measures carry no programme hold a synthetic one.
 *
 * Nothing here models compliance. A measure is what the plan **proposes**; whether anybody is doing
 * it is a different product with its own capability (ADR-024 §7).
 */
export const pgasImportRun = app.table(
  "pgas_import_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** The delivered file, and the hash that identifies this delivery. */
    sourceFile: text("source_file").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    /** What the run produced, so a re-import can be compared without reading every row. */
    planCount: integer("plan_count").notNull(),
    measureCount: integer("measure_count").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true, mode: "date" }).notNull(),
    /**
     * Exactly one run is active per project. A changed document is a new run whose plans supersede
     * the previous run's; the old rows stay queryable, so a figure quoted from the old plan is
     * still explainable — the same shape as a spatial dataset version.
     */
    isActive: boolean("is_active").notNull().default(true),
    supersedesRunId: uuid("supersedes_run_id"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("pgas_import_run_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "pgas_import_run_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pgas_import_run_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "pgas_import_run_supersedes_fk",
      columns: [t.tenantId, t.supersedesRunId],
      foreignColumns: [t.tenantId, t.id],
    }),
    index("pgas_import_run_active_idx").on(t.tenantId, t.projectId, t.isActive),
  ],
);

/**
 * One plan of the chapter — *Plan de Manejo de Desechos*, *Plan de Relaciones Comunitarias*, and so
 * on. `code` is nullable because the delivered chapter has nine plans and eight codes.
 */
export const pgasPlan = app.table(
  "pgas_plan",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    importRunId: uuid("import_run_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    /** `PPMI-01` and the rest, as the document writes them. Null where the document gives none. */
    code: text("code"),
    title: text("title").notNull(),
    objective: text("objective"),
    /** *Lugar de aplicación*, where the plan states one. Only one of the nine does. */
    place: text("place"),
    /** The column names this plan actually used, kept so a naming inconsistency can be shown. */
    columnHeadings: text("column_headings").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("pgas_plan_run_ordinal_key").on(t.tenantId, t.importRunId, t.ordinal),
    unique("pgas_plan_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "pgas_plan_run_fk",
      columns: [t.tenantId, t.importRunId],
      foreignColumns: [pgasImportRun.tenantId, pgasImportRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pgas_plan_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One row of a plan's nine-column matrix.
 *
 * Every column is text, and stored as the document states it. `stated_number` is the document's own
 * `N°` — text, not an integer, because it repeats, skips and is sometimes blank, and a number this
 * product cannot rely on should not look like one it can. `measure_code` is the identifier **this
 * product mints** so a measure can be linked to at all (ADR-024 §3); the surface says whose it is.
 */
export const pgasMeasure = app.table(
  "pgas_measure",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    planId: uuid("plan_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    measureCode: text("measure_code").notNull(),
    statedNumber: text("stated_number"),
    /** The banner row a measure sits under; null where the plan has none. */
    programmeTitle: text("programme_title"),
    programmeOrdinal: integer("programme_ordinal").notNull().default(0),
    aspect: text("aspect"),
    impact: text("impact"),
    measure: text("measure"),
    indicator: text("indicator"),
    verification: text("verification"),
    responsible: text("responsible"),
    frequency: text("frequency"),
    deadline: text("deadline"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("pgas_measure_plan_ordinal_key").on(t.tenantId, t.planId, t.ordinal),
    unique("pgas_measure_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "pgas_measure_plan_fk",
      columns: [t.tenantId, t.planId],
      foreignColumns: [pgasPlan.tenantId, pgasPlan.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pgas_measure_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("pgas_measure_project_idx").on(t.tenantId, t.projectId, t.programmeOrdinal, t.ordinal),
  ],
);
