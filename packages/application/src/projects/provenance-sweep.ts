import { sql, type SQL } from "drizzle-orm";

/**
 * Which provenance-bearing tables the demo seeder's orphan sweep must account for (TD-125).
 *
 * The seeder reloads a project idempotently. Provenance records carry **derived** ids, so a re-run
 * updates them in place; what the sweep removes is the leftovers of an older run that still minted
 * random ones. Deciding what is a leftover means asking every table that can reference a
 * `provenance_record` whether it still does — and the chain of `not exists` subqueries that asks is
 * only as complete as the list it was written from.
 *
 * It was written by hand and fell eleven tables behind the schema. The failure that surfaced it is
 * the loud one the seeder's own comment predicted: a local database that had ever run
 * `e2e/document-review.spec.ts` could not be re-seeded at all, because the sweep tried to delete a
 * record `document_review_run` and `report_template_version` still pointed at, and those rows
 * cannot be deleted either — a review candidate is append-only by trigger (ADR-035). The only way
 * out was `pnpm db:reset:local`. CI never saw it, because its database is new every run.
 *
 * So the list lives here instead of inside the query, the query is **generated** from it, and
 * `provenance-sweep-registry.integration.test.ts` compares it against the catalogue. Drift between
 * the enumeration and the SQL is no longer possible, and drift between the enumeration and the
 * schema fails a test the next time somebody adds a table.
 */
export interface ProvenanceBearingTable {
  /** Unqualified table name in the `app` schema. */
  readonly table: string;
  /** Why this table is where it is. Read by the registry test's failure message. */
  readonly note: string;
}

/**
 * Tables that still hold rows when the sweep runs, so a record one of them references must survive.
 *
 * Three kinds are mixed here on purpose, because the sweep cannot tell them apart and does not need
 * to: rows the seeder never touches (a published questionnaire, a submitted response), rows it
 * deletes and rebuilds *after* the sweep against the same derived record (the GIS import's layers),
 * and rows no fixture writes at all but an e2e run does (document review, templates, field media).
 */
export const SWEEP_PROTECTED_TABLES: ReadonlyArray<ProvenanceBearingTable> = [
  // Field (Slice 3). A campaign, its published questionnaire and anything captured against them are
  // reused across runs rather than recreated (ADR-026), so their records are always live.
  { table: "survey_campaign", note: "campaign identity is derived and reused across re-seeds" },
  { table: "survey_version", note: "a published questionnaire is immutable (ADR-006)" },
  { table: "field_assignment", note: "assignments carrying submitted responses are never deleted" },
  { table: "field_visit", note: "a visit is history" },
  { table: "survey_instance", note: "answers are immutable after submission (invariant 9)" },
  // GIS (Slice 2) and the influence areas (Slice 8). Deleted and rebuilt later in this same
  // transaction, against the same derived record — so the record must outlive the sweep.
  { table: "spatial_dataset_version", note: "rebuilt by the GIS import after the sweep" },
  { table: "parcel", note: "rebuilt by the GIS import after the sweep" },
  { table: "parcel_geometry", note: "rebuilt by the GIS import after the sweep" },
  { table: "affectation", note: "rebuilt by the GIS import after the sweep" },
  { table: "alignment", note: "rebuilt by the GIS import after the sweep" },
  { table: "influence_area", note: "rebuilt by the GIS import after the sweep" },
  // Social (Slice 4).
  { table: "taxonomy_version", note: "a published taxonomy version is immutable (ADR-019)" },
  { table: "classification_run", note: "a run is history" },
  { table: "ai_classification", note: "insert-only (invariant 8)" },
  { table: "human_review", note: "append-only; a validated coding is never rewritten" },
  // Quality Gate (Slice 5).
  { table: "document_assertion", note: "evidence read by hand from the corpus" },
  { table: "quality_run", note: "a run is history" },
  { table: "quality_finding", note: "decided findings reconcile across runs (ADR-020)" },
  // Documents (Slice 6).
  { table: "document_version", note: "an ingested version is immutable" },
  // Reports (Slice 7).
  { table: "report_version", note: "a generated version records how it was produced (ADR-022)" },
  // The management plan (ADR-024): a superseded import run keeps its provenance, because a figure
  // quoted from last month's plan must still be explainable.
  { table: "pgas_import_run", note: "a superseded import keeps its provenance (ADR-024)" },
  // Wave 3. No fixture writes any of these four; an e2e run writes all of them, which is exactly
  // why they were missed — and why the re-seed failed only on a developer's machine.
  {
    table: "document_review_run",
    note: "written by an AI review run, never by a fixture (ADR-035)",
  },
  {
    table: "document_review_candidate",
    note: "append-only by trigger, so it cannot be cleared either (ADR-035)",
  },
  { table: "report_template_version", note: "an activated template version is frozen (ADR-036)" },
  { table: "generated_document", note: "a rendered draft is a record of what was printed" },
  // Field media (ADR-032): a photograph is evidence of a visit, and the visit is history.
  { table: "field_media", note: "written once; what a photograph is of was stated at the shutter" },
];

/**
 * Tables the seeder **empties before** the sweep, which is why they carry no clause.
 *
 * Listing them would state a protection that does not exist: the rows are already gone, so the
 * subquery would never match. It would also be the dangerous direction to be wrong in. If one of
 * these deletes ever moved to after the sweep, a missing clause fails the re-seed on a foreign key
 * — loud, and fixed in a minute — while a present one would quietly keep stale records alive and
 * leave the orphans this sweep exists to remove. So the absence is deliberate, and recorded.
 */
export const CLEARED_BEFORE_SWEEP_TABLES: ReadonlyArray<ProvenanceBearingTable> = [
  { table: "metric_snapshot", note: "deleted immediately before the sweep" },
  { table: "forecast_snapshot", note: "deleted immediately before the sweep" },
  { table: "attention_item", note: "deleted immediately before the sweep" },
  { table: "activity_event", note: "deleted immediately before the sweep" },
  {
    table: "provenance_input",
    note: "deleted immediately before the sweep; the one table referencing provenance_record twice",
  },
];

/** Every provenance-bearing table this seeder has an answer for. */
export const PROVENANCE_BEARING_TABLES: ReadonlyArray<ProvenanceBearingTable> = [
  ...SWEEP_PROTECTED_TABLES,
  ...CLEARED_BEFORE_SWEEP_TABLES,
];

/**
 * Delete this project's provenance records that nothing references any more.
 *
 * Generated from `SWEEP_PROTECTED_TABLES` rather than written out, so the enumeration the registry
 * test checks is the enumeration the database executes.
 */
export function orphanProvenanceSweep(projectId: string): SQL {
  const clauses = SWEEP_PROTECTED_TABLES.map(
    ({ table }) =>
      sql` and not exists (select 1 from app.${sql.identifier(table)} r where r.provenance_id = pr.id)`,
  );
  return sql`delete from app.provenance_record pr where pr.project_id = ${projectId}${sql.join(clauses, sql``)}`;
}
