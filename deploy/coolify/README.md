# Deploying EIA Studio on Coolify

One compose file, three environments, one image digest per deployment. Nothing in this directory
names an environment: `compose.yml` reads everything from variables that Coolify supplies.

See ADR-039 for why the database is not here and why there is only one image.

## The three commands

The image is the same; only the command differs.

| Process | Command                            | Routed publicly             |
| ------- | ---------------------------------- | --------------------------- |
| web     | `node apps/web/server.js`          | yes, port 3000 via `expose` |
| worker  | `node apps/worker/dist/main.js`    | **no**                      |
| migrate | `node packages/db/dist/migrate.js` | one-shot, not a service     |

## Before the first deployment: how Coolify reaches GHCR

`EIA_IMAGE` names a digest; it does not grant access to it. Either the package is public and
Coolify pulls anonymously, or it stays private and Coolify holds a **pull-only** registry
credential. Neither is configured, and the choice is the owner's — see
`docs/EIA_COOLIFY_DEPLOYMENT.md`. Without it the first pull fails in a way that looks like a
broken image.

## Deploying a version

1. Find the digest. The `image` workflow prints it in the run summary; it is also
   `ghcr.io/georgenton/eia-studio@sha256:…`.
2. Set `EIA_IMAGE` to that **digest**, not a tag. A tag can move; a deployment record must not.
3. Run the migration **before** the new version serves traffic:

       docker run --rm --env-file <env> ghcr.io/georgenton/eia-studio@sha256:… \
         node packages/db/dist/migrate.js

   It needs `DATABASE_MIGRATOR_URL` and `APP_ENV`, and nothing else. `web` and `worker` never
   migrate: two services racing to apply the same migration is the failure this separation exists
   to prevent.

4. Redeploy the stack.

## Rollback

Set `EIA_IMAGE` to the previous digest and redeploy. That reverses the **application** and nothing
else: migrations are forward-only, so if the version being rolled back applied one, the schema
stays. Reversing a schema is a restore, not a redeploy — `docs/EIA_BACKUP_RECOVERY.md`.

## The database is a separate resource, and its own artefact

This compose declares `web` and `worker` and **no PostgreSQL**, and that does not change
(ADR-039). Since ADR-040 the database is self-hosted as a separate Coolify resource per
environment, built from `docker/postgres` and deployed by digest. How it is built, how its TLS
works, how it is backed up and what must be measured before production are in
`docs/DATABASE_PLATFORM.md`.

Two things this compose does **not** do yet, and both belong to the migration wave rather than
here:

- it declares no mount, so it cannot deliver the internal CA certificate the application needs to
  connect with `sslmode=verify-full&sslrootcert=…`;
- `connect_to_docker_network` must be set to `true` on the Coolify service **by a PATCH after
  creation** — the creation endpoint rejects the field — or the stack is isolated on its own
  network and the worker fails with `getaddrinfo ENOTFOUND` against the database hostname.

## What is deliberately absent

**PostgreSQL.** The application consumes URLs. Demo may point at a Coolify database resource;
staging and production point at whatever ADR-039's open question resolves to.

**Host port mappings.** Only `web` declares `expose`, and Coolify places the proxy in front of it.
The worker publishes nothing at all: its health server listens on the container's loopback and is
reached only by the container's own healthcheck.

**Secrets of any kind.** The image carries none, no `.env` is copied, and the only build arguments
are a commit SHA and a CI run number.
