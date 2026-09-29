# ADR-039 — One image, three environments, and a database nobody bakes in

- Status: Accepted
- Date: 29 September 2026
- Related: ADR-012 (hosting), ADR-031 (object storage behind one port), IG4-001 (unset is
  unavailable, never faked), `docs/PRODUCTION_INFRASTRUCTURE_DECISION.md` (which this ADR
  **amends**), `docs/PRODUCTION_RECOVERY.md` §2 (RPO of five minutes).
- Amends `docs/DEPLOYMENT.md` (deployment topology) and `docs/ARCHITECTURE.md` §9.1
  (portability constraints — now satisfied by an actual image rather than by intent).

## Context

Until this wave the repository could not be deployed anywhere except Vercel and Railway, and not
because of a policy: **there was no Dockerfile.** `docs/ARCHITECTURE.md` §9.1 said both apps
"build to OCI container images"; nothing did. The Cinta Vera platform needs EIA Studio to run as
the first of several products on shared infrastructure, each with three permanent environments,
so the gap had to close before anything else could be decided.

Two questions had to be answered together, because answering either alone produces a bad answer.

**How many images?** Three images built from three commits cannot support "the digest validated
in staging is the digest deployed to production", which is the only statement that makes a
release process auditable rather than hopeful.

**Where does PostgreSQL live?** `PRODUCTION_INFRASTRUCTURE_DECISION.md` recommended Neon after
establishing, with the Railway CLI, that Railway serves PostGIS **or** point-in-time recovery and
never both. Moving to self-hosted Coolify on OVH does not solve that problem; it moves it to us.

## Decision

**One immutable image runs all three processes**, distinguished only by the command:

    web      node apps/web/server.js
    worker   node apps/worker/dist/main.js
    migrate  node packages/db/dist/migrate.js

Next.js emits `output: "standalone"` with `outputFileTracingRoot` at the repository root, and
that traced tree is the dependency tree for all three commands. The worker and the migration
runner are esbuild bundles whose only runtime externals are `pg` and `pino`, resolved by two
symlinks into the same traced copies. There is no second install and no second manifest to drift
from the lockfile.

**PostgreSQL is not part of the application stack.** `deploy/coolify/compose.yml` declares `web`
and `worker` and nothing else. The application consumes `DATABASE_URL` and, for migrations only,
`DATABASE_MIGRATOR_URL`. Whether the server behind them is a Coolify resource on the same host or
a managed provider is a deployment decision.

**Demo may use a PostgreSQL resource on OVH/Coolify.** Its data is synthetic and reproducible: the
recovery objective is *reseed*, not *restore*.

**Staging and production must use the same database strategy**, because staging exists to
validate what production will do, and a staging database of a different kind validates a
different system. The preferred direction is managed PostgreSQL offering PostgreSQL 17, PostGIS,
pgvector and PITR together. **The provider stays undecided** and is OWNER_INPUT_REQUIRED.

**If self-hosting is chosen for staging and production**, off-host WAL archiving, backup and a
restore drill become mandatory gates, not follow-up work. A backup on the same VPS is not a
backup.

**`APP_ENV` gains `demo`.** It is persistent: `isPersistentEnvironment` and
`isPersistentStorageEnvironment` are named positively for `local` and `test`, so `demo` inherits
the refusal of a `fake` classifier and an in-memory store without any code naming it. What `demo`
allows that production does not is `DEMO_FIXTURES_ENABLED`, and that stays an explicit opt-in.

## Consequences

The release record is a digest. `latest` is not published, deliberately: a moving tag cannot
answer which code is serving.

The image carries no configuration. No `.env` is copied, no secret is a build argument, and the
only build arguments are a commit identifier and a run number, both readable in
`/health` and in the OCI labels.

Migrations are never run by `web` or `worker`. They are a one-shot invocation of the same image
with the migrator role. Two services racing to migrate is the failure this separation prevents,
and it is why the migration runner is a third command rather than a startup hook.

The three environments share one compose file. Differences are variables, secrets, the image
digest and resource limits. Three files would drift, and drift is how "it worked in staging"
happens.

**What this ADR does not decide**: the database provider, the domain, the bucket provider, and
whether staging migrates off Vercel and Railway. Each is recorded as OWNER_INPUT_REQUIRED in the
pre-deploy report.

## Alternatives considered

**Three images, one per process.** Rejected: it makes digest equality between staging and
production unprovable, which is the property the whole release model rests on.

**Bake PostgreSQL into the application compose.** Rejected: it couples the application's lifecycle
to a database's, makes the managed-provider path a rewrite rather than a variable, and would put
a production database inside a stack that gets redeployed on every release.

**Keep `tsx` in the runtime image to run migrations.** Rejected: shipping a TypeScript toolchain
to run one script puts a development dependency in the production layer. The runner is compiled
instead, emitting to `packages/db/dist/` so that `MIGRATIONS_FOLDER`, which resolves `../migrations`
from the bundle, keeps pointing at the same folder it always did.

**Add `demo` as a flag rather than an environment.** Rejected: every guard in the repository keys
off `APP_ENV`, and a parallel flag would create two sources of truth about what an environment may
do — with the fixture guards being the ones that disagree.
