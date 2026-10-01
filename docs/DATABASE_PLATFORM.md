# The database platform

How EIA Studio's PostgreSQL is built, secured, deployed and recovered, now that it is self-hosted
(ADR-040). The decision and its reasoning are in the ADR; this is the operator's map.

**Status.** The artefact exists and is tested. The CA does not exist yet, archiving is not
configured, and no environment has been migrated to the new image. What is true today is in §7.

## 1. The image

| | |
|---|---|
| Source | `docker/postgres/Dockerfile` + `docker/postgres/ssl-entrypoint.sh` |
| Base | `imresamu/postgis:17-3.5`, pinned by manifest-list digest |
| Contents | PostgreSQL 17.6 · PostGIS 3.5.3 · pgvector 0.8.6 · pg_trgm 1.6 · pgBackRest 2.59.1 |
| Published | `ghcr.io/georgenton/eia-studio-postgres` by `.github/workflows/postgres-image.yml` |
| Architectures | `linux/amd64` + `linux/arm64` |
| **Deployed by** | **digest, never a tag** |

Both apt packages are pinned by exact version. When PGDG prunes one from its index the build
fails, which is the intended failure: read the new version, update the pin in a `chore(db)` PR,
and let CI re-verify what the image actually contains.

**Why a tag must never be deployed.** A database resource pinned to `:main` would pull a
different image the next time the workflow ran, under a volume that is running. Adopting a new
digest is a deliberate act, with a backup taken first (§5).

### Adopting a new digest

1. Merge the `chore(db)` PR. The workflow publishes and prints the digest in its run summary.
2. Take a backup of the environment and **verify the execution**, not just the configuration.
3. Update the resource's image to the new digest. Restart. The volume is untouched.
4. Verify: extensions present, 52 migrations, 71 FORCE RLS tables, 142 policies,
   `security_invoker` on `app.effective_survey_instance`, runtime role `rolbypassrls = false`.
5. The rollback is the previous digest and the same volume.

## 2. TLS and the internal CA

```
Cinta Vera internal CA        private key: never on the VPS, never in Git, never in an image
        │ signs
        ▼
server certificate            one per environment, SAN = that resource's internal hostname
        │ presented by
        ▼
PostgreSQL ssl = on
        │ verified by
        ▼
EIA clients                   sslmode=verify-full&sslrootcert=/etc/ssl/eia/ca.crt
```

### The CA — created 1 October 2026

It exists. On the owner's workstation, not on the VPS, in
`~/.config/syntavera/secrets/pki/` (directory `700`, key `600`):

```
subject      CN=Cinta Vera Labs Internal Root CA
issuer       (self-signed)
serial       60CCA75F00727DBBE42651A0485C747E4FC40774
validity     2026-10-01 → 2036-09-30
key          RSA 4096, sha256WithRSAEncryption
constraints  CA:TRUE, pathlen:1 (critical) · keyCertSign, cRLSign (critical)
SHA-256      2D:A1:E8:8C:E8:75:9E:93:68:50:C6:0A:76:DD:5E:F1:
             D1:D7:06:EE:B6:A4:AB:DA:F6:26:79:87:B7:F7:D9:3E
```

The fingerprint is recorded here so a certificate can be checked against *this* CA rather than
against whichever one a machine happens to hold.

It was created with:

```bash
umask 077
openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 3652 \
  -keyout cinta-vera-root-ca.key -out cinta-vera-root-ca.crt \
  -subj "/CN=Cinta Vera Labs Internal Root CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"
```

`cinta-vera-root-ca.key` is the most sensitive file in this platform: whoever holds it can
impersonate any database. It is offline, it has never been copied to the VPS, and it must be
backed up separately from everything else — losing it means reissuing every server certificate;
leaking it means every database can be impersonated. `cinta-vera-root-ca.crt` is public and is
the file the applications trust.

> **`.gitignore` does not protect against an accidental copy.** There is no pattern for `*.key`,
> so a stray `cp` into the working tree would be stageable. Worth one line the next time this
> repository is touched:
> ```
> # never, under any circumstances
> *.key
> *-ca.key
> ```

### Issuing a server certificate

The SAN is the load-bearing part, because `verify-full` verifies the hostname. **The hostname is
the Coolify resource UUID**, established from the generated compose rather than assumed: Coolify
writes the UUID as both the compose *service name* and the `container_name`, so Docker resolves
it twice over. The readable resource name (`eia-staging-postgres`) exists only as a label and
**does not resolve** — checked from inside the application container, where it answers
`EAI_AGAIN`.

It survives container restarts and application redeploys, because the compose is regenerated from
the resource and the UUID does not change. **Deleting and recreating the resource changes it**,
which has one consequence for the migration: a new database resource has a new UUID, so its
certificate cannot be issued until the resource exists. Renaming the resource does not change it.

