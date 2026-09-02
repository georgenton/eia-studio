---
"@eia/application": minor
"@eia/domain": minor
"@eia/db": minor
"@eia/web": minor
"@eia/worker": minor
---

Implementation Gate 0 hardening. `packages/domain` is now pure: persistence orchestration moved
to the new `@eia/application` package, with the boundary enforced by ESLint and a purity test
(ADR-015). Privileged RLS helper functions are hardened: secure `search_path`
(`pg_catalog, app, pg_temp`), `EXECUTE` revoked from PUBLIC and granted only to the roles that
need it, no `CREATE` on `public` for application roles, plus an abuse-path test suite and an
explicit threat model (ADR-004). Capability resolution semantics fixed: a project override may be
`true` or `false` over its profile default and can never widen past product or tenant, covered by
a truth table (ADR-002, FEATURES.md). Public self-signup is disabled while onboarding lacks an
atomic provisioning path. The PostgreSQL base image is pinned by manifest-list digest, and a
Better Auth schema-compatibility test guards dependency upgrades.
