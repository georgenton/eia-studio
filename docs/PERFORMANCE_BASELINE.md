# Performance baseline

> Measured on 4 September 2026, during the sustained MVP development wave, on `main` at `b8e9fc0`
> plus the instrumentation of `feat/mvp-integration-demo-hardening`.
>
> This document **measures**; it does not propose an infrastructure change. Every remedy it names
> is written as a candidate with its cost, and the two that would move a database or change a
> hosting region are marked as decisions for the owner, not for this wave.

## 1. Why this exists

A manual review of the staging Preview saw one request fail with `read ECONNRESET` on a Better
Auth session query against PostgreSQL. One error is not a diagnosis, and the tempting response —
move the database, add a cache, change the runtime — would have been a redesign built on a single
observation. This is the measurement that has to come first.

## 2. What was measured, and how honestly

| | |
|---|---|
| Instrumentation | `apps/web/lib/timing.ts`: a per-process counter fed by the pg pool's `onQuery` hook (`packages/db/src/client.ts`), flushed by `after()` into one pino line per rendered route, at `debug` level so it is silent unless asked for |
| What it records | durations and counts — **never** SQL text, parameters or identifiers of what was read, because a query's parameters carry survey answers |
| Driver | `pnpm perf:baseline` (`tooling/scripts/perf-baseline.mjs`): signs in as one synthetic demo identity, warms each route 3 times, then samples it 12 times, **serially** |
| Why serially | the counter is per process, so per-route attribution is exact only with one request in flight. Under concurrent traffic the totals stay true and the attribution blurs. This measures the *shape* of a page, which does not change with load |
| Local target | `next start` (production build) against the local PostGIS container — sub-millisecond database RTT, so the numbers isolate **structure** from **geography** |

**What is not measured here.** End-to-end latency on the Vercel Preview: its deployment protection
answers `302` before a request reaches the application, so an unauthenticated probe measures
Vercel's edge and nothing of ours, and signing in would need the staging demo credential (§7).

## 3. Where the pieces run

| Piece | Region | Evidence |
|---|---|---|
| `apps/web` functions | **`iad1`** (US East, Washington DC) | `x-vercel-id: iad1::…` on every Preview response |
| PostgreSQL (`postgres-gis`) | **`us-west2`** (US West) | `.railway/railway.ts:27` |
| `apps/worker` | `us-west2`, same project, reaches the database on Railway's **private** network | `.railway/railway.ts`, `DATABASE_URL` host `postgres-gis.railway.internal` |

The web app and its database are therefore on **opposite coasts**, and the web app reaches the
database through Railway's **public TCP proxy** (`*.proxy.rlwy.net`), not the private network. The
worker does not have this problem; only the surface a person looks at does.

## 4. Connection configuration, as it actually stands

| Setting | Web | Worker | Source |
|---|---|---|---|
| `max` | 10 per instance | 2 | `apps/web/lib/db.ts`, `apps/worker/src/main.ts:35` |
| `idleTimeoutMillis` | 10 000 (pg default) | 10 000 | not set by us; `pg-pool@3.14.0` default |
| `connectionTimeoutMillis` | **0 — wait forever** (pg default) | 0 | not set by us |
| `statement_timeout` | **not set** | not set | no `options` in the connection string |
| TLS | `sslmode=no-verify` | same | staging only; production must be `verify-full` (DEPLOYMENT.md §4c, TD-016) |

Two of these are relevant to the reported error. A pooled connection that has been idle is closed
after 10 s by the pool itself, which is the *safe* direction; but `connectionTimeoutMillis = 0`
means a request that cannot obtain a connection waits indefinitely rather than failing fast, and
with no `statement_timeout` a slow query holds its connection for as long as it takes. Neither
*causes* an `ECONNRESET`; both make one harder to attribute and slower to recover from.

## 5. The measurement

Local production build, local database. `q` is database round trips; `ctxQ` is the share of them
spent establishing who is asking; `dbMs` is time inside the driver; all figures are medians of 12.