```bash
# Read it from the resource rather than typing it
HOST=<resource-uuid>            # staging today: wdjaezmgckj9j7xylw5nskvg
```


```bash
HOST=<resource-uuid>            # e.g. the staging database's Coolify UUID
umask 077
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=${HOST}"
printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$HOST" > ext.cnf
openssl x509 -req -in server.csr -CA cinta-vera-root-ca.crt -CAkey cinta-vera-root-ca.key \
  -CAcreateserial -days 825 -out server.crt -extfile ext.cnf
```

One certificate per environment. Never one certificate for all three: a key that unlocks demo
would then unlock production.

### Delivering it

| To | What | How |
|---|---|---|
| The database container | `server.crt`, `server.key` | mounted read-only at `EIA_SSL_SOURCE_DIR`, with `EIA_SSL_REQUIRE_PROVIDED=true` |
| The application containers | `ca.crt` only | mounted read-only; `DATABASE_URL` gains `?sslmode=verify-full&sslrootcert=<path>` |

The entrypoint stages the pair into `EIA_SSL_DIR`, fixes ownership and mode, and checks that the
certificate and the key belong together before PostgreSQL sees them.

**Two mechanisms, and they behave differently — this cost a migration window to learn.**

| Resource kind | Who writes the compose | A file storage becomes a mount? |
|---|---|---|
| Database (`/databases/{uuid}/storages`) | Coolify generates it | **yes**, injected automatically |
| Service (`/services/{uuid}/storages`) | Coolify renders *our* compose | **no** — the file lands on the host and nothing references it |

For the application the compose therefore declares the mount itself:

```yaml
volumes:
  - ./run/eia-ca:/run/eia-ca:ro
```

A **directory**, because Coolify's file storage writes into exactly that path beside the compose,
and an environment with no CA then gets an empty directory rather than a bind source that does
not exist. The storage record still supplies the content; the compose supplies the mount. Both
are needed.

**One path for all three environments**, because a path that lives in Coolify rather than in git
is how environments drift:

```
/run/eia-ca/cinta-vera-root-ca.crt
```

mounted read-only on both `web` and `worker`, with `DATABASE_URL` ending
`?sslmode=verify-full&sslrootcert=/run/eia-ca/cinta-vera-root-ca.crt`. The migration verifies the
file is present in both containers rather than trusting that the mount was configured.

### Environment variables the image reads

| | |
|---|---|
| `EIA_SSL_SOURCE_DIR` | where provided material is mounted. Unset means "generate" |
| `EIA_SSL_DIR` | runtime directory, default `/var/lib/postgresql/certs`. **Outside the data volume**: make it a mount if a generated certificate must survive a restart |
| `EIA_SSL_REQUIRE_PROVIDED` | `true` refuses the self-signed fallback. **Set it in staging and production** |
| `EIA_SSL_CN`, `EIA_SSL_SAN`, `EIA_SSL_DAYS` | the self-signed fallback only |

### Rotation

A server certificate is replaced by swapping the mounted pair and restarting the resource; the
volume is untouched. The CA is a longer operation, because every application container must trust
the new one before any database presents it: distribute the new `ca.crt` alongside the old (a
concatenated file is a valid `sslrootcert`), reissue and deploy the server certificates, then
remove the old CA. Doing it in the other order takes the workspace down.

## 3. Deployment model

```
Cinta Vera / EIA Studio
├── demo        application (web + worker)   ·   postgres resource
├── staging     application (web + worker)   ·   postgres resource
└── production  application (web + worker)   ·   postgres resource      ← not created
```

The application compose declares `web` and `worker` and **no database**. Each PostgreSQL is a
separate Coolify resource on the same host with:

- the private `coolify` Docker network only, **no published port**;
- its own named volume;
- its own superuser credential (the migrator) and its own runtime login role;
- `eia_app` and `eia_policy` created by migration 0000; the runtime role `NOBYPASSRLS`, member of
  `eia_app`, owning no schema.

The application stack needs `connect_to_docker_network = true`, set by a `PATCH` after creation —
the service-creation endpoint rejects the field. Without it the stack is isolated on its own
network and the worker fails with `getaddrinfo ENOTFOUND`.

## 4. Roles

