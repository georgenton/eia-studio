# EIA Studio

Multi-tenant workspace for environmental and social impact studies. Architecture and delivery
standards live in [`docs/`](docs/README.md); working rules for every session in
[`CLAUDE.md`](CLAUDE.md). Current status: **Slice 0 — SaaS foundation** (no product surfaces yet).

## Requirements

- Node.js 24 (`.nvmrc`), pnpm 10.33.2 (`corepack enable` or `npm i -g pnpm@10.33.2`)
- Docker (local PostgreSQL with PostGIS + pgvector; Testcontainers for integration tests)

## Quick start

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:up                       # builds docker/postgres and starts PostgreSQL 17 + PostGIS + pgvector
pnpm db:migrate                  # migrator role (DATABASE_MIGRATOR_URL)
pnpm db:provision-runtime-role   # creates the RLS-enforced login role from DATABASE_APP_ROLE_*
pnpm dev:web                     # http://localhost:3000 (foundation page, /health, sign-in)
pnpm dev:worker                  # persistent worker, http://localhost:3100/health
```

Optional demo tenant (synthetic, no personal data): sign up in the web app, then
`pnpm db:seed:dev --user-email you@example.test`.

## Quality gates

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build
pnpm test:integration            # migrations, extensions, RLS, cross-tenant harness (Docker)
pnpm ci:local                    # everything CI runs
```

## Layout

```
apps/web        Next.js App Router (workspace + portal route group)   packages/domain    bounded modules
apps/worker     persistent worker process                             packages/db        Drizzle schema, SQL migrations, RLS
packages/contracts  zod env/DTO schemas                               packages/testing   Testcontainers, factories, attack harness
packages/ui     design tokens, presentation mappings                  packages/config    tsconfig / eslint / prettier
fixtures/       synthetic demo data (never imported by code)          docs/              architecture, ADRs, standards
```

## Running the product locally

```bash
pnpm db:up                       # PostgreSQL 17 + PostGIS + pgvector
pnpm db:migrate                  # migrator role
pnpm db:provision-runtime-role   # RLS-enforced runtime login role
pnpm db:seed:dev                 # synthetic demo tenant
pnpm db:seed:demo-project        # project fixture: historical aggregates + demo operations

# a synthetic account to sign in with (the password never leaves your environment)
DEMO_USER_PASSWORD='choose-a-long-local-password' pnpm provision:identity \
  --email coordinadora@demo.invalid --name "Coordinadora de proyecto" \
  --tenant demo-consultancy --tenant-role MEMBER \
  --project puente-del-amor --project-role COORDINATOR

pnpm dev:web                     # http://localhost:3000
```

Public sign-up is disabled by design, so accounts are always provisioned deliberately. The
provisioning script refuses any address outside the reserved synthetic domains and refuses to run
with `APP_ENV=production`.

### End-to-end suite

```bash
DEMO_USER_PASSWORD='choose-a-long-local-password' pnpm e2e:prepare
DEMO_USER_PASSWORD='choose-a-long-local-password' pnpm e2e
```
