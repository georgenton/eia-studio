# ADR-040 — The database is ours, and so is everything that keeps it

- Status: Accepted
- Date: 30 September 2026
- Related: ADR-039 (one image, three environments — this ADR **resolves** the database question
  it left `OWNER_INPUT_REQUIRED`), ADR-004 (row level security), IG0-M01 (supply chain pinning),
  `docs/PRODUCTION_RECOVERY.md` §2–3 (RPO, retention), `docs/DEPENDENCIES.md`.
- **Supersedes** the provider recommendation in `docs/PRODUCTION_INFRASTRUCTURE_DECISION.md` §3.
  That document's *evidence* stands — Railway can serve PostGIS or PITR and not both, and Neon
  was the only managed candidate offering PostGIS, pgvector and self-service PITR together. What
  is superseded is its conclusion, by an owner decision it did not have.
- Closes TD-001 (unpinned pgvector). Rewrites the removal trigger of TD-016 (database TLS).
  Replaces TD-018, whose subject — a Railway staging database — no longer exists.

## Context

`docs/PRODUCTION_INFRASTRUCTURE_DECISION.md` §3 recommended managed PostgreSQL, and rejected
self-managing PostGIS on a VM in one sentence: *"Somebody would have to operate it, and there is
no somebody."*

**The owner has decided to be that somebody.** PostgreSQL is self-hosted on the existing OVH VPS,
managed through Coolify, for demo, staging and production alike. Cloudflare R2 remains authorised
for object storage, for backups and now for the WAL archive.

This is a decision about ownership, not a discovery that the earlier analysis was wrong. The
consequence is precise and worth stating before anything else: **every guarantee that a managed
provider would have sold us is now a thing this repository has to build and this team has to
operate.** An ADR that recorded the decision and quietly dropped the guarantees would be the
worst possible outcome, so the requirements are restated here unchanged:

PostgreSQL 17 · PostGIS · pgvector · pg_trgm · row level security · a separate database per
environment · separate credentials per environment · persistent volumes · no public 5432 · TLS ·
**off-host backups** · **point-in-time recovery** · RPO ≤ 5 minutes.

Nothing on that list is relaxed because the deployment became ours.

## Decision

### 1. One image, pinned twice, published by digest

`docker/postgres/Dockerfile` is the database artefact for local development, CI and every
deployment. It is published to `ghcr.io/georgenton/eia-studio-postgres` by
`.github/workflows/postgres-image.yml` and **deployed by digest, never by tag**.

It is pinned at two levels, because they fail differently:

- the **base** by the immutable digest of its manifest list (IG0-M01, unchanged);
- the **apt packages** by exact version — `postgresql-17-pgvector=0.8.6-1.pgdg12+2` and
  `pgbackrest=2.59.1-1.pgdg12+1`.

That closes TD-001, which observed that `postgresql-17-pgvector` resolved at build time and the
layer was therefore not reproducible. The trade-off is stated rather than discovered later: PGDG
prunes older versions from its index, so a pin eventually stops resolving and **the build fails
loudly**. That is the failure we want. Installing a different pgvector into a database that
already holds vector columns is the failure we do not.

The published digest is what makes the pin permanent. An apt pin is reproducible for as long as
the index keeps the version; a digest is reproducible for as long as the registry keeps the image.

The image is multi-architecture (amd64 + arm64) because the deployments are amd64 and the
developer machines are arm64, and one image for both is what keeps `pnpm db:up` and staging the
same database.

**pgBackRest is installed and not configured.** Archiving is switched on per environment. An
image that archived by default would write a stranger's WAL to somebody's bucket the first time
they ran it locally.

### 2. A separate Coolify resource per environment, never a service in the application stack

`deploy/coolify/compose.yml` does not gain a PostgreSQL service, and the reason is the same one
ADR-039 gave: the application containers are disposable and the database is not. Putting them in
one stack makes `restart` ambiguous and makes a redeploy a thing that *could* touch the data.

