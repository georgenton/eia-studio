-- 0006 · Row Level Security, grants and integrity constraints for the Slice 1 tables
-- (hand-written; ADR-013 keeps policies in reviewed SQL rather than generated diffs).
--
-- These five tables hold project DATA, so their policies use app.has_project_access — explicit
-- project membership or OWNER implicit access (D-015). They deliberately do NOT use
-- app.can_administer_project: a tenant ADMIN without a ProjectMembership administers the project
-- but must not read its operational data. The Portfolio reads them at tenant scope, which is why
-- every policy allows a NULL app.project_id and still re-checks access per row.

------------------------------------------------------------------------------------------------
-- 1. Integrity constraints the type system cannot express
------------------------------------------------------------------------------------------------
-- `cardinality` (not `array_length`) because array_length('{}', 1) is NULL, and a CHECK that
-- evaluates to NULL is satisfied: an empty transformations array would have slipped through.
ALTER TABLE app.provenance_record
  ADD CONSTRAINT provenance_record_transformations_not_empty
  CHECK (cardinality(transformations) >= 1);
--> statement-breakpoint
-- A metric is a number or a calendar date, never both and never neither.
ALTER TABLE app.metric_snapshot
  ADD CONSTRAINT metric_snapshot_single_value
  CHECK (num_nonnulls(numeric_value, date_value) = 1);
--> statement-breakpoint
ALTER TABLE app.forecast_snapshot
  ADD CONSTRAINT forecast_snapshot_window_positive CHECK (window_days >= 1);
--> statement-breakpoint
ALTER TABLE app.forecast_snapshot
  ADD CONSTRAINT forecast_snapshot_series_not_empty CHECK (cardinality(daily_completions) >= 1);
--> statement-breakpoint
ALTER TABLE app.forecast_snapshot
  ADD CONSTRAINT forecast_snapshot_pending_non_negative CHECK (pending >= 0);
--> statement-breakpoint
-- Lineage is a DAG edge, never a self-loop.
ALTER TABLE app.provenance_input
  ADD CONSTRAINT provenance_input_no_self_edge CHECK (provenance_id <> input_provenance_id);
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 2. Grants (explicit; ALTER DEFAULT PRIVILEGES from 0002 also covers these, we state them)
------------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.provenance_record, app.provenance_input, app.metric_snapshot,
  app.forecast_snapshot, app.attention_item, app.activity_event
TO eia_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 3. Row Level Security: enable and FORCE (owners are not exempt)
------------------------------------------------------------------------------------------------
ALTER TABLE app.provenance_record ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.provenance_record FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.provenance_input ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.provenance_input FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.metric_snapshot ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.metric_snapshot FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.forecast_snapshot ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.forecast_snapshot FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.attention_item ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.attention_item FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.activity_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.activity_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 4. Policies. Same predicate for USING and WITH CHECK so a forged tenant_id or project_id is
--    rejected on write exactly as it is hidden on read. A missing setting reads as NULL, the
--    comparison is NULL, and the row is denied.
------------------------------------------------------------------------------------------------
CREATE POLICY provenance_record_select ON app.provenance_record FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY provenance_record_write ON app.provenance_record FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY provenance_input_select ON app.provenance_input FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY provenance_input_write ON app.provenance_input FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY metric_snapshot_select ON app.metric_snapshot FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY metric_snapshot_write ON app.metric_snapshot FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY forecast_snapshot_select ON app.forecast_snapshot FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY forecast_snapshot_write ON app.forecast_snapshot FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY attention_item_select ON app.attention_item FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY attention_item_write ON app.attention_item FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY activity_event_select ON app.activity_event FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY activity_event_write ON app.activity_event FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.has_project_access(tenant_id, project_id)
);