| Route | q | ctxQ | page q | dbMs | total ms | db share |
|---|---:|---:|---:|---:|---:|---:|
| Portfolio `/t/[tenant]` | 37 | 14 | 23 | 20.9 | 33.6 | 62 % |
| Command Center `/t/[tenant]/p/[project]` | 62 | 17 | 45 | 130.7 | 152.4 | 86 % |
| GIS `/gis` | 49 | 17 | 32 | 112.2 | 148.6 | 76 % |
| FieldFlow `/field` | 50 | 17 | 33 | 30.6 | 40.5 | 76 % |
| **Social `/social`** | **95** | 17 | **78** | **376.8** | **397.9** | 95 % |
| Quality Gate `/quality` | 46 | 17 | 29 | 22.1 | 30.7 | 72 % |
| Documents `/documents` | 44 | 17 | 27 | 30.6 | 42.3 | 72 % |
| Reports `/reports` | 45 | 17 | 28 | 26.8 | 38.3 | 70 % |

Session resolution, separately, is cheap in itself: **2,4–3,2 ms** for the Better Auth session
lookup and **1,3–2,0 ms** to reconcile the application user row, on a local database.

## 6. What the numbers say

**Finding 1 — every page makes 37 to 95 database round trips, and 17 of them are spent deciding
who is asking.** That is the same 17 on every project route, before the page reads anything of its
own.

**Finding 2 — 12 of those 17 are transaction framing, not data.** `buildRequestContext` opens
**four separate transactions** — reconcile the user, resolve the tenant, resolve tenant
capabilities, resolve the project with its memberships and overrides — and each one costs `BEGIN`,
the five-part `set_config` statement, and `COMMIT` before it asks a question. Four transactions ×
3 framing statements = 12; the questions themselves are about 5.

**Finding 3 — the cost is round-trip *count*, not round-trip latency.** On a database with
sub-millisecond RTT, 62 % to 95 % of a route's wall clock is already inside the driver. Geography
multiplies a number that is too large to begin with.

**Finding 4 — Social is the outlier by a factor of nine.** 78 page queries and 377 ms of database
time locally. Deterministic tabulation reads answers per question and per option; it is arithmetic
done in many small queries rather than one.

**Finding 5 — the coasts.** With functions in `iad1` and the database in `us-west2`, a round trip
between them is on the order of 60–70 ms rather than 0,3 ms. Sequential round trips at that cost
put Command Center in the seconds and Social far worse. This is a **projection**, explicitly not a
measurement — §7 says how to turn it into one — but it is the projection that explains why a page
felt slow and why one connection was reset.

**What the `ECONNRESET` most likely was.** A single connection failure on a long-haul TCP path
through a public proxy, on a connection the pool believed was healthy. It is a symptom of a
high-latency, high-count path over public networking, not evidence of a database fault. Nothing in
the measurement suggests capacity trouble: the pool's `max` is 10 and no route needs more than one
connection at a time.

## 7. What would turn the projection into a measurement

The instrumentation ships in the same commit as this document, so a Preview deployment already
writes one `perf` line per rendered route. What is missing is a way to *reach* the protected
Preview as a signed-in user:

0. Set `LOG_LEVEL=debug` on the Preview deployment, or the timing lines are not emitted.
1. Sign in to the Preview as one of the synthetic demo identities (the credential is
   `DEMO_USER_PASSWORD`, held by the owner and never committed).
2. Walk the eight routes once each.
3. `vercel logs <deployment-url>` and read the `perf` lines: `db.queries` will be identical to §5,
   and `db.ms` will be the real cross-coast cost.

Or, without a human: enable Vercel's automation bypass secret for the project and run
`PERF_BASE_URL=<preview> pnpm perf:baseline` with the bypass header. That is an account settings
change and is the owner's to make, not this session's.

## 8. Candidate remedies

Ordered by how much they buy against how much they risk. **None was implemented when this was
written**; candidate 1 has since been applied in its own change, with its own isolation tests, and
§10 reports what it measured. The rest stand: two change a query layer that isolation tests guard,
and two are infrastructure decisions the brief reserves for the owner.

