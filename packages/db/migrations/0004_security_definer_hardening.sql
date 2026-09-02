-- 0004 · hardening of the privileged policy helpers (Implementation Gate 0, IG0-B01).
--
-- Migration 0002 created the membership helpers as SECURITY DEFINER owned by `eia_policy` so that
-- policies on project_membership can query project_membership without infinite recursion. That
-- makes them a privileged security boundary. This migration closes three gaps found at Gate 0:
--
--   1. `search_path` was `app, pg_catalog`, which leaves `pg_temp` implicitly FIRST. A role that
--      can create temporary objects could then shadow an unqualified name inside a definer
--      function. The bodies are fully schema-qualified, but the ordering must not depend on that:
--      the search path becomes `pg_catalog, app, pg_temp` (trusted catalog first, pg_temp last).
--   2. EXECUTE was granted to PUBLIC by default. It is revoked from PUBLIC and granted only to
--      the runtime group role `eia_app`.
--   3. The non-privileged context helpers had no explicit search_path and were executable by
--      PUBLIC; both are fixed for consistency.
--
-- Threat model (documented in ADR-004 and SECURITY.md): RLS plus these helpers protect against
-- application authorization bugs, forged tenant/project context and accidental cross-tenant
-- access. They are NOT a defence against arbitrary SQL executed on the runtime connection after a
-- full SQL-injection compromise: such an attacker already runs as `eia_app` and can call every
-- helper it is allowed to call. The helpers therefore return only booleans, take ids as
-- parameters and always read the acting user from the transaction-local setting.

------------------------------------------------------------------------------------------------
-- 1. Secure search_path: trusted schemas only, pg_temp last
------------------------------------------------------------------------------------------------
ALTER FUNCTION app.is_tenant_member(uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.is_tenant_admin(uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.is_tenant_owner(uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.has_project_membership(uuid, uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.has_project_access(uuid, uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.can_administer_project(uuid, uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.shares_tenant_with(uuid, uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.tenant_has_no_members(uuid) SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
-- Context helpers are INVOKER, but pin them as well so behaviour never depends on the caller.
ALTER FUNCTION app.setting_uuid(text) SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.current_user_id() SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.current_tenant_id() SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.current_project_id() SET search_path = pg_catalog, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION audit.reject_change() SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 2. EXECUTE: never PUBLIC; only the runtime group role
------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.is_tenant_member(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_tenant_admin(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_tenant_owner(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.has_project_membership(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.has_project_access(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.can_administer_project(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.shares_tenant_with(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.tenant_has_no_members(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.setting_uuid(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.current_tenant_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.current_project_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit.reject_change() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_tenant_member(uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_tenant_admin(uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_tenant_owner(uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.has_project_membership(uuid, uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.has_project_access(uuid, uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.can_administer_project(uuid, uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.shares_tenant_with(uuid, uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.tenant_has_no_members(uuid) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.setting_uuid(text) TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_project_id() TO eia_app;
--> statement-breakpoint
-- The privileged owner runs the definer bodies, so it needs EXECUTE on exactly the two context
-- helpers those bodies call (`app.current_user_id` and, transitively, `app.setting_uuid`).
-- It is deliberately NOT granted `current_tenant_id` / `current_project_id`: policies evaluate
-- those as the invoking runtime role, never inside a definer body.
GRANT EXECUTE ON FUNCTION app.setting_uuid(text) TO eia_policy;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO eia_policy;
--> statement-breakpoint
-- Future functions in `app` must be granted deliberately, not by the PUBLIC default. The 0002
-- default privilege that granted EXECUTE to eia_app on new functions is kept; the PUBLIC default
-- is removed so a new helper is never world-executable.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA audit REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 3. `public` schema: no object creation by application roles
--    PostgreSQL 15+ already withholds CREATE from PUBLIC; the statement is idempotent and makes
--    the intent explicit for any database restored from an older dump.
------------------------------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM eia_app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM eia_policy;
