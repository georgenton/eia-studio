# ADR-013 — Drizzle ORM as the single data-access layer for PostgreSQL advanced features

- Status: Accepted (delivery alignment after Gate 1; confirms ARCHITECTURE.md §9)
- Date: 2026-09-01
- Related: ARCHITECTURE.md §5 and §9, ADR-004 (RLS), ADR-005 (provenance), SECURITY.md §5

## Context

EIA Studio depends on PostgreSQL features that ORMs abstract poorly: Row Level Security with
transaction-local settings, PostGIS geometry columns and spatial indexes, pgvector columns and
HNSW indexes, `SECURITY DEFINER` functions, immutability triggers, `FORCE ROW LEVEL SECURITY`
policies written as reviewed SQL, multiple database roles. The delivery review asked whether to
add Prisma alongside Drizzle for developer ergonomics.

## Decision

1. **Drizzle ORM is the only ORM/query layer.** Prisma is **not** introduced alongside it: a
   dual access layer would duplicate schema definitions, split migration history, and Prisma's
   engine model complicates per-transaction `SET LOCAL` and PostGIS/pgvector column types.
2. **Schema in Drizzle, policies in SQL.** Tables, columns, indexes and FKs are declared in
   Drizzle schema files per module; RLS policies, roles, grants, functions, triggers, PostGIS and
   pgvector indexes are hand-written SQL migrations in the same ordered migration folder.
   `drizzle-kit generate` produces table migrations; hand-written SQL files are added next to
   them; one runner applies all in order. `drizzle-kit check` guards against drift.
3. **Custom column types** for `geometry(…, 4326)` and `vector(n)` are defined once in
   `packages/db` with typed helpers (`ST_AsGeoJSON`, `ST_Transform` to the project CRS,
   `<=>` distance) exposed as Drizzle `sql` fragments; raw SQL is allowed inside `packages/db`
   and module repositories, never in `apps/*`.
4. **Transaction-per-unit-of-work** helper in `packages/db`: `withContext(ctx, fn)` opens a
   transaction, executes `SET LOCAL app.*` from the context, runs `fn(tx)`, and is the only way
   to obtain a query handle; there is no module-level shared client for domain code.
5. **Three connection configurations** (`eia_app`, `eia_migrator`, `eia_portal`) built from
   separate environment variables; the migrator connection exists only in the migration
   runner process.
6. **Testing**: policy and extension behaviour is tested against real PostgreSQL (Testcontainers
   with PostGIS + pgvector), never against mocks.

## Consequences

- Developers write some SQL; that is intended for the security-relevant parts.
- Drizzle's relational query API is used where convenient, but read models that need PostGIS or
  window functions use `sql` fragments; both are typed at the boundary with zod.
- Prisma-style features (nested writes, generated client for the browser) are not available;
  none is needed for a server-side modular monolith.
- Future migration to another query builder would touch `packages/db` and repositories only.

## Alternatives rejected

- Prisma alongside Drizzle: two schemas, two migration histories, RLS friction.
- Prisma alone: PostGIS/pgvector unsupported natively; `SET LOCAL` requires interactive
  transactions with caveats; policies would still be raw SQL outside its model.
- Kysely alone: no schema/migration tooling; Drizzle offers the same SQL-closeness with tooling.
