# Production recovery

> What has to be true before eight studies depend on this system, and what is true today. Related:
> `docs/DEPLOYMENT.md` §4b (staging's actual backup state), `docs/OBJECT_STORAGE.md`,
> `docs/PRODUCTION_V1_GO_LIVE.md` blocker 4, `docs/SECURITY.md` §12a.
>
> **This document claims no guarantee.** Every row below says either *configured and verified*, or
> *not configured*. A recovery capability nobody has enabled is not a recovery capability, and a
> restore nobody has performed is not a tested restore.

## 0. Status, before anything else

| | State |
|---|---|
| Production environment | **does not exist.** Nothing is deployed to production; production hosting is not decided (`PRODUCTION_V1_GO_LIVE.md` blocker 4) |
| Staging database backups | **none.** `railway postgres pitr schedule set --daily` and the volume-backup mutations are refused for this workspace (`DEPLOYMENT.md` §4b) |
| Staging point-in-time recovery | **not applicable.** PITR runs only inside Railway's own database images; ours is a PostGIS image, and switching would lose PostGIS |
| Object storage | **no bucket exists** in staging or production (TD-090) |
| A restore ever performed | **partly.** The *procedure* was drilled on 18 September 2026 against synthetic local data and passed — §5a records exactly what it proved and what it did not. A **provider** restore has still never been performed, because no provider has been chosen |

Staging is therefore **disposable by design** and says so. Production cannot inherit that, and this
document is the specification the hosting decision has to satisfy — not a description of something
running.

## 1. What has to be recoverable, and what each loss means

| Asset | Where it lives | If it is lost |
|---|---|---|
| Operational database (`app`, `audit`, `portal` schemas) | PostgreSQL | every study: parcels, visits, answers, codings, findings, documents' metadata, AI candidates, templates' metadata, publications. Unrecoverable from anywhere else |
| Identity (`auth` schema) | the same PostgreSQL | nobody can sign in. Recoverable only by re-provisioning every account |
| Delivered documents and photographs | object storage, `documents` / `field-media` | the study's own evidence. **Not** reconstructible: a photograph is a moment |
| Templates and generated drafts | object storage, `templates` / `generated` | a firm's deliverable format, and the drafts already handed to somebody |
| Captured work not yet synchronised | **technicians' phones** | a day of field work per device, and this is the one the database cannot help with |
| Secrets | the platform's environment configuration | nothing is lost; everything stops |

The row that is easy to miss is the fifth. EIA Field holds captured visits, answers and photographs
in an encrypted local database until the server acknowledges them (ADR-028, ADR-032). **A database
restore that rolls back past a sync does not roll the devices back**: the outbox is already empty for
work the restored database has never seen. §5 is about that.

## 2. RPO and RTO — targets, and what they require

Neither is met today, because neither has an environment to be met in.

| | Target | Why this number | What it requires |
|---|---|---|---|
| **RPO** (data that may be lost) | **≤ 5 minutes** for the database | A field day is the unit of work. Losing an hour can mean a technician re-walking a corridor — the one thing this product exists to avoid | continuous WAL archiving, i.e. point-in-time recovery, not nightly dumps |
| **RPO** for object storage | **0** | An object is written once and never changed, so versioning plus replication loses nothing as long as the write itself succeeded | bucket versioning and a lifecycle that does not expire current versions |
| **RTO** (time to serve again) | **≤ 4 hours** | A consultancy can lose a morning; losing a week of eight studies' progress is a different kind of event | a documented restore order (§4), a provider whose restore is self-service, and a rehearsal (§6) |

An **RPO of 5 minutes with no backups at all** is the gap this document exists to name. Today's
effective RPO is *everything since the environment was created*.

## 3. What the provider must offer

The production hosting decision is constrained by this list. A provider that cannot do all of it is
not a candidate, whatever else it offers.

1. **PostgreSQL 16+ with PostGIS and `pg_trgm`**, because the product requires them at startup and
   in CI (`ARCHITECTURE.md` §9.1).
2. **Point-in-time recovery** with WAL archiving, retention **≥ 14 days**, and a restore a person
   can trigger without a support ticket.
3. **Automated daily base backups**, retained ≥ 30 days, stored in a different failure domain from
   the live volume.
4. **S3-compatible object storage** with **versioning** and server-side encryption, and a lifecycle
   rule that expires *non-current* versions rather than current ones.
5. **A documented, self-service restore**, so §6's rehearsal is possible at all.
6. A region acceptable to the compliance review of `SECURITY.md` §10a. That is a legal question this
   document does not answer and must not pre-empt.

## 4. Restore order, and why it is an order

Restoring these out of order produces a system that is running and wrong.

| # | Step | Why here |
|---|---|---|
| 1 | **Stop the worker.** Scale it to zero | It claims queued work — extractions, AI reviews — and a worker running against a half-restored database writes rows nobody asked for |
| 2 | **Put the web application into maintenance**, or scale it to zero | A write accepted during a restore is a write the restore will not contain |
| 3 | **Restore the database** to the chosen point in time | Everything else is keyed to what the database says exists |
| 4 | **Reconcile object storage against the database**, never the other way round | The database is the record of what should exist; §4a is how |
| 5 | **Verify** (§5) before anything is served | A restore nobody checked is a restore nobody can stand behind |
| 6 | **Start the web application** | People can read again |
| 7 | **Start the worker** last | Queued rows the restore brought back are claimed only once a person has confirmed the picture is right |
| 8 | **Announce the recovery point to the field**, explicitly | §6. Technicians must be told, because their devices hold what the restore does not |

### 4a. Reconciling storage against the database

For every `stored_object` row the restored database holds, the object must exist. The reverse is not
an error: an object with no row is an upload whose finalize never committed, and ADR-031 already
treats that as *not a document*.

```sql
-- Objects the database expects. Check each against the bucket; a missing one is a real loss.
select namespace, object_key, size_bytes, sha256
  from app.stored_object
 order by created_at desc;
```

A missing object cannot be regenerated. What it means depends on the namespace: a `documents` object
is a delivered file the consultancy still holds and can re-upload as a new version; a `field-media`
object is a photograph that **existed once**; a `generated` object can be produced again from its
template version and snapshot digest.

### 4b. What must never be part of a restore

- **Never restore `auth` from a different point in time than `app`.** Sessions and memberships would
  disagree, and the disagreement is an authorization one.
- **Never restore one tenant's rows into a live database.** There is no supported partial restore;
  the composite foreign keys and the RLS predicates assume one consistent world.
- **Never re-run seeders against a restored production database.** `pnpm e2e:prepare` and the demo
  seeder are for local and test, and `assertEphemeralTestDatabase` exists because that mistake has
  been made once already (SECURITY.md §12a).

## 5. Verifying a restore

A restore is verified when all of these answer, not when the process exits zero.

| Check | Query or action |
|---|---|
| The database is at the intended point | `select max(occurred_at) from audit.log;` — compare with the chosen recovery point |
| Migrations are complete | `select count(*) from drizzle.__drizzle_migrations;` against the deployed build's expectation, then `pnpm db:check` |
| RLS is on | the migration suite's own check: every table in `app`, `pii`, `portal` has RLS enabled **and forced** |
| Tenancy is intact | `packages/testing/test/rls/wave3-two-projects.integration.test.ts`'s registry, run against a **copy**, never against the restored production database |
| Identity works | one real sign-in, by a person |
| Storage agrees | §4a's list, sampled at minimum; fully for `field-media` |
| The queues are sane | `select status, count(*) from app.document_review_run group by 1;` and the same for `document_version.processing_state`. A pile of `PROCESSING` rows means the stale-release must run before the worker starts |
| Nothing was invented | a spot check that a known finding, a known coding and a known citation still say what they said |

## 6. Field devices, and the outbox problem

This is the part a database backup does not cover, and the part a technician feels.

**If the restore rolls back past a synchronisation**, the server has forgotten work a device has
already had acknowledged. The device's outbox is empty; the work is gone from the server; nobody is
told by any automatic mechanism.

What the design already does:

- `commandId` is generated once at the moment of intent and never regenerated (ADR-028), so
  **re-sending is safe**: `app.field_sync_receipt` replays the same result rather than duplicating;
- a conflict never deletes local work.

What it does not do, and cannot: **a device cannot know the server was restored.** So the procedure
is human, and it is short:

1. Tell every technician the recovery point, in plain terms: *work synchronised before 14:05 is
   safe; anything after that must be sent again*.
2. Technicians who still have the application installed and have **not** signed out: nothing to do
   for pending work; press *Sincronizar ahora* and it drains.
3. For work synchronised **after** the recovery point: it is gone from the server, and the device
   no longer holds it. It must be re-captured. There is no mechanism that recovers it, and saying
   otherwise would be the worst thing this document could do.
4. **Nobody signs out** until the recovery point is announced. Sign-out discards the local database
   (ADR-028), and after a restore that database may hold the only copy of something.

Point 4 is why this is step 8 of §4 and not an afterthought.

## 7. Secrets

| Secret | Rotation | What breaks while it rotates |
|---|---|---|
| `DATABASE_URL` / `DATABASE_MIGRATOR_URL` | on suspected exposure, and when an operator leaves | everything, until both applications are redeployed with the new value |
| `BETTER_AUTH_SECRET` | on suspected exposure | **every session**. Everybody signs in again; no data is affected |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | on suspected exposure, and on a schedule the provider supports | uploads and downloads answer as *not configured* (ADR-031); nothing already stored is lost |
| `AI_GATEWAY_API_KEY` | on suspected exposure | assisted coding, the assistant's prose and AI document review report `BLOCKED_EXTERNAL_CONFIG` and say so. Nothing else stops |

Rules: values live in the platform's environment configuration and never in this repository — only
names (CLAUDE.md rule 20). Rotate the storage credential **before** rotating anything that would
prevent a redeploy. After any rotation, confirm the worker picked it up: its startup log names the
adapter and the availability state without printing a value.

## 8. Incident procedure

1. **Write down the time** and what was observed. An incident's first casualty is the timeline.
2. **Stop writes** before diagnosing — worker to zero, web to maintenance. A diagnosis made while
   the system is still writing is a diagnosis of a moving target.
3. **Decide the recovery point** and say it out loud before restoring, because §6's announcement
   depends on it.
4. Restore in the order of §4; verify with §5.
5. **Announce to the field** (§6) before anybody signs out.
6. Afterwards: what was lost, what the recovery point was, and which of §3's requirements was
   missing. If the answer is "none, the provider did everything", the gap was ours.

## 5a. The restore drill, and what it is worth

`pnpm restore:drill` executes the procedure of §4 on synthetic data, against the local PostgreSQL
container. It refuses to run against anything else — a drill that could be pointed at a deployed
database is the shape of the accident IG3-001 exists to prevent (SECURITY.md §12a).

**Executed 18 September 2026. Result: passed.** What it proved, measured rather than asserted:

| Check | Result |
|---|---|
| Dump and restore into an empty database | 1 078 169 bytes, restored with `--exit-on-error` |
| Migration ledger at the repository's head | repository 52 · restored **52** |
| Row level security survived | 71 tables in `app`/`portal`/`audit`, **71 with RLS enabled, 71 forced**; zero without |
| Policies, triggers and the view | **142** policies, **57** triggers, and `app.effective_survey_instance` restored **with `security_invoker=true`** |
| The application's rows are readable | 3 projects · 141 parcels · 5 submitted responses · 30 answers · 124 audit entries |
| Objects reconcilable against the database | the §4a query runs; 11 `stored_object` rows to check against a bucket that does not exist |

**What it does not prove, and no local drill can:**

- that a **provider's** backup can be restored, because no provider has been chosen (G7 §3);
- that **point-in-time** recovery works, because nothing has WAL archiving today (§0);
- the **RTO** of §2, because restoring 1 MB of synthetic data says nothing about restoring a real
  programme under time pressure;
- that **objects** come back, because there is no bucket.

The value is narrower than "recovery is ready" and worth stating exactly: the restore **order**, the
**verification queries** and the **schema-level guarantees** of §5 are executable and were executed,
rather than being a procedure nobody has ever run. The provider half remains **NOT EXECUTED**.

## 9. What this document does not claim

- That backups exist. They do not (§0).
- That a **provider** restore has been tested. It has not — only the procedure, locally (§5a).
- That the RPO and RTO in §2 are met. They are targets for a decision nobody has made, and §5a's
  drill measures neither.
- That an object-storage lifecycle is configured. There is no bucket.
- That field devices can be recovered. They cannot; §6 is a human procedure, not a mechanism.

Every one of these becomes a claim only when somebody has done it and written the date beside it.
