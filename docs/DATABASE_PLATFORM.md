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

### Creating the CA — once, off the VPS

On a machine the owner controls, with the key never leaving it:

```bash
umask 077
openssl req -x509 -newkey rsa:4096 -nodes -days 3650 \
  -keyout cinta-vera-ca.key -out cinta-vera-ca.crt \
  -subj "/CN=Cinta Vera Labs internal CA"
```

`cinta-vera-ca.key` is the most sensitive file in this platform: whoever holds it can impersonate
any database. Keep it offline, back it up separately from everything else, and never copy it to
the VPS. `cinta-vera-ca.crt` is public and is the file the applications trust.

### Issuing a server certificate

The SAN is the load-bearing part, because `verify-full` verifies the hostname. For a Coolify
resource the hostname is its UUID:

```bash
HOST=<resource-uuid>            # e.g. the staging database's Coolify UUID
umask 077
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=${HOST}"
printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$HOST" > ext.cnf
openssl x509 -req -in server.csr -CA cinta-vera-ca.crt -CAkey cinta-vera-ca.key \
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

**`deploy/coolify/compose.yml` cannot deliver the CA file today** — it declares no mounts. That is
deployment work for the migration wave, not a property of the artefact.

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
