# Continuous integration — quality gates by stage

> GitHub Actions is authoritative. A check that does not exist yet is not in the workflow: CI
> only calls scripts that exist at the stage where the job is enabled. No placeholder tests.

## 1. Principles

- One required check name for branch protection: `ci / quality`. Its content grows per stage;
  the name stays stable so protection never has to be edited.
- Frozen installs (`pnpm install --frozen-lockfile`); Node version pinned by `.nvmrc` and
  `engines`; pnpm pinned via `packageManager`.
- Caching: pnpm store keyed by lockfile; Turborepo remote cache optional later.
- Secrets never printed; CI has no production credentials at any stage.
- Concurrency: one run per branch (`cancel-in-progress: true`) to save minutes.

## 2. Stages

> Status after Slice 0: Stages A, B and C are implemented in `.github/workflows/ci.yml`
> (`quality` and `db` jobs). Stage E is partially in place (lockfile check); Dependabot,
> `pnpm audit`, secret scanning and CodeQL are repository settings to enable at Implementation
> Gate 0. Stages D, F and G are not yet enabled.

### Stage A — today (repository exists, no code)

Workflow `.github/workflows/ci.yml`, job `quality`:

1. `repo-hygiene` (bash, dependency-free): fails if a `.env*` file with values, a private key,
   or a `node_modules` directory is committed; fails if Zamora constants appear under `apps/` or
   `packages/` (directories may not exist yet; the check passes when they are absent); checks the
   documentation set listed in `docs/README.md` exists.
2. `pr-title` (bash): on pull requests, validates the PR title against the Conventional Commits
   pattern and the project scope list (squash merges use it as the commit subject).

### Stage B — Slice 0 foundation (monorepo scaffolded)

Add to `quality`, in this order (fail fast, cheapest first):

1. `pnpm install --frozen-lockfile`
2. `pnpm format:check` (Prettier)
3. `pnpm lint` (ESLint incl. boundaries and forbidden-string rules)
4. `pnpm typecheck`
5. `pnpm test:unit` (Vitest: unit + domain)
6. `pnpm build` (Turborepo: `apps/web`, `apps/worker`, `packages/*`)
7. `changeset status` (advisory; only warns when a release-visible path changed without a
   changeset — never blocks docs/tooling-only diffs)

### Stage C — first database code (Slice 0 tenancy tables and RLS)

Add job `db` (needs Docker):

1. start PostgreSQL with PostGIS + pgvector via Testcontainers (or a service container);
2. `pnpm db:migrate` against an empty database → **migration verification** (applies cleanly,
   is idempotent on re-run, `drizzle-kit check` reports no drift between schema and migrations);
3. `pnpm test:integration` (repositories, RLS policy tests, schema assertions: every table in
   `app`/`pii`/`vec`/`portal` has forced RLS; every provenance-bearing table has
   `provenance_id NOT NULL`);
4. `pnpm test:isolation` — the **cross-tenant attack harness**; a coverage assertion fails when
   an entry point is not registered.

`db` becomes a second required check once it exists (`ci / db`).

### Stage D — first UI surfaces (Portfolio, shell, states)

Add job `e2e` (nightly + on PRs labelled `e2e`, to keep PR time short):

1. `pnpm build` + start `apps/web` against the test database seeded with generic factories;
2. `pnpm test:e2e` (Playwright connected flows);
3. `pnpm test:visual` (Playwright screenshots vs goldens at 1440 px, masked regions; failures
   upload diffs as artifacts).

### Stage E — dependencies and security (from Slice 0, cheap)

- Dependabot or Renovate for weekly dependency PRs (grouped, minor/patch auto-mergeable when
  CI is green; majors manual).
- `pnpm audit --audit-level=high` in `quality` (non-blocking at first, blocking before staging).
- GitHub secret scanning and push protection enabled on the repository.
- CodeQL default setup for JavaScript/TypeScript (free for private repos on plans that include
  it; otherwise skip without substitute).

### Stage F — release automation (Slice 0, once packages have versions)

Workflow `release.yml` on `push` to `main`: `changesets/action` opens/updates the Version
Packages PR; when merged, tags and creates a GitHub Release. Needs `contents: write` and
`pull-requests: write` permissions for `GITHUB_TOKEN` (and "Allow GitHub Actions to create and
approve pull requests" enabled in repository settings).

### Stage G — staging deploy (partially in place after Slice 0.5)

Implemented: Vercel's GitHub integration builds a preview for every branch/PR of `apps/web`
(root directory `apps/web`, Node 24.x, `pnpm install --frozen-lockfile` +
`pnpm --filter @eia/web build`). Railway deploys stay **manual** (`railway up`) during the
provider evaluation, as agreed for Slice 0.5; GitHub Actions remains the only quality authority
and gains no deploy job yet.

Original plan, still the target:

- `apps/web`: Vercel Git integration deploys `main` to the staging Vercel project and every PR
  to a preview; no GitHub Actions step required.
- `apps/worker` (+ database migrations): Railway deploys `main` to the persistent staging
  environment via Git integration; the migration step runs as a Railway pre-deploy command
  (`pnpm db:migrate`) with the migrator connection string. If CI-driven deploys are preferred
  later, a `deploy-staging.yml` workflow uses `railway up` with `RAILWAY_TOKEN`.

Production deployment is **never** automated in this plan; it is an explicit manual action after
the production-readiness gate (DEPLOYMENT.md §6).

## 3. Job matrix summary

| Job | Trigger | Required for merge | Introduced |
|---|---|---|---|
| `quality` | push to branches, PRs | yes | Stage A (grows B, E) |
| `db` | PRs, push to `main` | yes | Stage C |
| `e2e` | nightly, PRs labelled `e2e`, push to `main` | no (advisory) | Stage D |
| `release` | push to `main` | n/a | Stage F |
| `deploy-staging` | push to `main` (only if CI-driven deploys are chosen) | n/a | Stage G |

## 4. Local parity

`pnpm ci:local` (Slice 0) runs the same script sequence as `quality` and `db` so the developer
can reproduce a red CI without pushing. Hooks run a subset (ENGINEERING_STANDARDS.md §7).