| # | Candidate | Buys | Costs and risk |
|---|---|---|---|
| 1 | ~~Build the request context in **one transaction** instead of four~~ | **Applied**, in its own change with its own isolation tests. See §10 for what it actually bought. **TD-064 closed** |
| 2 | Batch Social's tabulation into fewer statements | the 78-query route is the worst offender by far | the tabulation's denominators are declared per question and asserted by tests; rewriting the queries must not change a single figure. **TD-065** |
| 3 | Cache the capability and membership resolution for the life of a request | removes repeated reads of the same rows within one render | correctness risk is real: a stale capability is an authorization decision made on old data. Only safe request-scoped, never across requests. **TD-066**, now narrower: §10 removed the two duplicate reads a render actually made, by *returning* what had already been read rather than by caching anything |
| 4 | Set `connectionTimeoutMillis` and a `statement_timeout` | a stuck request fails fast and legibly instead of hanging | small, safe, and does not make anything faster — it makes failures diagnosable. **TD-067** |
| 5 | Put the web functions in the database's region (or the database in `iad1`) | would divide the projected latency by roughly the number of round trips | **owner decision, hard stop.** A database region migration is destructive-adjacent and explicitly reserved. Measure §7 first; the count should come down before geography is spent on it |

The order matters: **fixing the count is worth more than fixing the distance**, because a page that
needs 17 round trips to know who you are is slow in every region.

## 9. What this baseline is not

It is not a load test, not a Core Web Vitals report, and not a claim about production — there is no
production. It measures eight server-rendered routes of one synthetic project with 141 parcels,
4 submitted responses and 6 documents. A project ten times larger would change §5 and would not
change §6.

## 10. What the merged transaction bought (4 September 2026)

Candidate 1 was applied on `feat/request-context-performance`. Measured the same way as §5 — the
same driver, the same machine, the same seeded project, 6 warm-up requests and 10 samples per route
— against `main` immediately before the change and the branch immediately after.

| Route | Context round trips | | Total round trips | | Median ms | |
|---|---|---|---|---|---|---|
| | before | after | before | after | before | after |
| Portfolio | 14 | **9** | 37 | **24** | 37,8 | **25,1** |
| Command Center | 17 | **12** | 62 | **49** | 128,1 | **116,1** |
| GIS | 17 | **12** | 49 | **36** | 116,1 | **115,3** |
| Field Surveys | 17 | **12** | 50 | **37** | 40,3 | **39,2** |
| Social | 17 | **12** | 93 | **80** | 175,8 | **161,4** |
| Quality Gate | 17 | **12** | 46 | **33** | 32,5 | **27,5** |
| Documents | 17 | **12** | 44 | **31** | 34,2 | **28,9** |
| Reports | 17 | **12** | 44 | **31** | 33,7 | **26,3** |

