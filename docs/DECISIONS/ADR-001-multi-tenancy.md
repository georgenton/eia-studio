# ADR-001 — Multi-tenancy model

- Status: Accepted with conditions at Gate 1 (decisions D-015 and D-016 applied)
- Date: 2026-09-01 (amended 2026-09-01 after Gate 1)
- Related: TENANCY.md, SECURITY.md, ADR-004, ADR-009, ADR-010, GATE-1.md

## Context

EIA Studio must be multi-tenant from day one. A tenant is an organisation (a consulting firm)
that owns projects; users belong to tenants through explicit memberships and to projects through
explicit assignments (README domain rules). The bundle requires that membership be explicit and
never derivable by implicit joins, that every record carry `tenant_id` and `project_id`, and that
client access be served from an aggregated projection.

Options for isolation: (a) shared schema with `tenant_id` columns and application filtering only;
(b) shared schema + Row Level Security; (c) schema per tenant; (d) database per tenant.

## Decision

1. **Shared PostgreSQL schema with mandatory `tenant_id` on every tenant-owned table, enforced by
   Row Level Security (ADR-004), plus application-level scoping.** Project-scoped tables also
   carry `project_id`, with a composite foreign key `(tenant_id, project_id) → project` so that a
   row cannot cross tenants even if the application is wrong.
2. **Membership model**: `User` (global) → `TenantMembership` (tenant role, status) →
   `ProjectMembership` (references the tenant membership, project role). A project assignment
   cannot exist without an active tenant membership.
3. **Client users are not project members.** `CLIENT` is not a `ProjectMembership` role;
   external read-only access is represented exclusively by `ClientPortalGrant`, consulted only
   by the portal surface (ADR-009, D-015).
4. **Roles are split by scope** (D-015): tenant roles `OWNER` (organisation-wide control with
   implicit, computed, audited access to all projects), `ADMIN` (tenant/project administration,
   **no** implicit access to sensitive project data; a `ProjectMembership` is required) and
   `MEMBER` (no implicit administrative access); project roles `COORDINATOR`,
   `SOCIAL_SPECIALIST`, `ENVIRONMENTAL_SPECIALIST`, `GIS_SPECIALIST`, `FIELD_TECHNICIAN`,
   `REVIEWER`, `VIEWER`. Permissions are typed keys with a single scope each.
5. **Active context comes from the URL** (`/t/:tenant/p/:project/...`), verified against
   memberships on every request, and carried by an immutable `RequestContext` that every use-case
   requires. Session claims and identity-provider organisation roles are never used for
   authorization (D-016, ADR-010).
6. **Defense in depth**: identity → context → permission → capability → repository predicate →
   RLS → storage prefix → vector RLS → portal projection → audit. Each layer is independently
   tested (TESTING_STRATEGY.md §5).
7. Schema-per-tenant and database-per-tenant are **not** adopted now; a "dedicated database" plan
   remains possible later because no code depends on tenants sharing a database (all access is
   context-scoped).

## Consequences

- Every new table needs `tenant_id`, RLS policies and (if project-scoped) the composite FK;
  registries and CI checks enforce this.
- Migrations and pgvector/PostGIS indexes stay simple (one schema).
- Noisy-neighbour risk exists on a shared database; mitigated by per-tenant job fairness and, if
  needed later, the dedicated-database plan.
- Tenant deletion is a hard operation (cascade across modules and storage prefixes) and must be
  designed as an audited, two-step job before it is offered.
- The prototype's "Usuarios" table shows the client as a membership row; the UI lists grants and
  memberships together, but the models remain distinct.

## Alternatives rejected

- Application filtering only: a single missed predicate leaks data; no backstop.
- Schema per tenant: migration fan-out, extension/index management per schema, harder pooling;
  benefits (blast radius) not needed at expected scale.
- Database per tenant: operational cost, cross-tenant admin queries, unnecessary now.
