# ADR-015 — `packages/domain` is pure; orchestration lives in `packages/application`

- Status: Accepted (Implementation Gate 0, condition IG0-B02)
- Date: 2026-09-01
- Related: ARCHITECTURE.md §2, ADR-013, TECH_DEBT.md (TD-003, resolved)

## Context

Slice 0 shipped the tenancy use-cases inside `packages/domain`, which therefore imported
`@eia/db` (Drizzle schema, transaction helper). Gate 0 ruled that this must not remain as
foundational debt: the domain must not depend on a persistence adapter.

Two corrections were offered. **Option A**: move the DB-aware orchestration into a thin
`packages/application`, leaving the domain with types, roles, permissions, capability rules and
pure logic. **Option B**: keep the use-cases in the domain and define minimal persistence ports
(`TenancyReader`, `MembershipReader`, `CapabilitySettingsReader`) implemented in `packages/db`.

## Decision

**Option A.** `packages/application` holds the orchestration; `packages/domain` is pure and may
not import `@eia/db`, `@eia/application`, Drizzle, `pg` or `better-auth`.

Why this is the smaller correction here:

1. **It invents no abstraction.** The moved code (`buildRequestContext`, `createTenant`,
   `createProject`, membership and capability writes, `recordAudit`) is orchestration: it opens a
   transaction, sets the RLS context, performs several statements and writes an audit row in the
   same unit of work. Option B would have needed reader ports *plus* a transaction/unit-of-work
   abstraction to express that, or would have pushed whole use-cases into the adapter. That is
   more machinery than moving files, and it is the "repository pattern for architectural
   aesthetics" the gate warned against.
2. **The split follows an existing seam.** `core`, `provenance` and `audit` vocabulary were
   already pure; only `tenancy` was not. The move is a relocation, not a redesign.
3. **It keeps one transaction boundary.** RLS correctness depends on every statement of a
   use-case running in one transaction with `set_config`. Orchestration next to the adapter keeps
   that explicit and reviewable.
4. **The domain becomes testable without Docker** and cannot be made to depend on a database by
   accident.

Layering:

```
apps/web · apps/worker        →  @eia/application  →  @eia/domain   (rules, pure)
                                        ↓
                                    @eia/db        →  PostgreSQL (RLS)
```

- `@eia/domain`: errors, permission catalogue, roles, capability catalogue and resolver, profiles,
  `RequestContext` type, ports (`IdentityPort`, `EmailPort`, `JobQueuePort`, `StoragePort`),
  provenance facets, audit vocabulary and `assertSafeDetails`. Only dependency: `zod`.
- `@eia/application`: `buildRequestContext`, `ensureUser`, `listUserTenants`, tenant/project/
  membership/capability use-cases, capability-settings loaders, `recordAudit`.
- `@eia/db`: Drizzle schema, migrations, RLS context helper, connection factories.

The bounded modules of ARCHITECTURE.md §2 keep their names and responsibilities; a module with
persistence-facing use-cases gets a matching folder under `packages/application` (for example
`application/gis` for the `gis` module) rather than a second module list.

## Enforcement

- ESLint: `domainPurityConfig` forbids the imports inside `packages/domain/**`.
- `packages/domain/test/purity.test.ts`: scans every domain source file for forbidden import
  specifiers, asserts the manifest declares only `zod`, and imports the package with no database
  present. It runs in the unit suite, so the boundary holds even if lint configuration changes.

## Consequences

- One more package to build and version; it is in the Changesets linked set with the apps.
- Domain unit tests need no container; application tests are integration tests.
- Future slices must decide where a use-case belongs: pure rule → domain, anything touching
  persistence → application.

## Alternatives rejected

- Option B (ports in the domain): needs a unit-of-work abstraction to preserve the single
  transaction per use-case, i.e. more invention for the same invariant.
- Leaving the dependency and documenting it: rejected by the gate.