Each environment gets its own Coolify PostgreSQL resource on the same host, with its own volume,
its own credentials, its own migrator role and its own runtime role, on the private Docker
network with **no published port**. Demo and staging exist; production is not created by this ADR.

### 3. TLS from an internal CA, and clients that verify

The current arrangement has two problems and they are different. The deployed bundle image serves
**no TLS at all** (`ssl = off`). The repository's own image serves a **self-signed** certificate,
which encrypts but proves nothing about who answered — and, until this ADR, carried no subject
alternative name, so no current client could have verified it even if its issuer were trusted.

The architecture is:

```
Cinta Vera internal CA  (private key never on the VPS, never in Git, never in an image)
        ↓  signs
server certificate per environment   SAN = the Coolify internal hostname
        ↓  presented by
PostgreSQL with ssl = on
        ↓  verified by
EIA clients with sslmode=verify-full&sslrootcert=<CA>
```

**`verify-full`, not `verify-ca`.** This is a finding rather than an ambition:
`pg-connection-string` in its default mode treats `verify-ca` as an alias for `verify-full` and
emits a deprecation warning, so asking for the weaker mode buys nothing and says something untrue
about the intent. The environment contract in `packages/contracts/src/env/database.ts` is
unchanged and still accepts either in production.

Hostname verification is therefore in force, which makes the **SAN the load-bearing part**. The
Coolify internal hostname is the resource UUID — stable for the life of the resource, and known
before the certificate is issued.

`ssl-entrypoint.sh` prefers provided material and falls back to generating a self-signed pair for
local development and CI, where client and server are the same machine. `EIA_SSL_REQUIRE_PROVIDED=true`
refuses the fallback: an environment that meant to present a CA-signed certificate and silently
presented a self-signed one would still report `ssl = on`, still encrypt, and fail at the first
verifying client — at which point the obvious remedy is to weaken the client.

**Private keys are secrets and stay secrets.** The CA private key never reaches the VPS. Server
private keys are delivered as mounted secrets, never baked into the image, never committed, never
logged. The material is staged into a runtime directory so a read-only mount owned by another uid
still works, and a certificate and key that are not a pair are detected at start rather than
surfacing as an opaque error about the key file.

**Certificate persistence**, which the previous arrangement got wrong: `/var/lib/postgresql/certs`
is outside the data volume, so a self-signed certificate was regenerated on every container
start despite a comment claiming otherwise. Two things fix it, and the second one dissolves the
question: the directory is now an explicit, documented mount point; and an environment using a
CA-signed certificate receives it as a mount, so there is nothing to persist.

### 4. The client trusts the CA through `sslrootcert`, and nothing else changes

Proven, not assumed. `pg-connection-string@2.14.0` reads `sslrootcert=<path>` with
`fs.readFileSync` into `ssl.ca`; `packages/db/src/client.ts` passes the connection string
straight through and needs **no change at all**.

`packages/testing/test/database-tls.integration.test.ts` asserts it against a real container
with a real CA: a client trusting the issuing CA connects and `pg_stat_ssl.ssl` is `true`; a
client trusting a *different* CA is refused; and a client supplying **no** CA is refused, which
is the control that catches a test CA that has found its way into a system trust store.

`NODE_EXTRA_CA_CERTS` was considered and not chosen. It would work, and it is a process-wide
switch for a per-connection fact: it would make every outbound TLS connection from web and worker
trust our CA, including those to Cloudflare R2 and to a model provider. `sslrootcert` scopes the
trust to the connection that needs it.

Both mechanisms need the CA file inside the application container, which `deploy/coolify/compose.yml`
has no way to deliver today. **That is the one piece of deployment work this ADR names and does
not do**, because it belongs with the migration of an environment rather than with the artefact.

### 5. Point-in-time recovery with pgBackRest

Chosen on evidence, over WAL-G:

