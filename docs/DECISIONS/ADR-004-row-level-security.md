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

## Amendment — privileged helper hardening (Implementation Gate 0, IG0-B01)

Migration `0004_security_definer_hardening.sql` fixes the contract every `SECURITY DEFINER`
helper must satisfy. New helpers must satisfy it too; the integration test
`packages/testing/test/rls/security-definer.integration.test.ts` asserts each point.

| # | Requirement | How it is met |
|---|---|---|
| 1 | Dedicated owner | `eia_policy`, `NOLOGIN`, created in migration 0000 |
| 2 | Owner is not the application runtime | the runtime is a login role in the `eia_app` group; `eia_policy` has no login and no members |
| 3 | Runtime cannot `SET ROLE` to the owner | no membership grant; asserted by test |
| 4 | Explicit, secure `search_path` | `pg_catalog, app, pg_temp` on every function |
| 5 | `pg_temp` last | previously implicit and therefore FIRST; now explicitly last |
| 6 | No untrusted or writable schema on the path | only `pg_catalog` and `app`, both owned by the migrator; the runtime has no `CREATE` on either, nor on `public` |
| 7 | Schema-qualified references | every relation and function in the bodies is `app.…`; asserted by a catalogue test over `pg_proc.prosrc` |
| 8 | No dynamic SQL | all bodies are plain `LANGUAGE sql`; asserted (no `EXECUTE`, `format(`, `quote_ident`) |
| 9 | `EXECUTE` revoked from `PUBLIC` | revoked per function, and the schema default privilege for `PUBLIC` is removed so a future helper is never world-executable |
| 10 | `EXECUTE` granted to the minimum | `eia_app` for all helpers; `eia_policy` additionally on `app.setting_uuid` and `app.current_user_id` only, because the definer bodies call them |
| 11 | Owner owns nothing else | asserted: zero relations and zero schemas owned by `eia_policy` |
| 12 | Runtime cannot disable RLS | not the table owner, `FORCE ROW LEVEL SECURITY`, `row_security = off` refused |
| 13 | Minimum information returned | every helper returns `boolean`; asserted over `pg_proc.prorettype` |

`public` schema: `CREATE` is revoked from `PUBLIC`, `eia_app` and `eia_policy`, so no application
role can create objects that might influence name resolution.

### Threat model (explicit)

RLS and these helpers are a **defence against application authorization bugs, forged tenant or
project context in a request, and accidental cross-tenant access**. A missing predicate, a wrong
`project_id` from a payload or a use-case that forgets a check still cannot cross a tenant
boundary.

They are **not** a defence against arbitrary SQL executed on the runtime connection after a full
SQL-injection compromise of the application. Such an attacker already acts as the runtime role
and may call any helper that role is allowed to call. The hardening limits what that buys them
(booleans only, always evaluated for the user in the transaction-local setting, no dynamic SQL,
no ability to shadow objects, no path to the privileged owner), but the honest boundary is that
SQL injection in the application is a full compromise of that tenant's runtime scope. Preventing
injection remains the application's responsibility: parameterised queries, `strict()` schemas and
the repository predicates.

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
