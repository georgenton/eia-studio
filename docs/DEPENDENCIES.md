# Dependencies chosen in Slice 0 (exact versions)

Every dependency solves a current Slice 0 requirement (CLAUDE.md rule 23). Versions are pinned
exactly in the package manifests; `pnpm-lock.yaml` is the single lockfile. Updates arrive through
Dependabot/Renovate PRs (CI.md Stage E) and Changesets when release-visible.

## Runtime

| Package | Version | Where | Why |
|---|---|---|---|
| Node.js | 24 LTS (`.nvmrc`, `.node-version`, `engines`) | all | required by the delivery decision; Node 20 is end-of-life |
| pnpm | 10.33.2 (`packageManager`) | all | workspaces, strict hoisting, single lockfile |
| next | 16.3.4 | web | approved framework and router (ADR-014); Turbopack build |
| react / react-dom | 19.2.8 | web | Next 16 peer; `useActionState` for the foundation forms |
| better-auth | 1.7.2 | web | identity, authentication, sessions only (ADR-010); Drizzle adapter, Next.js cookies plugin |
| drizzle-orm | 0.45.2 | db, domain, web, worker, testing | single query layer (ADR-013); `pgSchema` tables, `set_config` transactions |
| pg | 8.23.0 | db, web, worker, testing | node-postgres driver, pooling per process |
| zod | 4.5.4 | contracts, domain, db (seed), web | strict schemas at every boundary; env validation |
| pino | 10.3.1 | web, worker | structured logs with redaction |
| dotenv | 17.4.2 | db (scripts), web (next.config) | load the repository-root `.env` in local development only |

## Tooling and tests (devDependencies)

| Package | Version | Why |
|---|---|---|
| typescript | 5.9.3 | strict TS; TypeScript 7 (native) was available but not yet supported by typescript-eslint / Next |
| turbo | 2.10.12 | task orchestration for `typecheck`/`build` across packages |
| drizzle-kit | 0.31.10 | schema diff → table migrations; custom SQL migrations share the journal |
| vitest | 4.1.11 | unit/domain + integration projects |
| testcontainers | 12.1.0 | builds `docker/postgres` and starts PostgreSQL for integration tests |
| tsx | 4.23.13 | run TypeScript scripts (migrate, provision, seed, worker dev) |
| tsup | 8.5.1 | bundle the worker (workspace packages inlined, native deps external) |
| eslint | 9.39.5 | ESLint 10 exists but the plugin ecosystem (Next plugin) still targets 9 |
| typescript-eslint | 8.69.0 | TS rules (non type-aware for speed) |
| @eslint/js | 9.39.5 | recommended base rules |
| eslint-config-prettier | 10.1.8 | disable formatting rules (one formatter) |
| eslint-plugin-boundaries | 7.2.0 | domain module dependency direction + public entry points |
| eslint-plugin-react-hooks | 7.1.1 | hooks rules for the web app |
| @next/eslint-plugin-next | 16.3.4 | Next.js rules |
| prettier | 3.9.6 | the formatter |
| husky | 9.1.7 | git hooks |
| lint-staged | 17.4.1 | staged-file checks on pre-commit |
| @commitlint/cli, @commitlint/config-conventional | 21.2.2 | Conventional Commits with project scopes |
| @changesets/cli | 3.0.1 | versioning and changelogs (ADR-011) |
| @changesets/changelog-github | 1.0.0 | PR-linked changelog entries |
| @types/node | 24.13.3 | Node 24 types |
| @types/pg | 8.23.1 | driver types |
| @types/react, @types/react-dom | 19.2.18 / 19.2.5 | React types |

## Not installed on purpose (Slice 0)

TanStack Router/Start/Table/Query/Virtual/Form, MapLibre, pg-boss, Redis, Prisma, Playwright,
OpenTelemetry/Sentry SDKs, any email provider SDK, any S3 SDK. Each arrives with the slice that
needs it (ADR-012, ADR-014; ports exist in `packages/domain/src/core/ports`).

## Container image

`docker/postgres/Dockerfile`: `imresamu/postgis:17-3.5` + `postgresql-17-pgvector` (PGDG).
Verified: PostgreSQL 17.6, PostGIS 3.5.3, pgvector 0.8.6, pg_trgm 1.6 (DEPLOYMENT.md §4).