| | pgBackRest | WAL-G |
|---|---|---|
| PostgreSQL 17 | yes | yes |
| S3-compatible / R2 | yes, `repo1-s3-*` with a custom endpoint | yes, `WALG_S3_PREFIX` + `AWS_ENDPOINT` |
| **Distribution** | **in the PGDG apt repository the base image already trusts** — `2.59.1-1.pgdg12+1` | not packaged for Debian; a GitHub release binary |
| Pinning | the same `apt-get install pkg=version` discipline as pgvector | a second supply chain, with its own download and checksum step |
| Restore | `pgbackrest restore --type=time --target=…` | `wal-g backup-fetch` then a recovery configuration by hand |

The deciding factor is the third row. This repository's supply-chain discipline is *pin what apt
resolves, from a repository the base image already trusts* (IG0-M01, `docs/DEPENDENCIES.md`), and
pgBackRest fits inside it exactly. WAL-G would add a download, a checksum and a second update
procedure to serve a need pgBackRest already serves.

The target, per environment:

```
PostgreSQL  →  archive_command  →  pgBackRest  →  its own R2 bucket, its own credential
```

Its own bucket and its own credential, not shared with the application object store and not
shared across environments — for the reason the staging storage validation demonstrated rather
than argued: the staging application credential receives HTTP 403 against the backup bucket, and
that separation is what makes "the application cannot delete its own backups" a fact instead of a
policy.

Coolify's daily `pg_dump` stays, as defence in depth. It is a different failure mode: a logical
dump survives a corrupted WAL archive, and a WAL archive survives a dump that silently truncated.

**RPO remains ≤ 5 minutes**, and it is not met today. Configuring archiving is the next wave.

### 6. Capacity stays on this host, and expansion is vertical

Measured: the host has ~11.4 GiB; demo and staging together hold ~8.5 GiB of configured ceilings
and use ~430 MiB. Production on the same host with the same ceilings would exceed the host's
memory in ceilings, which is a number to respect even though ceilings are not reservations.

If capacity becomes insufficient, the remedy is **vertical expansion of the OVH host**, not moving
PostgreSQL to another provider. That is the same decision this ADR records, applied again.

The capacity gate before production is defined in `docs/DATABASE_PLATFORM.md` §6.

## Consequences

**What gets better.** One database artefact for every environment, pinned and published, so
`pnpm db:up`, CI, demo, staging and production run the same PostgreSQL. TLS becomes verifiable
rather than merely present. pgvector stops floating. Costs stay on infrastructure already paid
for, and no study's data leaves an operator the consultancy controls.

**What gets worse, and is now ours.** Base-image patching. PostgreSQL major upgrades. WAL
archiving and its monitoring. Restore rehearsals. Certificate issuance and rotation. The
availability of a single host with no replica: if it is down, the workspace is down — mitigated,
and only for capture, by offline field work (ADR-028).

**What is not solved by this ADR.** Archiving is designed and not configured, so the effective
RPO is still 24 hours. There is no replica and no failover. The CA does not exist yet. And
`deploy/coolify/compose.yml` still cannot deliver a CA file to the application containers.

## Alternatives considered

**Managed PostgreSQL (Neon, Supabase).** The prior recommendation, with verified extension
support and self-service PITR. Rejected by owner decision. Its strongest technical argument
survives and is worth keeping on the record: a certificate chaining to a public CA would have made
`verify-full` work with no CA distribution at all, and PITR would have been a checkbox rather than
a subsystem.

**Keeping `imresamu/postgis:17-3.5-bundle0` with `ssl = off`.** Best reproducibility of the three
options, zero operational burden, and already running. Rejected because production cannot start
with it: the environment schema refuses `APP_ENV=production` without `verify-ca` or `verify-full`,
so staging would validate a system production cannot be.

**`verify-ca` instead of `verify-full`.** Rejected on evidence: the client library treats them as
the same thing, so the weaker name would describe the configuration inaccurately.

**WAL-G.** A good tool, rejected on supply chain rather than capability (§5).

**Baking the CA certificate into the application image.** Rejected: it makes CA rotation an
application release, and this ADR's whole shape is that the database artefact and the application
artefact have different lifetimes.
