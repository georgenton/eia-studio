# ADR-010 — Identity provider boundary (Better Auth scope)

- Status: Accepted provisionally at Gate 1 (decision D-016)
- Date: 2026-09-01
- Related: TENANCY.md §3a, SECURITY.md §2, ADR-001, ADR-002, GATE-1.md

## Context

ARCHITECTURE.md §9 recommended Better Auth as the identity layer. Better Auth ships plugins for
organisations, roles, two-factor authentication and SSO. Using its organisation roles as the
authorization model would be convenient but would couple tenant isolation, project-level
permissions, client-portal grants and the capability resolver to a third-party schema and its
upgrade cadence. The Gate 1 reviewer approved Better Auth provisionally and required an explicit
boundary.

## Decision

1. Better Auth is used for **identity, authentication and session management** only:
   credentials, password policy, magic links, TOTP/2FA, session and device management, and
   later SAML/OIDC SSO.
2. **Authorization is an EIA Studio domain concern.** `TenantMembership`, `ProjectMembership`,
   `Role`, `Permission`, `ClientPortalGrant` and the capability resolver live in
   `packages/domain/core` and are the only sources consulted by `requirePermission`,
   `requireCapability`, route guards, jobs and RLS context building.
3. The domain reads exactly one value from the identity layer: the authenticated subject, mapped
   to `User.identity_provider_subject` → `userId`. No organisation, role, tenant or permission
   claim from the identity layer is read for authorization.
4. If Better Auth organisation features are enabled for convenience (invitation emails, SSO
   domain mapping), they are treated as **presentation/onboarding aids**; domain memberships are
   created only by domain use-cases, and any reconciliation job may flag divergences but never
   grants access.
5. The identity layer is replaceable: an `IdentityPort` (`getSessionUser`, `signOut`,
   `requireRecentAuth`) isolates it; authorization tests run with a fake identity provider that
   returns only `userId`.
6. "Provisional" means: Slice 0 validates that Better Auth meets the requirements (Postgres
   adapter compatible with RLS-scoped connections for its own tables in a separate schema
   `auth`, 2FA enforcement per role, session/device listing). If it does not, the port makes the
   swap a contained change and a new ADR records it.

## Consequences

- Two schemas: `auth` (owned by the identity layer, not tenant-scoped, no project data) and the
  domain schemas. The `auth` schema is never joined at request time for authorization.
- Role and membership administration UI (Tenant Settings › Usuarios / Roles) writes domain
  tables, not identity-layer organisations.
- Slight duplication of "user exists" facts (identity subject vs `User` row), reconciled at sign-
  in.

## Slice 0 verification (2026-09-01)

Better Auth 1.7.2 with the Drizzle adapter (`provider: "pg"`) against tables declared with
`pgSchema("auth")` works as required: sign-up, session resolution through `auth.api.getSession`
and the `IdentityPort` bridge were exercised end to end; identity persistence is logically
isolated in the `auth` schema; `auth.user.id` (UUID via `advanced.database.generateId`) is used
as `app.user.id`, so the domain never joins identity tables. No organisation/role plugin is
enabled. Findings recorded as debt: Better Auth 1.7 requires an `issuer` column and a unique
`(issuer, account_id)` index on `account` (migration 0003); its sign-up is not transactional
(a failed account insert left an orphan `auth.user` row — TECH_DEBT.md TD-010). The provisional
approval stands; the port makes replacement a contained change.

## Alternatives rejected

- Using Better Auth organisation roles as the authorization source: couples isolation to a
  vendor schema, cannot express project roles, PII policies, client grants or capability
  dependencies.
- Building authentication in-house: unnecessary security surface for a small team.
