# ADR-012 — Deployment topology: Vercel for the web app, Railway for the persistent worker and database

- Status: Accepted for staging (delivery alignment after Gate 1); production hosting confirmed at the production-readiness gate
- Date: 2026-09-01
- Related: DEPLOYMENT.md, ARCHITECTURE.md §6 and §9.1, GATE-1.md (D-017)

## Context

Gate 1 (D-017) deferred the hosting decision, required the architecture to stay portable and
the worker to be a persistent process. The delivery review now fixes a target topology for
staging so that Slice 0 can wire Git integrations, environment variables and CI. Constraints:
one developer, low operational budget, PostGIS and pgvector required, long-running jobs, no
Kubernetes, no microservices, no duplicate deployments.

## Decision

1. **`apps/web` on Vercel** via Git integration: preview per PR/branch, staging from `main`.
   Production is a separate Vercel project created later and promoted manually.
2. **`apps/worker` on Railway** as a persistent service in a persistent **staging** environment,
   deployed from `main` via Git integration, with `railway.toml` as configuration as code
   (added when the worker exists, not before). Database migrations run as the worker's
   pre-deploy command with the migrator role.
3. **PostgreSQL with PostGIS + pgvector on Railway initially**, conditional on the database
   evaluation in DEPLOYMENT.md §4 (extensions, roles, RLS, pooling mode, backups, residency).
   If it fails, a managed Postgres with the same extensions replaces it with no application
   change.
4. **Object storage stays behind the S3-compatible `StoragePort`**; the concrete bucket
   provider is chosen at Slice 0 by cost and region, not by code.
5. **No duplicate web deployment** on Railway. A second copy requires a documented reason; the
   preferred remedy for any serverless limit is to move the work into the worker.
6. **No separate API service.** The web app accesses the database directly with the RLS-scoped
   role and enqueues jobs transactionally; the worker consumes them. Redis, an event bus,
   Kubernetes and a full observability vendor stack are explicitly not introduced; each would
   need a demonstrated requirement and its own ADR.
7. **Environments**: local, CI/test, PR preview (Vercel; Railway PR environment only when
   backend changes materially need it), persistent staging, production later. Production
   deployment is manual and explicit until the production-readiness gate.

## Consequences

- Two provider consoles to manage; both use Git integration so CI stays free of deploy secrets
  at first.
- Vercel serverless limits apply to `apps/web`; the architecture already forbids long work in
  HTTP requests, so this is a design constraint, not a risk.
- Preview environments need a data strategy: a shared demo-seeded preview database, never
  staging data.
- Portability (ADR/D-017) is preserved: both apps build to containers; Vercel is a convenience,
  not a dependency.

## Alternatives rejected

- Everything on Vercel: no persistent worker.
- Everything on Railway (web + worker + db): viable and simpler in one console, but loses
  Vercel's PR previews and Next.js optimisations; kept as the documented fallback if Vercel
  proves unnecessary or limiting.
- Kubernetes / self-managed VMs: operational burden with no benefit at this scale.
