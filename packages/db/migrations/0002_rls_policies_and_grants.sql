-- 0002 · context helpers, membership functions, grants, Row Level Security (hand-written).
-- Principles (docs/SECURITY.md §5, ADR-004):
--   * context arrives as transaction-local settings app.user_id / app.tenant_id / app.project_id;
--   * missing settings read as NULL and every predicate then evaluates false → deny by default;
--   * app.tenant_id is only set after the application verified the user's membership, and
--     policies still re-check membership through SECURITY DEFINER helpers owned by eia_policy;
--   * every tenant-owned table has ENABLE + FORCE RLS with USING and WITH CHECK;
--   * the runtime group role eia_app has DML only; DDL stays with the migrator.

------------------------------------------------------------------------------------------------
-- 1. Context helpers (plain SQL, run as the caller)
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.setting_uuid(p_name text) RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting(p_name, true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT app.setting_uuid('app.user_id') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT app.setting_uuid('app.tenant_id') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_project_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT app.setting_uuid('app.project_id') $$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 2. Membership helpers (SECURITY DEFINER, owner eia_policy → bypass RLS only inside)
--    They never take the user as a parameter: the user always comes from the transaction setting.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.is_tenant_member(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.tenant_membership m
    WHERE m.tenant_id = p_tenant AND m.user_id = app.current_user_id() AND m.status = 'active'
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_tenant_admin(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.tenant_membership m
    WHERE m.tenant_id = p_tenant AND m.user_id = app.current_user_id() AND m.status = 'active'
      AND m.role IN ('OWNER', 'ADMIN')
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_tenant_owner(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.tenant_membership m
    WHERE m.tenant_id = p_tenant AND m.user_id = app.current_user_id() AND m.status = 'active'
      AND m.role = 'OWNER'
  )
$$;
--> statement-breakpoint
-- Explicit project membership through an active tenant membership.
CREATE OR REPLACE FUNCTION app.has_project_membership(p_tenant uuid, p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.project_membership pm
    JOIN app.tenant_membership tm ON tm.id = pm.tenant_membership_id AND tm.tenant_id = pm.tenant_id
    WHERE pm.tenant_id = p_tenant AND pm.project_id = p_project
      AND pm.status = 'active' AND tm.status = 'active'
      AND tm.user_id = app.current_user_id()
  )
$$;
--> statement-breakpoint
-- Project DATA access (D-015): explicit membership, or OWNER implicit access. ADMIN is NOT here:
-- future sensitive tables (parcels, surveys, PII, social, quality, documents) must use this
-- function, never is_tenant_admin.
CREATE OR REPLACE FUNCTION app.has_project_access(p_tenant uuid, p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT app.has_project_membership(p_tenant, p_project) OR app.is_tenant_owner(p_tenant)
$$;
--> statement-breakpoint
-- Project ADMINISTRATION visibility (project row, memberships, capability settings):
-- data access OR tenant OWNER/ADMIN.
CREATE OR REPLACE FUNCTION app.can_administer_project(p_tenant uuid, p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT app.has_project_access(p_tenant, p_project) OR app.is_tenant_admin(p_tenant)
$$;
--> statement-breakpoint
-- Membership of the current user in the tenant of another user (for listing teammates).
CREATE OR REPLACE FUNCTION app.shares_tenant_with(p_user uuid, p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT app.is_tenant_member(p_tenant) AND EXISTS (
    SELECT 1 FROM app.tenant_membership m WHERE m.tenant_id = p_tenant AND m.user_id = p_user
  )
$$;
--> statement-breakpoint
-- Tenant creation bootstrap: the very first membership may be inserted by its own user.
CREATE OR REPLACE FUNCTION app.tenant_has_no_members(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT NOT EXISTS (SELECT 1 FROM app.tenant_membership m WHERE m.tenant_id = p_tenant)
$$;
--> statement-breakpoint
ALTER FUNCTION app.is_tenant_member(uuid) OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.is_tenant_admin(uuid) OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.is_tenant_owner(uuid) OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.has_project_membership(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.has_project_access(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.can_administer_project(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.shares_tenant_with(uuid, uuid) OWNER TO eia_policy;
--> statement-breakpoint
ALTER FUNCTION app.tenant_has_no_members(uuid) OWNER TO eia_policy;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO eia_policy;
--> statement-breakpoint
GRANT SELECT ON app.tenant_membership, app.project_membership TO eia_policy;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 3. Grants for the runtime group role (DML only; no DDL, no DELETE on tenants/users/audit)
------------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app, auth, audit TO eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app."user", app.tenant, app.tenant_membership, app.project TO eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.project_membership, app.tenant_capability, app.project_capability_setting TO eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO eia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit.log TO eia_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO eia_app;
--> statement-breakpoint
-- Future tables created by the migrator in these schemas get the same DML grants automatically;
-- RLS on them is still mandatory (CI schema test).
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eia_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eia_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO eia_app;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 4. Row Level Security — enable and FORCE (owners are not exempt)
------------------------------------------------------------------------------------------------
ALTER TABLE app."user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app."user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tenant FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tenant_membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tenant_membership FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.project ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.project FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.project_membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.project_membership FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tenant_capability ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tenant_capability FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.project_capability_setting ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.project_capability_setting FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit.log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit.log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- app.user: a user sees themself; within a tenant context, teammates of that tenant.
CREATE POLICY user_select ON app."user" FOR SELECT USING (
  id = app.current_user_id()
  OR (app.current_tenant_id() IS NOT NULL AND app.shares_tenant_with(id, app.current_tenant_id()))
);
--> statement-breakpoint
CREATE POLICY user_insert ON app."user" FOR INSERT WITH CHECK (id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY user_update ON app."user" FOR UPDATE
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());
--> statement-breakpoint

-- app.tenant: visible through membership (or as the active, verified tenant); created with the
-- pre-assigned id as context; updated by tenant admins.
CREATE POLICY tenant_select ON app.tenant FOR SELECT USING (
  app.is_tenant_member(id) OR id = app.current_tenant_id() AND app.is_tenant_member(id)
);
--> statement-breakpoint
CREATE POLICY tenant_insert ON app.tenant FOR INSERT WITH CHECK (id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_update ON app.tenant FOR UPDATE
  USING (id = app.current_tenant_id() AND app.is_tenant_admin(id))
  WITH CHECK (id = app.current_tenant_id() AND app.is_tenant_admin(id));
--> statement-breakpoint

-- app.tenant_membership: own rows anywhere; all rows of the active tenant for its members.
CREATE POLICY tenant_membership_select ON app.tenant_membership FOR SELECT USING (
  user_id = app.current_user_id()
  OR (tenant_id = app.current_tenant_id() AND app.is_tenant_member(tenant_id))
);
--> statement-breakpoint
CREATE POLICY tenant_membership_insert ON app.tenant_membership FOR INSERT WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (
    app.is_tenant_admin(tenant_id)
    OR (user_id = app.current_user_id() AND role = 'OWNER' AND app.tenant_has_no_members(tenant_id))
  )
);
--> statement-breakpoint
CREATE POLICY tenant_membership_update ON app.tenant_membership FOR UPDATE
  USING (tenant_id = app.current_tenant_id() AND app.is_tenant_admin(tenant_id))
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_tenant_admin(tenant_id));
--> statement-breakpoint

-- app.project: rows of the active tenant, narrowed to the active project when one is set, and
-- only for users who can administer or access that project. A forged app.project_id never widens
-- access because the membership predicate is evaluated regardless.
CREATE POLICY project_select ON app.project FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR id = app.current_project_id())
  AND app.can_administer_project(tenant_id, id)
);
--> statement-breakpoint
CREATE POLICY project_insert ON app.project FOR INSERT WITH CHECK (
  tenant_id = app.current_tenant_id() AND app.is_tenant_admin(tenant_id)
);
--> statement-breakpoint
CREATE POLICY project_update ON app.project FOR UPDATE
  USING (tenant_id = app.current_tenant_id() AND (app.current_project_id() IS NULL OR id = app.current_project_id())
         AND app.can_administer_project(tenant_id, id))
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.can_administer_project(tenant_id, id));
--> statement-breakpoint

-- app.project_membership (project-scoped): same predicate shape as project.
CREATE POLICY project_membership_select ON app.project_membership FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.can_administer_project(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY project_membership_write ON app.project_membership FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.can_administer_project(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.can_administer_project(tenant_id, project_id)
);
--> statement-breakpoint

-- app.tenant_capability: readable by tenant members; written by tenant admins (incl. bootstrap).
CREATE POLICY tenant_capability_select ON app.tenant_capability FOR SELECT USING (
  tenant_id = app.current_tenant_id() AND app.is_tenant_member(tenant_id)
);
--> statement-breakpoint
CREATE POLICY tenant_capability_write ON app.tenant_capability FOR ALL
  USING (tenant_id = app.current_tenant_id() AND app.is_tenant_admin(tenant_id))
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_tenant_admin(tenant_id));
--> statement-breakpoint

-- app.project_capability_setting (project-scoped).
CREATE POLICY project_capability_setting_select ON app.project_capability_setting FOR SELECT USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.can_administer_project(tenant_id, project_id)
);
--> statement-breakpoint
CREATE POLICY project_capability_setting_write ON app.project_capability_setting FOR ALL USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.can_administer_project(tenant_id, project_id)
) WITH CHECK (
  tenant_id = app.current_tenant_id()
  AND (app.current_project_id() IS NULL OR project_id = app.current_project_id())
  AND app.can_administer_project(tenant_id, project_id)
);
--> statement-breakpoint

-- audit.log: append-only; readable by tenant admins (audit.read); writable within the tenant.
CREATE POLICY audit_log_select ON audit.log FOR SELECT USING (
  tenant_id = app.current_tenant_id() AND app.is_tenant_admin(tenant_id)
);
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit.log FOR INSERT WITH CHECK (
  tenant_id = app.current_tenant_id() AND app.is_tenant_member(tenant_id)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit.reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.log is append-only';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit.log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
