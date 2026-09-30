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

## The intermittent build failure, and its cause

The pre-deploy implementation recorded a `docker build` that failed inside `next build` while an
identical build immediately before and after succeeded. It was investigated rather than waved away:
two further builds with `--no-cache --pull`, from no prior layers, both completed with exit code 0
and zero error lines in 368 and 331 log lines respectively. It was recorded as **observed locally,
not reproduced** — no retry added, no Next error suppressed, no timeout raised, each of which would
have hidden the next occurrence instead of catching it — and the pull-request container gate was
made to build the image on every change so that a real flake would have somewhere to show up.

It did. On **30 September 2026** the gate of PR #57 reproduced it.

**The cause.** `apps/web/app/layout.tsx` loaded its three fonts through `next/font/google`, which
downloads them from `fonts.gstatic.com` **during `next build`**. When the build container cannot
reach Google, Next emits a warning, still emits the generated font CSS module, and the build then
fails resolving files it never fetched:

```
Warning: Error while requesting resource
There was an issue establishing a connection while requesting
https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&display=swap
...
Module not found  [next]/internal/font/google/jetbrains_mono_23b75448.module.css
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @eia/web@0.0.0 build: `next build`
```

That is why it was intermittent: nothing about this repository decided it. A transient DNS answer,
a slow resolver or a restricted egress path did — which is exactly the failure mode a build should
not have, and exactly the one a retry would have made invisible.

**The fix is the removal of the dependency, not a retry.** The three families are committed under
`apps/web/app/fonts/` and loaded with `next/font/local`. Same families, same weights, same CSS
variables, same `display: swap`; the font bytes are the ones Google was serving, and the rendered
output is pixel-identical — the same page built both ways produced byte-identical screenshots.
`docs/DEPENDENCIES.md` § *Self-hosted fonts* is the supply-chain record, including the licences and
the one behavioural narrowing the change makes.

**Proved, not assumed.** With the `deps` layer already built, the image builds with no network at
all:

```bash
docker build --target deps -t eia-deps .
docker build --build-context deps=docker-image://eia-deps:latest --network=none .
```

`deps` is pinned to the prebuilt image because `--network=none` applies to every stage and pnpm
genuinely needs a registry; everything after it does not. The same command against the previous
`next/font/google` layout fails with the message above — the negative control, and the reproduction
the earlier investigation could not obtain.

`apps/web/test/build-hermeticity.test.ts` keeps it that way: it fails if anything under `apps/web`
imports a build-time network font loader again. That guard runs in the ordinary unit suite, so the
next occurrence is a red test on a developer's machine rather than a deployment that will not build.
