# Backup and recovery — four different things that are often confused

Conflating these is how an organisation discovers, during an incident, that it backed up the
wrong thing.

## 1. Coolify control-plane backup — done

What Coolify itself knows: projects, resources, settings, encrypted saved credentials, deployment
history. Daily to Cloudflare R2, bucket `syntavera-coolify-backups`, retention 30, S3-only by
owner decision so the VPS keeps its storage for operational data. The `APP_KEY` that decrypts the
saved credentials is **not inside the dump** and is held outside the VPS.

**This is not an EIA Studio backup.** Restoring it brings back Coolify's knowledge of what should
be running, and none of EIA Studio's data.

## 2. Application database backup — does not exist yet

One policy per environment.

**Demo**: reproducibility beats backup. The recovery objective is *reseed*: destroy, migrate,
seed. `docs/EIA_DEMO_RUNBOOK.md`.

**Staging**: enough to validate that the production procedure works. A staging restore that has
never been rehearsed does not validate anything.

**Production**: off-host, mandatory, with point-in-time recovery.
`docs/PRODUCTION_RECOVERY.md` §2 sets an RPO of five minutes, which means WAL archiving.

`docs/PRODUCTION_INFRASTRUCTURE_DECISION.md` established, with evidence, that Railway serves
PostGIS **or** PITR and never both. Self-hosting on OVH does not solve that; it makes it ours.
If staging and production are self-hosted, **pgBackRest or WAL-G with an off-host repository, plus
a rehearsed restore, become mandatory gates** rather than follow-up work. Neither tool has been
verified against this project's custom PostGIS image, which ships its own entrypoint for TLS.

## 3. Object storage durability — a different guarantee

An S3-compatible provider's durability is not a backup: it protects against disk failure, not
against deletion, a bad migration or a mistaken key prefix. Versioning and lifecycle rules on the
buckets are a separate decision, and the four buckets — demo, staging, production, backups — do
not exist yet.

## 4. Application data restore — untested

**A backup verified is not a restore verified.** The only rehearsal so far is
`pnpm restore:drill`, which ran and passed against synthetic local data: 52 migrations, 71 tables
all FORCE RLS, 142 policies, the effective-response view back with `security_invoker`. It claims
nothing about a provider restore nobody can perform yet.

## Status

| | State |
|---|---|
| Coolify control plane | **backed up off-site and verified** |
| Demo database | reseed procedure documented; no backup by design |
| Staging database | **no policy yet** |
| Production database | **no policy, no provider, no PITR — a production blocker** |
| Object storage | **no buckets, no versioning decision** |
| Restore drill | **PENDING** — against a disposable instance, never production |
| Recovery bundle | **PENDING** — APP_KEY, Coolify's SSH material, custom configuration, version, instructions |
