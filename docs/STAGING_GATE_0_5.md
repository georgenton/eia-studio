# Staging capability report — Slice 0.5

> Observed facts from a real evaluation on 2026-09-01/02, not vendor documentation. Every result
> below was produced by `pnpm db:probe` (`packages/db/scripts/capability-probe.mjs`), by the
> integration suite run against the staging database, or by the provider APIs. No production
> environment exists; no real personal data was used.

## 1. Topology as built

```
GitHub (georgenton/eia-studio)
  ├── Vercel  · project eia-studio-web · root directory apps/web · Node 24.x · preview only
  └── Railway · project eia-studio-staging · environment "staging"
        ├── worker        (persistent Node 24 process, apps/worker)
        ├── postgres-gis  (our docker/postgres image: PostgreSQL 17 + PostGIS + pgvector + TLS)
        └── Postgres      (Railway's stock template, kept only as the comparison baseline)
```

The Railway project's default environment is named `production` by the platform and is **unused
and empty**; all staging work lives in the `staging` environment.

## 2. PostgreSQL provider evaluation

Two candidates were probed with the identical script.

### 2.1 Railway's stock Postgres template

| Area | Result |
|---|---|
| Version | PostgreSQL 18.6 (Debian) |
| TLS | **PASS** — TLSv1.3, TLS_AES_256_GCM_SHA384 |
| Connected role | `postgres`, superuser |
| Ordinary / NOLOGIN role creation | PASS |
| `NOLOGIN BYPASSRLS` policy owner (ADR-004 `eia_policy`) | PASS, `rolbypassrls = true` observed |
| Runtime LOGIN role without BYPASSRLS | PASS |
| `ENABLE` / `FORCE ROW LEVEL SECURITY` | PASS |
| SECURITY DEFINER + ownership transfer + pinned `search_path` | PASS |
| `REVOKE EXECUTE … FROM PUBLIC` | PASS |
| Transaction-local `set_config(..., true)` | PASS (scoped to the transaction, empty afterwards) |
| Pooler in front of the endpoint | none — direct connection, stable backend pid |
| Runtime cannot bypass RLS / SET ROLE / disable `row_security` | PASS |
| `pg_trgm` | PASS (1.6) |
| `vector` | PASS (0.8.6) |
| **`postgis`** | **FAIL — not offered by the image** |

Result: 26 passed, 1 failed. Every mandatory *security* capability passes. The single failure is
functional and blocking regardless: migration `0000_extensions_and_roles` executes
`CREATE EXTENSION postgis`, so the schema cannot be created at all on this image.

### 2.2 Our own image on Railway (`docker/postgres`, service `postgres-gis`)

Same Dockerfile as local development and CI, deployed to Railway from the repository, with a
volume at `/var/lib/postgresql/data`.

| Area | Result |
|---|---|
| Version | PostgreSQL 17.6 (Debian), identical to local/CI |
| TLS | **PASS** — TLSv1.3, TLS_AES_256_GCM_SHA384 |
| `postgis` | PASS — available and installed, 3.5.3 |
| `vector` | PASS — available and installed, 0.8.6 |
| `pg_trgm` | PASS — available and installed, 1.6 |
| All privilege / RLS / SECURITY DEFINER / pooling checks above | PASS |

Result: **28 passed, 0 failed.**

TLS was not present on the first attempt: the upstream PostGIS image ships without it, and the
probe failed with "The server does not support SSL connections". Rather than accept an
unencrypted database behind a public TCP proxy, the image now generates a self-signed certificate
on first start and enables `ssl` (`docker/postgres/ssl-entrypoint.sh`). Local development and CI
are unaffected because TLS is offered, not forced.

Because the certificate is self-signed, clients connect with `sslmode=no-verify`: traffic is
encrypted, but the server certificate is not pinned to a CA. That is acceptable for staging with
synthetic data and is recorded as debt to close before production (TD-016).

## 3. Migrations and credential separation

- Migrations were applied to staging with `DATABASE_MIGRATOR_URL` (the `postgres` superuser):
  `pnpm db:migrate` → `migrations applied` (0000 … 0004).
