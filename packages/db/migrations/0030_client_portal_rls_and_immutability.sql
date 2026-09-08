-- The client portal's projection: grants, row level security, and the immutability that makes a
-- publication mean something (ADR-009, ADR-027). Hand-written, because policies, triggers and
-- grants are reviewed SQL rather than a schema diff (ADR-013).
--
-- Three things this file protects.
--
-- 1. **A publication never changes.** A client was told something on a date. Editing that row in
--    place would rewrite what the firm said, retroactively, with nothing recording that it had.
--    A new statement is a new sequence.
--
-- 2. **The projection is still tenant data.** It is not public, it is not shared, and it is not
--    outside the isolation model just because it is destined for somebody outside the firm. It
--    takes the same tenant/project predicate as everything else, plus project access.
--
-- 3. **`eia_portal` gets nothing.** There is no external client session yet, so there is no caller
--    for that role. A role granted SELECT so it can be called "implemented" is surface with no
--    user behind it. It stays unable to read this table until `ClientPortalGrant` and the portal
--    session exist, and the seam is documented rather than half-built (TD-005).

-- ---------------------------------------------------------------------------------------------
-- 1 · schema usage and grants
-- ---------------------------------------------------------------------------------------------
-- `portal` was created by the table migration; the runtime role needs USAGE on it explicitly,
-- because the default privileges of migration 0002 cover the `app` schema only.
GRANT USAGE ON SCHEMA portal TO eia_app;
--> statement-breakpoint
-- Written once, read forever. There is no ALTER DEFAULT PRIVILEGES on this schema, so the GRANT
-- below is the whole privilege set; the REVOKE beside it is defence against a later default.
GRANT SELECT, INSERT ON portal.client_publication TO eia_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON portal.client_publication FROM eia_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2 · row level security
-- ---------------------------------------------------------------------------------------------
ALTER TABLE portal.client_publication ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal.client_publication FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY client_publication_select ON portal.client_publication FOR SELECT TO eia_app
  USING (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint
CREATE POLICY client_publication_insert ON portal.client_publication FOR INSERT TO eia_app
  WITH CHECK (tenant_id = app.current_tenant_id()
         AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
         AND app.has_project_access(tenant_id, project_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3 · a publication is written once
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION portal.client_publication_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, portal, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'client_publication_immutable: a publication states what the consultancy told '
                  'the client on the day it was published; publish a new version instead of '
                  'editing this one';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER client_publication_no_update BEFORE UPDATE ON portal.client_publication
  FOR EACH ROW EXECUTE FUNCTION portal.client_publication_immutable();
--> statement-breakpoint
-- DELETE only through the cascade from its project, which is how a project is removed wholesale.
CREATE TRIGGER client_publication_no_delete BEFORE DELETE ON portal.client_publication
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION portal.client_publication_immutable();
--> statement-breakpoint
ALTER FUNCTION portal.client_publication_immutable() OWNER TO eia_policy;