| Role | Login | Attributes | Purpose |
|---|---|---|---|
| migrator (the resource's superuser) | yes | superuser | migrations and role provisioning only |
| `eia_app` | no | `NOBYPASSRLS` | the group the grants hang from |
| `eia_policy` | no | **`BYPASSRLS`** | owns the SECURITY DEFINER helpers used inside RLS policies |
| `eia_app_<env>` | yes | `NOBYPASSRLS`, member of `eia_app`, owns no schema | web and worker |

A self-hosted PostgreSQL gives `eia_policy` its `BYPASSRLS` without argument, which was the open
technical risk of every managed candidate.

## 5. Backup and point-in-time recovery

Two mechanisms, deliberately, because they fail differently.

**Continuous — pgBackRest → R2.** Installed in the image, configured per environment. Its own
bucket and its own credential, never the application's object store and never shared between
environments. Sketch, to be completed in the migration wave:

```ini
# /etc/pgbackrest/pgbackrest.conf
[global]
repo1-type=s3
repo1-s3-endpoint=<account>.r2.cloudflarestorage.com
repo1-s3-uri-style=path
repo1-s3-bucket=<per-environment bucket>
repo1-s3-region=auto
repo1-retention-full=2
repo1-cipher-type=aes-256-cbc      # the repository is encrypted at rest with our own key

[eia]
pg1-path=/var/lib/postgresql/data
```

with `archive_mode = on` and `archive_command = pgbackrest --stanza=eia archive-push %p`.

Restore is one command with a target time: `pgbackrest --stanza=eia --type=time --target=… restore`.

### The staging archive, concretely

Three buckets, and none of them is either of the two that already exist:

| Bucket | Holds | Credential |
|---|---|---|
| `syntavera-eia-staging` | application objects — documents, media, templates | the application's |
| `syntavera-coolify-backups` | Coolify's `pg_dump` files | Coolify's |
| **`syntavera-eia-staging-pgbackrest`** | **the WAL archive and base backups** | **its own, pgBackRest only** |

Sharing any of them would mean one credential that can both write a study's documents and delete
the archive that would recover them.

**Configuration**, mounted as a file at `/etc/pgbackrest/pgbackrest.conf`:

```ini
[global]
repo1-type=s3
repo1-s3-endpoint=<account>.r2.cloudflarestorage.com
repo1-s3-uri-style=path
repo1-s3-bucket=syntavera-eia-staging-pgbackrest
repo1-s3-region=auto
repo1-path=/staging
repo1-retention-full=2
repo1-retention-full-type=count
repo1-retention-archive=2
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=<from the environment, never in this file>
process-max=2
log-level-console=info
log-level-file=off
start-fast=y

[eia]
pg1-path=/var/lib/postgresql/data
```

`repo1-cipher-type` matters: R2 holds the archive, so the repository is encrypted with a key of
ours before it leaves the host. Losing that passphrase loses the archive, so it is backed up
beside the CA key and never beside the data.

**PostgreSQL**, as extra flags on the resource:

```
archive_mode = on
archive_command = 'pgbackrest --stanza=eia archive-push %p'
archive_timeout = 60          # bounds the RPO when the database is idle
max_wal_size = 2GB
wal_level = replica
```

`archive_timeout = 60` is what actually delivers the five-minute RPO: without it an idle database
can sit on a partly-filled WAL segment indefinitely, and the archive would be as stale as the
last write burst rather than as stale as the last minute.

**Secrets**, as environment variables on the database resource, never in the config file:
`PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`.

**Persistent paths**: `/var/lib/pgbackrest` (the stanza's local state and spool) must be a volume.
Without it, a container restart loses the spool and the next `archive-push` re-reads from the
beginning.

**Bring-up order**, which is not optional: create the stanza (`pgbackrest --stanza=eia
stanza-create`), take the first full backup, and only then set `archive_command`. Turning on
archiving before a stanza exists makes every `archive-push` fail, and PostgreSQL retries a failing
`archive_command` forever while WAL accumulates until the disk fills.

**Monitoring**: `pgbackrest --stanza=eia check` on a schedule. An archive that silently stopped is
the failure mode that matters, because it is invisible until the restore.

**Daily — Coolify `pg_dump` → R2.** Already configured for staging; retention 7 in S3, 0 local. It
stays. A logical dump survives a corrupted WAL archive, and a WAL archive survives a dump that
silently truncated.

**RPO.** `PRODUCTION_RECOVERY.md` §2 requires ≤ 5 minutes. Only continuous archiving meets it.
Until it is configured the effective RPO is 24 hours, and saying otherwise would be a claim
nobody could cash.

**A backup is not validated until it has been restored.** The procedure, and two things it is easy
to get wrong, are in §5 of `PRODUCTION_RECOVERY.md`; both were found by doing it:

1. **A `pg_dump` of one database does not carry roles.** Create `eia_app`, `eia_policy` and the
   runtime role in the target *before* restoring, or the 142 policies fail to apply and a restore
   "with errors ignored" leaves a database with no row level security.
2. **Wait for initialisation, not for `pg_isready`.** The entrypoint starts a temporary server,
   which answers `pg_isready`, and then stops and restarts it. A restore begun in that window is
   cut off mid-stream. Wait for `PostgreSQL init process complete` in the log.

## 5a. Migrating an environment to this platform

Written before doing it, from what the restore rehearsal already taught. The shape is **parallel,
never in place**: the current database stays untouched and serving until everything about its
replacement has been checked.

```
current database  ──┐
                    │ verified fresh backup
                    ▼
        new resource, same host, published digest
                    │ roles first, then restore
                    ▼
              verification (nine checks)
                    │
                    ▼
        application switches DATABASE_URL  ──►  smoke
                    │
        old database still running, untouched
```

1. **Backup, and verify the execution** — not the configuration. A `success` row with a byte
   count, not an `enabled: true`.
2. **Create the new PostgreSQL resource** with the published digest, its own volume, its own
   credentials, `is_public: false`. Do **not** set `EIA_SSL_REQUIRE_PROVIDED` yet: there is no
   certificate, and the point of this step is to obtain the resource's UUID.
3. **Read the new UUID.** That is the certificate's SAN and it cannot be known earlier (§2).
4. **Issue the server certificate** for that UUID, off-host, from the CA.
5. **Mount** the pair on the database, set `EIA_SSL_REQUIRE_PROVIDED=true`, restart, and confirm
   `ssl = on` *and* that the log says it used the provided certificate rather than generating one.
6. **Create the three roles** — `eia_app`, `eia_policy` (`BYPASSRLS`), and the runtime login role
   — **before** restoring. A `pg_dump` of one database carries none of them, and without them the
   142 policies fail to apply.
7. **Restore.** Wait for `PostgreSQL init process complete`, not for `pg_isready`. Expect about
   twenty `already exists` errors from PostGIS objects the image pre-creates, and check that they
   are *only* that.
8. **Verify, nine things**: 52 migrations · 71 tables · 71 FORCE RLS · 142 policies ·
   `security_invoker = true` on `app.effective_survey_instance` · PostGIS, pgvector, pg_trgm ·
   runtime role `rolbypassrls = false` · the synthetic tenant and user present · and a client
   connecting with `sslmode=verify-full` reporting `pg_stat_ssl.ssl = true`, with a wrong-CA
   negative control.
9. **Mount the CA** on `web` and `worker`, and confirm the file is readable *in both containers*.
10. **Switch** `DATABASE_URL` and `DATABASE_MIGRATOR_URL` to the new host with
    `?sslmode=verify-full&sslrootcert=/run/eia-ca/cinta-vera-root-ca.crt`, and restart **only the
    application**.
11. **Smoke**: `/health` returns the expected `gitSha`; the worker logs `readiness check passed`;
    the connected role, captured live from `pg_stat_activity`, is the runtime role with
    `rolbypassrls = false`; and the data is there.
12. **Only then** configure pgBackRest (§5), and only after that consider the old resource.

### Rollback

Available at every step until 12, and it is two variables:

1. Set `DATABASE_URL` and `DATABASE_MIGRATOR_URL` back to the old host — without `sslmode`,
   because the old database serves no TLS.
2. Restart the application.
3. The old database is still running, still holds its data, and was never written to during the
   migration.

**The old resource is not deleted in the same wave as the switch.** A migration that destroys its
own rollback the moment it appears to work is not a migration, it is a leap.

## 6. The capacity gate before production

Measured on 30 September 2026: 11 676 MiB host, 6 vCPU; demo + staging hold 8 704 MiB of
configured ceilings and use ~430 MiB; Coolify and its proxy ~500 MiB; disk 9,3 G of 96 G.

Production is **not** created until a load test has been run and recorded. It must exercise, on
this host, with demo and staging running:

| What | Why |
|---|---|
| Web under a realistic concurrent session load | Next.js server rendering is the memory-hungry part |
| Worker processing a document extraction batch | pdf.js holds a whole document in memory |
| PostgreSQL under the analytic read models | the tabulation and report snapshot queries, not `SELECT 1` |
| Peak resident memory per container, and host free memory at peak | ceilings are not reservations; what matters is the peak |
| Peak CPU and load average | 6 vCPU shared by three environments |
| Database connections at peak against `max_connections` | three environments × pool of 10 × web and worker |
| Disk I/O and free space, including WAL accumulation | an archive that stalls fills the disk, and a full disk stops PostgreSQL |
| Object storage throughput during an upload | the path that leaves the host |

**Limits are not lowered to make production fit.** If the measurement says the host is
insufficient, the remedy is vertical expansion of the OVH host (ADR-040 §6).

## 7. What is true today

| | Demo | Staging | Production |
|---|---|---|---|
| Image | `imresamu/postgis:17-3.5-bundle0` | same | — |
| TLS | **off** | **off** | — |
| Backup | none | daily `pg_dump` → R2, restore tested | — |
| PITR | no | no | — |
| Published image adopted | no | no | — |
| CA | does not exist | does not exist | — |

The artefact in this repository is ahead of every deployment, deliberately: ADR-040 prepares it
and migrates nothing.