**Every project route spends five fewer round trips deciding who is asking, and thirteen fewer
overall.** The five are the framing of three transactions that no longer exist; the other eight are
two reads that no longer happen at all — the application user row was being reconciled twice per
render (once before the context and once for the user menu's display name), and the shell was
re-reading the tenant capability rows the authorization path had just read.

**Wall clock barely moved, and §6 predicted that.** Locally the database is a container with
sub-millisecond round trips, so removing thirteen of them saves a few milliseconds. The figure that
matters is the count, because it is the count that geography multiplies: on the projected 60–70 ms
transatlantic path of §6 finding 5, thirteen fewer sequential exchanges is on the order of eight
tenths of a second per page.

**The region measurement is still owed.** §7 remains unperformed: the Preview answers 302 before a
request reaches the application, and signing in needs the owner's credential. The count came down
first, which is the order §8 argued for.

## 11. Re-measured after the demo-readiness wave (5 September 2026)

Same driver, same machine, same seeded project, 6 warm-ups and 10 samples per route, comparing
`main` at `dbf6bcc` with the branch that made these two changes.

| Route | Round trips | | Median ms | | First hit (cold) |
|---|---:|---:|---:|---:|---:|
| | before | after | before | after | after |
| Cartera de proyectos | 24 | 24 | 26,8 | 26,9 | 189 |
| Centro de control | 49 | **45** | 110,8 | **102,0** | 107 |
| Cartografía y predios | 37 | **33** | 135,7 | **132,3** | 245 |
| Trabajo de campo | 37 | **33** | 36,9 | **28,7** | 34 |
| Análisis social | 85 | **81** | 230,9 | **217,1** | 240 |
| Control de consistencia | 33 | **29** | 29,0 | **21,2** | 34 |
| Documentos | 31 | **27** | 32,3 | **25,4** | 35 |
| Plan de Manejo | — | 29 | — | 45,7 | 49 |
| Informes | 31 | **27** | 26,8 | **18,6** | 24 |

**Four fewer round trips on every project page, and one honest reason.** Every workspace page
renders a tenant name, a project switcher and a breadcrumb, and every one of them called
`loadPortfolio` to get them — a read that also fetches metrics, attention items, the activity feed
and all of their provenance records so that the *Portfolio page* can draw cards. `loadWorkspaceHeader`
asks for the two things the shell needs. Same permission, same context, narrower query.

**The context phase is unchanged at 12** (9 on the Portfolio). It was brought down from 17 in the
previous wave and there is nothing further to take out of it that would not weaken the envelope.

**Cold and warm are now reported separately.** The first hit of a route costs 25–245 ms more than
its median — Next.js compiling and the pool opening its first connection. It is not noise to be
warmed away: a reviewer opening a page nobody has opened today pays it.

**Social is the outlier, and it grew on purpose.** 85 round trips and ~230 ms: the tabulation reads
answers per question and per option (TD-065), and campaign scoping (ADR-026) added an `EXISTS` to
each of those reads. That is the right trade — a denominator that mixes two field operations is
cheap and wrong — but it makes Social the one route where consolidation would now pay for itself.

### 11.1 The `ECONNRESET`, and what was done about it

One request on the Preview failed with `read ECONNRESET` on a session query. §6 read it as a single
connection failure on a long-haul TCP path through a public proxy, on a connection the pool believed
was healthy — not a capacity problem. Nothing since has contradicted that: no second occurrence, and
the pool's `max` of 10 is never approached.

The pool was configured with **nothing but `max` and an application name**, which means node-postgres
defaults: no TCP keepalive, a 10-second idle timeout, unbounded connection lifetime, no connect
timeout, no statement timeout. On a path where an idle connection can be reclaimed by a middlebox
without either end being told, that is the exact shape that produces one unexplainable reset.

| Setting | Value | Why |
|---|---|---|
| `keepAlive` (+10 s delay) | on | the path is never idle long enough to be reclaimed silently |
| `maxLifetimeSeconds` | 600 | a connection is recycled by us, on our schedule, rather than by something in the middle |
| `idleTimeoutMillis` | 30 000 | idle connections are returned rather than held open across a long gap |
| `connectionTimeoutMillis` | 10 000 | a request that cannot get a connection fails in seconds, legibly (TD-067) |
| `statement_timeout` | 20 000 ms | a stuck query fails instead of holding its connection (TD-067) — operator work (migrations, seeds, imports, test fixtures) passes `null`, because a migration cancelled halfway is worse than a slow one |

**No retries were added**, and that is a decision rather than an omission. A retry around a
transaction re-runs whatever the transaction contained, and this product's transactions write. The
pool already discards a client that errored, so the next request gets a fresh connection; making the
failing one fail clearly is the honest fix. If resets recur *with* keepalive, that is new evidence
and a different diagnosis — a read-only retry at a single, named call site could then be argued from
it.

### 11.2 Region: still the owner's, and still a projection

Unchanged. The functions are in `iad1`, the database in `us-west2`; §7's measurement is still blocked
by the Preview's deployment protection. What has changed is the count the distance multiplies: 17 → 12
context round trips in the previous wave, and now four fewer per page again. **The recommendation
stands: fix the count before spending geography on it, and the count keeps coming down.** A database
region migration remains a hard stop.
