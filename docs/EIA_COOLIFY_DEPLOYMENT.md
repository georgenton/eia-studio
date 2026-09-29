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

## A published image is not an accepted release

Merging to `main` publishes a digest to GHCR. **That is a build artefact and nothing more.**

A digest becomes eligible for demo or staging only when all of these hold:

1. main CI is green for that commit;
2. the container gate built and smoked that image;
3. a deployment review accepts it.

Nothing deploys automatically. There is no workflow that touches OVH, Coolify or DNS, and adding
one is a decision, not a convenience. The pull-request gate publishes nothing at all: it builds
the image, runs it, and throws it away.

## How Coolify authenticates to GHCR

`EIA_IMAGE=ghcr.io/georgenton/eia-studio@sha256:…` says *what* to pull; it does not say *how*.
Two legitimate arrangements, and the choice is an account-level one:

**A — the package is public.** Coolify pulls anonymously, no credential anywhere. Appropriate
only if the image itself may be world-readable. The image carries no secret and no `.env`, but it
does carry the whole application, and the source repository being public today does not make
publishing built artefacts automatically correct. It is a decision to take deliberately.

**B — the package stays private and Coolify holds a read-only credential.** Preferred. GHCR
accepts a token with `read:packages` and nothing else; on GitHub the least-privilege shape today
is a fine-grained token scoped to this repository's packages with read access, or a dedicated
machine account granted read on the package. Coolify stores it as a registry credential and uses
it for `docker pull`.

**Neither has been done.** No token exists, no credential is committed, package visibility is
unchanged, and Coolify has no registry configured. **OWNER_INPUT_REQUIRED**: pick A or B before
DEPLOY DEMO, because the first pull fails without it and that failure looks like a broken image.

Whichever is chosen, the credential is pull-only. Nothing in a deployment needs to write to the
registry — publishing happens in CI, from a workflow whose token is scoped to that job alone.

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

## One build failure that was not reproduced

The pre-deploy implementation recorded a `docker build` that failed inside `next build` while an
identical build immediately before and after succeeded. It was investigated rather than waved
away: two further builds with `--no-cache --pull`, from no prior layers, both completed with exit
code 0 and zero error lines in 368 and 331 log lines respectively.

It is recorded as **observed locally, not reproduced**. No retry was added, no Next error was
suppressed and no timeout was raised — each of those would hide the next occurrence instead of
catching it. The pull-request container gate now builds the image on every change, so a real
flake has somewhere to show up.