- The runtime login role was then provisioned with `pnpm db:provision-runtime-role` →
  `eia_app_login` created as a member of the `eia_app` group role.
- `DATABASE_URL` used by the applications points at `eia_app_login`; the migrator URL is never
  configured on the web or worker services. The separation is therefore real in staging, not just
  documented.

## 4. Security verification against staging

The full integration suite was pointed at the staging database
(`EIA_TEST_MIGRATOR_URL` + `EIA_TEST_RUNTIME_URL`, external-database mode in
`packages/testing/src/global-setup.ts`) and executed there:

```
Test Files  6 passed (6)
Tests      46 passed (46)
```

That run covers, on the real provider:

| Requirement (Part L) | Evidence |
|---|---|
| Runtime DB role is not superuser | migrations/roles test + probe |
| Runtime does not possess BYPASSRLS | same |
| Runtime cannot `SET ROLE` to the policy owner | security-definer suite |
| Tenant A cannot read Tenant B | cross-tenant suite, cases 1–2 |
| Tenant A cannot mutate Tenant B | cross-tenant suite, case 2 |
| Missing context denies | cross-tenant suite, case 5 |
| SECURITY DEFINER helpers keep the hardened ACL and `search_path` | security-definer suite |
| Better Auth sessions work without becoming an authorization source | `apps/web/test/auth-signup.integration.test.ts` (sign-up refused, provisioned sign-in succeeds, no organisation plugin) |

**No behavioural difference was observed between staging and the local Testcontainers
environment.** The only environmental differences are the PostgreSQL patch version (17.6 in both),
TLS being exercised in staging, and connections traversing Railway's TCP proxy.

## 4a. Worker validation (Railway)

Service `worker`, Railpack build of the workspace, deployed to the `staging` environment.
Observed in the deployment logs, with `pid: 1` on every line:

```
worker starting              version=0.0.0 healthPort=8080
database reachable with RLS-enforced role   role=eia_app_login
readiness check passed       check=database
worker running               healthPort=8080
heartbeat                    pending=0 uptimeSeconds=15 … (every 15s)
worker stopping              reason="signal SIGTERM" timeoutMs=10000
worker stopped               reason="signal SIGTERM" uptimeSeconds=352
Stopping Container
```

| Check (Part G) | Result |
|---|---|
| Correct monorepo root | PASS — repository root; build filters to `@eia/worker` |
| Build command | PASS — `pnpm install --frozen-lockfile && pnpm --filter @eia/worker build` |
| Start command | PASS — `node apps/worker/dist/main.js` |
| Node 24 | PASS — resolved from `engines.node` / `.nvmrc` |
| Environment validation | PASS — the process validates its configuration at startup and exits 1 on invalid input; it started only after the schema parsed |
| Database readiness with the RLS-enforced role | PASS — connects as `eia_app_login` over Railway's private network and refuses to start if the role can bypass RLS |
| Health mechanism | PASS — `/health` on port 8080; Railway's healthcheck gates the deployment, which reached SUCCESS |
| Graceful SIGTERM | PASS — see the log excerpt above; the process drains and exits before the container stops |
| Restart behaviour | Configured `ON_FAILURE`, max 5 retries; not exercised (no crash occurred) |

**Finding: the worker must run Node as PID 1.** The first working deployment used
`pnpm --filter @eia/worker start` as the container command. On SIGTERM the shutdown handler never
ran and the deployment logged
`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @eia/worker start: node dist/main.js`, i.e. a non-zero exit
from a killed child. Replacing the command with `node apps/worker/dist/main.js` produced the clean
shutdown shown above. `railway.toml` carries the fix and the reason.

## 4b. Web application (Vercel)

