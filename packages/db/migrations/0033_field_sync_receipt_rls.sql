-- The sync receipt: grants, row level security, and the rule that a receipt is written once
-- (Production V1, Wave 1). Hand-written, because policies and grants are reviewed SQL (ADR-013).
--
-- Three things this file protects.
--
-- 1. **A receipt is the answer to a command, and the answer does not change.** If a receipt could
--    be rewritten, a retried command could be made to produce a different outcome than the first
--    time — which is the exact property the table exists to provide.
--
-- 2. **A technician sees only their own receipts.** The row-level predicate is the ordinary
--    tenant/project/access one *plus* `user_id = app.current_user_id()`. A receipt names what a
--    named person's device did; it takes the same door the field rows it describes take, and a
--    technician holds neither `field.read` nor `field.responses.read`.
--
-- 3. **A forged tenant or project cannot be written.** `WITH CHECK` repeats the predicate, so a
--    device that sent a project it is not on is refused by the database and not only by the
--    application.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
-- Written once, read on every retry. The REVOKE is required, not decorative: migration 0002 set
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ... UPDATE, DELETE`, so a narrower GRANT beside it
-- changes nothing (the lesson of migration 0019).
GRANT SELECT, INSERT ON app.field_sync_receipt TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.field_sync_receipt FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.field_sync_receipt ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.field_sync_receipt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY field_sync_receipt_select ON app.field_sync_receipt FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY field_sync_receipt_insert ON app.field_sync_receipt FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · a receipt is written once
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.field_sync_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'field_sync_receipt_immutable: a receipt records what one command produced; a '
                  'retry replays it and never rewrites it';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER field_sync_receipt_no_update BEFORE UPDATE ON app.field_sync_receipt
  FOR EACH ROW EXECUTE FUNCTION app.field_sync_receipt_immutable();
--> statement-breakpoint
-- DELETE only through the cascade from its project, which is how a project is removed wholesale.
CREATE TRIGGER field_sync_receipt_no_delete BEFORE DELETE ON app.field_sync_receipt
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION app.field_sync_receipt_immutable();
--> statement-breakpoint
ALTER FUNCTION app.field_sync_receipt_immutable() OWNER TO eia_policy;
