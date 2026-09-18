# Production infrastructure: the decision, and what it costs

> **Nothing here has been purchased, provisioned or deployed.** This is the paper a person needs in
> order to spend money, and it stops at the point where spending starts. Related: ADR-012 (the
> hosting decision), `docs/DEPLOYMENT.md` §4–§4c (what staging actually is),
> `docs/PRODUCTION_RECOVERY.md` (the recovery specification this has to satisfy),
> `docs/PRODUCTION_V1_GO_LIVE.md` blocker 4.

## 0. How to read the costs

Every figure below is a **published list price read on 18 September 2026**. It is not a quotation,
not a commitment and not what the invoice will say. Usage-based components — storage, egress,
compute-hours, map loads — depend on how eight studies are actually used, and nobody has measured
that yet because nobody has run one.

**Re-verify every price before purchase.** They are here so the decision has a shape and an order of
magnitude, not so anybody can budget from them.

## 1. Summary

| Component | Provider | Tier | ≈ / month | Decision |
|---|---|---|---|---|
| Web application | **Vercel** | Pro | $20 / seat | **Keep.** Already running for staging |
| Persistent worker | **Railway** | Hobby → Pro | $5–20 + usage | **Keep.** Already running for staging |
| PostgreSQL + PostGIS | **Neon** (recommended) | Launch + instant restore | ~$25–40 | **Change.** The current image cannot do PITR — §3 |
| Object storage | **Cloudflare R2** (recommended) | pay-as-you-go | ~$1–5 | **New.** Nothing exists — §4 |
| Reference basemap | **MapTiler** | **Custom contract required** | to be quoted | **Blocker.** Free and Flex forbid commercial use — §5 |
| Mobile distribution | **EAS** | Free → Production | $0–99 | **New.** No account exists — §6 |

Approximate floor, excluding the MapTiler contract and any Apple/Google fees: **$50–85 per month**.

**Two of these are not engineering decisions.** The database has a hard technical blocker (§3) and
the basemap has a licensing one (§5). The rest is filling in accounts.

## 2. Web application — Vercel

| | |
|---|---|
| **Provider** | Vercel. Already hosting the staging deployment of `apps/web` |
| **Tier** | Pro, $20 per seat per month |
| **Region** | Function region to be set explicitly; `iad1` (US East) is the default, and §7 is the question of whether it should be |
| **Backups** | n/a. The application is stateless; the repository is the artefact |
| **Storage limits** | n/a |
| **Scaling** | Per-request, automatic. Eight studies with a handful of consultants each is far below any threshold that matters |
| **Observability** | Vercel's own logs plus the application's structured logging. OpenTelemetry is specified (ARCHITECTURE §8) and **not wired up** |
| **Failure mode** | The workspace is unreachable → nobody can use the web application. Field capture **continues offline** and syncs when it returns (ADR-028), which is the property that makes this tolerable |
| **Owner action** | Confirm the plan and create the production project. Today the Vercel **production environment has zero variables**, which is the honest state of "production does not exist" |
| **Why** | It is already there, the portability constraints of ARCHITECTURE §9.1 are respected (the app builds to a container and depends on no Vercel SDK), and moving it would be work with no beneficiary |

## 3. PostgreSQL + PostGIS — the one component that must change

### The blocker, stated factually