| Item | Value |
|---|---|
| Project | `eia-studio-web` (`prj_kPETrPyPEFHPK1ZPbl6Wgg0D2BsK`) |
| Root directory | `apps/web` |
| Node | 24.x |
| Install / build | `pnpm install --frozen-lockfile` / `pnpm --filter @eia/web build` |
| Git integration | connected to `georgenton/eia-studio`, production branch `main` |
| Preview deployment | `https://eia-studio-58q5n2k96-georgentons-projects.vercel.app` (target `preview`, commit `dc8aef4`) |
| `/health` | `200` → `{"status":"ok","service":"web","version":"0.0.0","gitSha":"dc8aef4e…"}` |
| Foundation page | `200`, renders "Plataforma en construcción" with `env preview` |
| Deployment protection | Vercel SSO on all deployment URLs (restored after the check; an unauthenticated request returns `302`) |

Environment validation was exercised implicitly: the page and `/health` render only after
`getEnv()` parses `APP_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET` and the derived origin. Better
Auth runs in preview mode with `BETTER_AUTH_URL` taken from Vercel's per-deployment hostname.

**Finding: Vercel promoted the first deployment of the new project to `production`**, from branch
`chore/staging-foundation`, even though the project's production branch is `main` and the API
request asked for a preview (the API also rejects `target: "preview"`; a preview is requested by
omitting `target`). The instruction for this slice was to deploy no production. Remediation
applied: both production-target deployments were **deleted**, the production alias
`eia-studio-web.vercel.app` now returns `404`, and the project holds exactly one deployment, of
target `preview`. Before any future deployment of this project, expect Vercel to promote the first
one again if the project's deployment history is ever emptied.

## 5. Operational findings (Railway)

| Topic | Observed |
|---|---|
| Regions | Deployments landed in Railway's default region for the workspace (US). Region selection per service is available on paid plans; not exercised. |
| Connection limits | `max_connections = 100`, `superuser_reserved_connections = 3` on both candidates. Adequate for staging; a pooler will be needed before many serverless clients hit it. |
| Pooling | No pooler in front of either endpoint. Sessions are direct, so `SET LOCAL` / `set_config(..., true)` semantics hold. This is what our RLS context depends on. |
| Storage | Volume-backed (`postgres-gis-data` mounted at `/var/lib/postgresql/data`). Volume size and growth are managed by Railway. |
| Backups / PITR | Railway provides volume backups on paid plans; **no automated backup or point-in-time recovery was configured or verified in this evaluation.** Treat the staging database as disposable. |
| Public exposure | Access from outside Railway requires a TCP proxy (`*.proxy.rlwy.net`). The worker uses the private network (`postgres-gis.railway.internal`) instead. |
| Maintenance | A self-built database image means we own patching (base digest bumps) and major-version upgrades. Railway's template would own that, but lacks PostGIS. |
| Config as code | `railway.toml` is deprecated by Railway in favour of `.railway/railway.ts`, with existing files working until 2026-12-01 (TD-017). |

## 6. Decision (Part F)

Railway **passes every mandatory security capability** of ADR-004 and is provisionally accepted as
the staging PostgreSQL provider, **on the condition that the database runs our own
`docker/postgres` image** rather than Railway's stock template, which has no PostGIS.

Nothing in the security architecture was weakened to fit the provider: `FORCE ROW LEVEL SECURITY`,
the SECURITY DEFINER hardening, the dedicated `eia_policy` owner, the non-BYPASSRLS runtime role
and the migrator/runtime credential split are all intact and were verified on the provider.

Consequence to carry forward: a self-built database container is appropriate for staging (maximum
fidelity with local and CI, identical extension versions) but is **not** a production
recommendation. Production wants managed PostgreSQL with PostGIS, pgvector, automated backups and
point-in-time recovery. Candidates to evaluate before the production gate: Neon, Supabase, Crunchy
Bridge, AWS RDS/Aurora. That evaluation needs accounts the project does not yet have.

## 7. What is deliberately not done

- No production environment, no production alias, no custom domain.
- No automated deployment workflow beyond Vercel's Git previews; Railway deploys stay manual.
- No `pg-boss` or job workload: the worker remains a lifecycle and health process.
- No email or storage vendor: development adapters only.
- No real personal data; the staging database holds only what the test suite creates.
