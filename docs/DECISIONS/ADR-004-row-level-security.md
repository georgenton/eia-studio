# ADR-004 — PostgreSQL Row Level Security as the isolation backstop

- Status: Accepted at Gate 1 (no specific conditions raised; see GATE-1.md)
- Date: 2026-09-01
- Related: SECURITY.md §5, TENANCY.md, ADR-001

## Context

Application-level scoping alone fails on the first forgotten predicate. The database must refuse
cross-tenant rows regardless of application bugs, for web requests, background jobs and the
client portal, while remaining compatible with connection pooling and with PostGIS/pgvector
tables.

## Decision

1. **Database roles**: `eia_migrator` (schema owner, migrations only), `eia_app` (workspace and
   worker; `NOBYPASSRLS`), `eia_portal` (portal; USAGE on `portal` schema only), optional
   `eia_readonly` later. The application never connects as a superuser or table owner.
2. **Context via transaction-local settings**: every unit of work runs in a transaction that
   first executes `SET LOCAL app.user_id`, `app.tenant_id`, `app.project_id` (nullable),
   `app.surface`, and `app.pii_access` when granted. The DB access layer is the only code that
   opens transactions and it requires a context object; `SET` without `LOCAL` is forbidden.
3. **Policies on every tenant-owned table** with `ENABLE` + `FORCE ROW LEVEL SECURITY`:
   - `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`;
   - project-scoped tables additionally `AND (project_id = current_setting('app.project_id',
     true)::uuid OR (current_setting('app.project_id', true) IS NULL AND
     has_project_access(tenant_id, project_id)))` where `has_project_access` is a `SECURITY
     DEFINER` function over memberships (for tenant-level listings such as Portfolio);
   - `WITH CHECK` mirrors `USING` for inserts/updates;
   - `pii` schema policies add `current_setting('app.pii_access', true) = 'on'`;
   - `portal` schema policies grant `eia_portal` rows only for `(tenant_id, project_id)` matching
     its own settings, which the portal context sets from the grant.
4. **Missing settings deny**: `current_setting(name, true)` returns NULL when unset; every
   comparison with NULL is false, so a context-less connection sees and writes nothing.
5. **Structural guards** complement RLS: composite FKs `(tenant_id, project_id)`, `tenant_id NOT
   NULL`, immutability triggers on append-only tables (`audit.log`, `ai_classification`,
   `human_review`, published versions).
6. **Migrations** define policies in the same SQL file as the table; a CI schema test fails when a
   table in `app`, `pii`, `vec`, `portal` lacks forced RLS or when a policy references a setting
   the context builder does not set.
7. **Performance**: policies compare indexed columns; every tenant-owned table has a leading
   `(tenant_id, project_id)` index; `has_project_access` is `STABLE` and cached per statement.

## Amendment — Slice 0 implementation (2026-09-01)

- Membership predicates inside policies (`app.is_tenant_member`, `app.is_tenant_admin`,
  `app.is_tenant_owner`, `app.has_project_membership`, `app.has_project_access`,
  `app.can_administer_project`, `app.shares_tenant_with`, `app.tenant_has_no_members`) are
  `SECURITY DEFINER` functions owned by a dedicated `eia_policy` role (`NOLOGIN`, `BYPASSRLS`,
  never granted to any login role). Without this, a policy on `project_membership` that consults
  `project_membership` recurses (PostgreSQL raises "infinite recursion detected in policy").
  The functions take ids as parameters and always read the current user from the
  transaction-local setting; they cannot be invoked to widen access beyond what they encode.
- Two access levels are encoded for D-015: `has_project_access` (explicit membership or OWNER
  implicit access) for project **data** tables, and `can_administer_project` (data access or
  tenant OWNER/ADMIN) for administrative rows (project, memberships, capability settings).
  Future sensitive tables must use `has_project_access`.
- `app.project_id` is a narrowing filter, never a grant: project policies evaluate the membership
  predicate regardless of the setting, so a forged project id yields nothing.
- Context values are set with `set_config(name, value, true)`; empty strings read as NULL via
  `app.setting_uuid`, so missing context denies by construction.
- The runtime login role (name/password from the environment) inherits from the `eia_app` group
  role created in migration 0000; migrations never contain credentials.
- Requirement for hosted databases: the migrator must be allowed to create a `BYPASSRLS` role
  (DEPLOYMENT.md §4).

## Consequences

- Pooling in transaction mode works (settings are `LOCAL`); prepared statements across pooled
  connections must be handled by the driver configuration.
- Tests can prove isolation at the SQL level without the application (TESTING_STRATEGY.md §3).
- Slight per-query overhead from policy evaluation; acceptable at expected volumes.
- Admin/support tooling needs explicit context too; there is no "see everything" connection
  except the migrator, whose use is audited and never wired into the app.
- Analytical queries across tenants (product metrics) require a separate, non-RLS-bypassing
  aggregation job or a read replica role, designed later.

## Alternatives rejected

- Application filtering only (see ADR-001).
- Views per tenant or `SECURITY DEFINER` wrappers as the only guard: policy sprawl and easy to
  bypass with direct table access.
- Session-level `SET` with session pooling: leaks context across requests when a connection is
  reused; explicitly forbidden.
