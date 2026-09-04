-- The management plan: grants, row level security, and the invariants the document's own shape
-- justifies (ADR-024). Hand-written because policies and constraints must be reviewed SQL, not
-- inferred from a schema diff (ADR-013).
--
-- Nothing here is append-only and nothing is immutable, and that is deliberate. A plan is a
-- *document being written*: the consultancy revises it, and a revision arrives as a new import run
-- whose rows supersede the previous run's. What must not happen is two active runs claiming to be
-- the project's plan at once, which the partial unique index below prevents.
--
-- What is **not** here is as much the decision as what is. There is no compliance state, no
-- evidence table and no obligation: this chapter proposes measures for a road that has not been
-- built, and a schema that could record "cumplida" would invite the claim (ADR-024 §7).

-------------------------------------------------------------------------------------------------
-- 1. Invariants
-------------------------------------------------------------------------------------------------
ALTER TABLE app.pgas_import_run
  ADD CONSTRAINT pgas_import_run_sha256_shape CHECK (source_sha256 ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE app.pgas_import_run
  ADD CONSTRAINT pgas_import_run_counts_non_negative
  CHECK (plan_count >= 0 AND measure_count >= 0);
--> statement-breakpoint

-- One active run per project. Re-importing the same document is a no-op; a different one supersedes.
CREATE UNIQUE INDEX pgas_import_run_one_active
  ON app.pgas_import_run (tenant_id, project_id) WHERE is_active;
--> statement-breakpoint

-- A plan has a title. Its *code* may be absent, because the delivered chapter has nine plans and
-- eight codes — the ninth is a finding to report, not a row to refuse.
ALTER TABLE app.pgas_plan
  ADD CONSTRAINT pgas_plan_title_present CHECK (length(btrim(title)) > 0);
--> statement-breakpoint
ALTER TABLE app.pgas_plan
  ADD CONSTRAINT pgas_plan_headings_present CHECK (cardinality(column_headings) >= 8);
--> statement-breakpoint

-- The code this product mints, so a measure can be linked to at all. Deliberately distinguishable
-- from the document's own `N°`, which is stored beside it exactly as written — repeats included.
ALTER TABLE app.pgas_measure
  ADD CONSTRAINT pgas_measure_code_shape CHECK (measure_code ~ '^[A-Za-z0-9._-]{3,40}$');
--> statement-breakpoint
CREATE UNIQUE INDEX pgas_measure_code_unique
  ON app.pgas_measure (tenant_id, plan_id, measure_code);
--> statement-breakpoint

-- A row that states nothing at all is a parsing failure, not a measure. Every other emptiness —
-- a missing indicator, a missing responsible party — is allowed and reported on the surface.
ALTER TABLE app.pgas_measure
  ADD CONSTRAINT pgas_measure_not_entirely_empty CHECK (
    coalesce(btrim(aspect), '') <> ''
    OR coalesce(btrim(impact), '') <> ''
    OR coalesce(btrim(measure), '') <> ''
  );
--> statement-breakpoint

-------------------------------------------------------------------------------------------------
-- 2. Grants
-------------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.pgas_import_run, app.pgas_plan, app.pgas_measure
TO eia_app;
--> statement-breakpoint

-------------------------------------------------------------------------------------------------
-- 3. Row Level Security: enable and FORCE
-------------------------------------------------------------------------------------------------
ALTER TABLE app.pgas_import_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.pgas_import_run FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.pgas_plan ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.pgas_plan FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.pgas_measure ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.pgas_measure FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-------------------------------------------------------------------------------------------------
-- 4. Policies. Same predicate for USING and WITH CHECK, so a forged tenant_id or project_id is
--    rejected on write exactly as it is hidden on read. A missing setting reads as NULL, the
--    comparison is NULL, and the row is denied.
-------------------------------------------------------------------------------------------------
CREATE POLICY pgas_import_run_select ON app.pgas_import_run FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY pgas_import_run_write ON app.pgas_import_run FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY pgas_plan_select ON app.pgas_plan FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY pgas_plan_write ON app.pgas_plan FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY pgas_measure_select ON app.pgas_measure FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY pgas_measure_write ON app.pgas_measure FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
