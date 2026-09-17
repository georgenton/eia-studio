-- Object storage: grants, row level security, and the rule that a stored object is described once
-- (Production V1 Wave 2, ADR-031). Hand-written, because policies and grants are reviewed SQL
-- (ADR-013).
--
-- Three things this file protects.
--
-- 1. **An object belongs to a project, and the database says so as well as the key does.** The key
--    carries the tenant and project, and the application refuses a key from outside its scope —
--    but nothing in PostgreSQL knows what a bucket key means, so the row takes the ordinary
--    tenant/project/access predicate like every other project-scoped table. Two checks, one
--    failure is still safe.
--
-- 2. **An intent is consumed, never rewritten.** It may move `ISSUED → FINALIZED` or
--    `ISSUED → ABANDONED` exactly once, and nothing else about it may change. An intent whose
--    declared size or key could be edited after issue would be an authorisation that could be
--    widened after it was granted.
--
-- 3. **A stored object's description is written once.** Its key, size, hash and type are what the
--    provider had when finalize looked; a row that could be updated would let a later caller say a
--    different file is the one that was uploaded, and every citation of it would still resolve.

-- ---------------------------------------------------------------------------------------------
-- 1 · grants
-- ---------------------------------------------------------------------------------------------
-- The REVOKE is required, not decorative: migration 0002 set `ALTER DEFAULT PRIVILEGES IN SCHEMA
-- app GRANT ... UPDATE, DELETE`, so a narrower GRANT beside it changes nothing (migration 0019).
GRANT SELECT, INSERT, UPDATE ON app.upload_intent TO eia_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.upload_intent FROM eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.stored_object TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.stored_object FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.upload_intent ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.upload_intent FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY upload_intent_select ON app.upload_intent FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY upload_intent_insert ON app.upload_intent FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND issued_by_user_id = app.current_user_id());
--> statement-breakpoint
-- Consuming an intent is an update, and it may only be done by somebody the row is already
-- visible to; the trigger below decides *what* may change.
CREATE POLICY upload_intent_update ON app.upload_intent FOR UPDATE TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id))
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

ALTER TABLE app.stored_object ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.stored_object FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY stored_object_select ON app.stored_object FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY stored_object_insert ON app.stored_object FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id)
         AND uploaded_by_user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · an intent is consumed once, and nothing else about it moves
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.assert_upload_intent_consumed_once() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  IF OLD.state <> 'ISSUED' THEN
    RAISE EXCEPTION
      'upload_intent_consumed: this upload was already %; a retry reads the result it produced '
      'and never issues a second one', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.namespace <> OLD.namespace
     OR NEW.object_key <> OLD.object_key
     OR NEW.declared_filename <> OLD.declared_filename
     OR NEW.declared_mime_type <> OLD.declared_mime_type
     OR NEW.declared_size_bytes <> OLD.declared_size_bytes
     OR NEW.max_bytes <> OLD.max_bytes
     OR NEW.issued_by_user_id <> OLD.issued_by_user_id
     OR NEW.issued_at <> OLD.issued_at
     OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION
      'upload_intent_immutable: an upload intent is an authorisation, and an authorisation is not '
      'widened after it is granted; only its state and the moment it was consumed may change'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.assert_upload_intent_consumed_once() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER upload_intent_consumed_once BEFORE UPDATE ON app.upload_intent
  FOR EACH ROW EXECUTE FUNCTION app.assert_upload_intent_consumed_once();
--> statement-breakpoint
ALTER FUNCTION app.assert_upload_intent_consumed_once() OWNER TO eia_policy;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4 · a stored object is described once
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.stored_object_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'stored_object_immutable: this row is what the provider actually held when the '
                  'upload was finalized; a corrected file is a new object and a new version';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stored_object_no_update BEFORE UPDATE ON app.stored_object
  FOR EACH ROW EXECUTE FUNCTION app.stored_object_immutable();
--> statement-breakpoint
-- DELETE only through the cascade from its project, which is how a project is removed wholesale.
CREATE TRIGGER stored_object_no_delete BEFORE DELETE ON app.stored_object
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION app.stored_object_immutable();
--> statement-breakpoint
ALTER FUNCTION app.stored_object_immutable() OWNER TO eia_policy;
