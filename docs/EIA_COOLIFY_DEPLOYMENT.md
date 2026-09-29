# Deploying EIA Studio with Coolify

The mechanics live beside the file they describe: `deploy/coolify/README.md`. This document is
the model — what exists, what it is called, and why the shape is what it is.

## Resource model

    Coolify project : EIA Studio
    Environments    : demo · staging · production
    Applications    : eia-demo · eia-staging · eia-production   (compose, from deploy/coolify/compose.yml)
    Databases       : separate resources, outside the application compose (ADR-039)
    Object storage  : external, one bucket per environment

Names are conceptual. **None of these resources exist yet**: nothing has been created in Coolify.

## The image

One image, three commands, built by `.github/workflows/image.yml` and published to
`ghcr.io/georgenton/eia-studio` tagged with the full commit SHA. **The release authority is the
digest.** `latest` is not published: a moving tag cannot answer which code is serving.

    web      node apps/web/server.js
    worker   node apps/worker/dist/main.js
    migrate  node packages/db/dist/migrate.js

## Release flow

**Demo.** Choose an accepted version, certify it for demonstration, deploy that digest, smoke it.
Demo may lag production deliberately.

**Staging.** Accepted SHA → image → pre-deploy review → deploy → migrate → smoke → UAT →
validation report → GO or NO-GO. A bug is NO-GO: branch, test, new pre-deploy. No coding during
a deployment.

**Production.** Staging GO → freeze → deploy plan → checkpoint → deploy **the same digest** →
migrate → smoke → post-deploy validation. Explicit approval, no rebuild.

## Migrations

A one-shot run of the same image with `DATABASE_MIGRATOR_URL`, **before** the new version serves.
`web` and `worker` never migrate. Two services racing to apply the same migration is the failure
this separation prevents.

Migrations are forward-only: there is no `down`. Rolling the application back does not roll the
schema back. That is a restore, and it is a different operation with a different risk.

## Health

`/health` on web is **liveness**: it answers `status`, `service`, `version` and `gitSha`, reads no
database and no configuration. It proves the process is up, not that it can serve. The worker has
its own `/health` on the container's loopback, never published.

`gitSha` is how you confirm which digest is actually running. It is baked at build time and read
at request time.

## Rollback

Set `EIA_IMAGE` to the previous digest and redeploy. Distinguish three things that are often
confused: **application rollback** (change the digest), **migration rollback** (does not exist),
and **data restore** (backup plus PITR). Never `git reset` on the host as a deployment mechanism.