Staging runs a **custom PostGIS image** (`docker/postgres/Dockerfile`, from `imresamu/postgis:17-3.5`
plus PGDG's `postgresql-17-pgvector`) on a Railway volume. Verified on 17 September 2026 with the
Railway CLI and recorded in `docs/DEPLOYMENT.md` §4b:

| Mechanism | State | Why |
|---|---|---|
| Scheduled / manual volume backups | **Not available** | The schedule mutation and the on-demand backup mutation are both refused for this workspace |
| Point-in-time recovery | **Not applicable** | Railway's PITR runs only inside its own database images (`postgres-ssl`, `postgres-patroni`). Neither ships PostGIS |

So: **Railway can give us PostGIS or PITR, not both.** `PRODUCTION_RECOVERY.md` §2 sets an RPO of
five minutes, which is WAL archiving, which is PITR. The current arrangement cannot meet it, and no
amount of configuration changes that. Production needs a different database provider.

### Recommendation: Neon

| | |
|---|---|
| **Provider** | Neon (managed Postgres) |
| **Tier** | Launch, pay-as-you-go: storage $0.35/GB-month, **instant restore $0.20/GB-month**, up to **7 days** history. Scale raises history to 30 days |
| **≈ / month** | $25–40 for a database of this size. Verify at purchase |
| **Region** | To be chosen — see §7. Neon offers US, EU and South America regions |
| **Extensions** | **Verified from Neon's own extension list, 18 September 2026**: `postgis` (3.3.3–3.6.0), `postgis_topology`, `vector` (0.8.0–0.8.6), `pg_trgm` 1.6. All four the product requires |
| **Backups / PITR** | Instant restore is Neon's PITR. 7 days on Launch, 30 on Scale. This is what makes it the candidate |
| **Retention for the target RPO** | 7 days clears `PRODUCTION_RECOVERY.md` §3's *≥ 14 days* only on **Scale**. §3 says fourteen; Launch gives seven. **That is a real gap and a decision**: raise the tier, or amend §3 with a reason |
| **Scaling** | Autoscaling compute, scale-to-zero available. A field campaign is bursty by nature, which suits it |
| **Observability** | Neon's console metrics plus `pnpm ops:doctor` against the database |
| **Failure mode** | Database unreachable → the web application and the worker stop; devices keep capturing offline. A restore is self-service, which §6 of the recovery doc requires |
| **Owner action** | **One free check decides this**, before any money: create a free Neon project and run `DATABASE_MIGRATOR_URL=… pnpm db:migrate` against it. §8 says why |
| **Why** | It is the only candidate examined that offers PostGIS, pgvector and self-service PITR together, which is precisely the combination `PRODUCTION_RECOVERY.md` §3 demands |

### The alternative that was priced and not chosen

**Supabase**: PostGIS and pgvector yes, but PITR is **$100/month on top of the $25 Pro plan** for
seven days' retention — roughly four times Neon's for the same guarantee at this data size. It
remains a reasonable fallback if the Neon check of §8 fails.

**Self-managing PostGIS on a VM with pgBackRest** would work and is rejected on the same grounds
`DEPLOYMENT.md` §4b gives: *a provider that offers PostGIS, pgvector and PITR together is the
straightforward answer; a self-built image is not*. Somebody would have to operate it, and there is
no somebody.

## 4. Object storage

| | |
|---|---|
| **Provider** | **Cloudflare R2** recommended; any S3-compatible provider works — the product talks to one port and no provider SDK reaches `packages/domain` (ARCHITECTURE §9.1) |
| **Tier** | Pay-as-you-go: storage per GB-month, **zero egress fees**, Class A/B operation charges |
| **≈ / month** | $1–5. This programme's files are documents and photographs, measured in gigabytes rather than terabytes |
| **Region** | R2 is location-hinted rather than regional; see §7 |
| **Backups** | **Object versioning must be enabled** — `PRODUCTION_RECOVERY.md` §3 requires versioning with a lifecycle that expires *non-current* versions rather than current ones. A field photograph is a moment and is not reconstructible |
| **Storage limits** | None that matter here |
| **Scaling** | n/a |
| **Observability** | Provider metrics; the application reports `resolveStorageAvailability` through `ops:doctor` |
| **Failure mode** | Unreachable → uploads and downloads answer *not configured* and **nothing already stored is lost**. The product never falls back to a temporary store, deliberately (ADR-031) |
| **Owner action** | Create the account and bucket, then set six variables on **both** the web project and the worker. `docs/OBJECT_STORAGE.md` §7 is the four-step activation |
| **Why R2** | Zero egress is the differentiator: every document download and every photograph a reviewer opens is egress, and on a per-GB-egress provider that is the bill that grows without anybody deciding it should |

### 4a. Storage recovery settings (G2.1)

To be set **at creation**, before any object exists:

| Setting | Required value | Reason |
|---|---|---|
| Public access | **Disabled.** No anonymous read, no public bucket | Every read is a short-lived presigned URL minted after `requirePermission` |
| Object versioning | **Enabled** | `PRODUCTION_RECOVERY.md` §2: RPO 0 for objects, which versioning plus replication gives |
| Lifecycle | Expire **non-current** versions after a retention the privacy review sets. **Never expire current versions** | Expiring a current version deletes a study's evidence |
| Server-side encryption | **Enabled** | SECURITY.md §7 |
| Credential | **Least privilege**: `GetObject`, `PutObject`, `HeadObject`, `DeleteObject`, `ListBucket` on **this bucket only**. No account-level key, no bucket creation, no policy modification | A key that can create buckets is a key that can create a public one |
| Lifecycle to archive / cold tiers | **Not enabled.** A paid decision nobody has taken | The hard stop |

## 5. Reference basemap — a licensing blocker

| | |
|---|---|
| **Provider** | MapTiler. A `MAPTILER_KEY` exists in the Vercel **Preview** environment; production has none |
| **Tier** | **Published terms read 18 September 2026**: Free (5,000 sessions, *"testing, personal or non-commercial use"*) and Flex ($30/month, 25,000 sessions) **do not permit commercial use**. Only a **Custom prepaid contract** does |
| **≈ / month** | **Unknown — must be quoted.** A consultancy delivering paid studies to a government customer is commercial use by any reading |
| **Failure mode** | Already handled: no key configured → the GIS surface renders *sin fondo*, every layer, the selection and both legends intact. A revoked key behaves the same way, and there is an e2e project that proves it |
| **Owner action** | **Contact MapTiler for a commercial quotation**, or choose an alternative whose licence permits commercial use, and restrict the production key by origin |
| **Why it is flagged** | This is the one line item that could be assumed settled because a key already exists. It is not: the key that works is not necessarily a key that may be used |

An acceptable alternative is any basemap whose terms permit commercial use; the product reads a tile
URL template and one key from configuration, so changing provider is configuration, not code.

## 6. Mobile distribution

| | |
|---|---|
| **Provider** | Expo Application Services (EAS) |
| **Tier** | Free tier exists and is enough for internal Android builds. Production plan $99/month if build concurrency or store automation is wanted |
| **≈ / month** | $0 to start |
| **Backups** | n/a |
| **Failure mode** | No build → no field capture on a phone. The web capture channel still works, but not offline |
| **Owner action** | Create an Expo account, run `eas init` in `apps/field` to mint `extra.eas.projectId`, then `eas build -p android --profile staging` for an internal APK. §6 of `docs/FIELD_MOBILE_BUILDS.md` has the sequence |
| **Store accounts** | Apple Developer $99/year, Google Play $25 once. **Both are identity actions requiring the owner's own details and payment method** and neither is needed for UAT — an internal APK is enough |
| **Why** | The application is already an Expo project and `eas.json` already declares the three profiles |

## 7. Region and data residency

**Deliberately left open**, because it is not an engineering choice.

Staging runs in Railway's `us-west2`. The compliance review of `SECURITY.md` §10a has not stated
whether Ecuadorian personal data may be processed outside Ecuador, under what conditions, or whether
the client's contract says anything about it. Choosing a region now would be answering a legal
question by picking a dropdown.

**What is required**: §4 of the privacy checklist decides residency; then every component in §1 is
provisioned in a region consistent with that decision, and the decision is recorded here with a
date. Neon, R2 and Vercel each offer several; the constraint is likely to be the database.

## 7.1 Production security configuration checklist

To be worked through when production is created. None of it is done.

| | Item | Required state |
|---|---|---|
| ☐ | Production hostname | A domain the consultancy controls. Not a `*.vercel.app` preview URL |
| ☐ | TLS | Provider-managed certificate; HTTPS only |
| ☐ | `BETTER_AUTH_URL` / `PUBLIC_APP_URL` | The production origin, exactly |
| ☐ | `AUTH_TRUSTED_ORIGINS` | The production origin **and** the literal `eiafield://`. No wildcard scheme |
| ☐ | `DATABASE_URL` (runtime role) | `eia_app_login`, **no BYPASSRLS**, and `sslmode=verify-full` — the contract refuses to start otherwise when `APP_ENV=production` |
| ☐ | `DATABASE_MIGRATOR_URL` (migrator role) | Separate credential, never used by the application, also `verify-full` |
| ☐ | Worker configuration | Same database, its own `PUBLIC_APP_URL`, health port, and the **same storage bucket as the web app** |
| ☐ | `STORAGE_*` | Six variables, on **both** services, naming one bucket (§4) |
| ☐ | MapTiler production key | A commercially licensed key (§5), **restricted by origin** to the production hostname |
| ☐ | Mobile `EXPO_PUBLIC_API_URL` | The production origin in `eas.json`'s production profile. It is currently the literal `https://REPLACE-WITH-PRODUCTION-HOST`, and `pnpm go-live:doctor` says so |
| ☐ | Staging / production secret separation | **Different values for every secret.** A shared `BETTER_AUTH_SECRET` makes a staging session valid in production |
| ☐ | Secret rotation | An owner per secret and a first rotation date. `PRODUCTION_RECOVERY.md` §7 has the order and the blast radius of each |
| ☐ | CORS | The application serves its own origin; no cross-origin API is exposed. Confirm nothing was widened for a preview |
| ☐ | Audit logging | `audit.log` writes in the same transaction as the mutation; confirm it is non-empty after the first real action |
| ☐ | Operator access | Who holds the migrator credential and the provider consoles, and where that is written down |
| ☐ | **AI selectors** | **`SOCIAL_CLASSIFIER`, `ASSISTANT_GENERATOR` and `DOCUMENT_REVIEWER` remain unset** until the privacy review authorises a vendor. Unset means unavailable, not faked (IG4-001) |

## 8. Backups and point-in-time recovery — factual state (G7.2)

**Determined, not inferred.**

| Environment | Automated backup | PITR | Retention | Verified |
|---|---|---|---|---|
| Staging today | **No.** Both Railway mutations refused for this workspace | **No.** Railway PITR does not support a custom PostGIS image | — | 17 Sep 2026, Railway CLI |
| Production today | **Does not exist** | — | — | Vercel production environment holds zero variables |
| Neon Launch (proposed) | Yes | **Yes** — instant restore | **7 days** | 18 Sep 2026, Neon's published pricing |
| Neon Scale | Yes | Yes | **30 days** | same |

**The open question**: `PRODUCTION_RECOVERY.md` §3 requires **≥ 14 days**. Launch gives seven. Either
the tier goes to Scale, or §3 is amended with a stated reason. Left as a decision rather than
silently resolved.

### The check that decides the database, and costs nothing

Before any money changes hands, one thing must be proven: **can the migrator connection create the
`eia_policy` role with `BYPASSRLS`?** Migration 0000 needs it — the SECURITY DEFINER membership
helpers used inside every RLS policy are owned by that role. Neon's `neon_superuser` documents
`CREATEROLE` and `BYPASSRLS`, and in PostgreSQL 16+ a `CREATEROLE` role may grant only attributes it
holds itself, so it *should* work. **Should is not verified.**

```bash
# On a FREE Neon project. No payment, no commitment.
export DATABASE_MIGRATOR_URL='postgres://…?sslmode=verify-full'
pnpm db:migrate        # must reach 52 of 52
pnpm db:check          # must report no drift
```

If that succeeds, Neon is the answer and the rest is paperwork. If it fails, Supabase is next and
the same check applies.

## 9. What this document does not do

- It does not purchase, provision or deploy anything.
- It does not choose a region; §7 says why that is not ours to choose.
- It does not claim a price. Every figure is a list price read on one day and must be re-verified.
- It does not treat the MapTiler key that works today as a key that may be used commercially.
- It does not call recovery ready. That needs a restore somebody actually performed
  (`PRODUCTION_RECOVERY.md` §6), and nobody has.
