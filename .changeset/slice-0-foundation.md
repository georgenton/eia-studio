---
"@eia/web": minor
"@eia/worker": minor
"@eia/domain": minor
"@eia/db": minor
"@eia/contracts": minor
"@eia/ui": minor
---

Slice 0 — SaaS foundation: pnpm/Turborepo monorepo on Node 24; validated environment
configuration; PostgreSQL foundation with PostGIS + pgvector verification, least-privilege
roles, forced Row Level Security and deny-by-default context; Better Auth limited to
identity/session behind an `IdentityPort`; tenancy core (tenant, membership, project, project
membership with composite tenant consistency); typed permission catalogue and fixed role
mappings; 14-key capability catalogue with boolean resolver and shell-only presentation;
immutable server-side `RequestContext`; append-only audit foundation; provenance facet
primitives; persistent worker process with graceful shutdown; health endpoints.
