# Deployment environment — every variable, by service and environment

Derived from the zod schemas in `packages/contracts/src/env/`, which are the only authority. If
this table and a schema disagree, the schema wins and this file is wrong.

**No values appear here.** Classification only.

- **PUBLIC** — visible to anyone who can reach the application; not a secret.
- **CONFIG** — operational choice; not a secret, but wrong values change behaviour.
- **SECRET** — must come from Coolify's secret storage, never from a compose file in Git.
- **BUILD** — set at image build time; baked in.
- **OPTIONAL** — absence is a supported state with a defined meaning.

## The rule that governs the optional ones

Unset never means "use a stand-in". `SOCIAL_CLASSIFIER` unset means assisted coding is
unavailable and the screen says so (IG4-001). `STORAGE_PROVIDER` unset means file upload is
unavailable (ADR-031). A worker with neither starts, logs why, and simply never claims that work.

## Matrix

| Variable | Class | web | worker | migrate | demo | staging | production |
|---|---|---|---|---|---|---|---|
| `APP_ENV` | CONFIG | ✓ | ✓ | ✓ | `demo` | `staging` | `production` |
| `PUBLIC_APP_URL` | PUBLIC | ✓ | ✓ | — | `<EIA_DEMO_URL>` | `<EIA_STAGING_URL>` | `<EIA_PRODUCTION_URL>` |
| `LOG_LEVEL` | CONFIG | ✓ | ✓ | — | info | info | info |
| `DEMO_FIXTURES_ENABLED` | CONFIG | ✓ | — | — | **true** | false | **refused** |
| `DATABASE_URL` | SECRET | ✓ | ✓ | — | separate | separate | separate |
| `DATABASE_MIGRATOR_URL` | SECRET | — | — | ✓ | separate | separate | separate |
| `DATABASE_APP_ROLE_NAME` | CONFIG | ✓ | — | — | ✓ | ✓ | ✓ |
| `DATABASE_APP_ROLE_PASSWORD` | SECRET | — | — | ✓ | ✓ | ✓ | ✓ |
| `BETTER_AUTH_SECRET` | SECRET | ✓ | — | — | **distinct** | **distinct** | **distinct** |
| `BETTER_AUTH_URL` | PUBLIC | ✓ | — | — | ✓ | ✓ | ✓ |
| `AUTH_TRUSTED_ORIGINS` | CONFIG | ✓ | — | — | exact | exact | exact |
| `STORAGE_PROVIDER` | CONFIG / OPTIONAL | ✓ | ✓ | — | `s3` | `s3` | `s3` |
| `STORAGE_BUCKET` | CONFIG | ✓ | ✓ | — | **distinct** | **distinct** | **distinct** |
| `STORAGE_REGION` | CONFIG | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `STORAGE_ENDPOINT` | CONFIG | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `STORAGE_ACCESS_KEY_ID` | SECRET | ✓ | ✓ | — | **distinct** | **distinct** | **distinct** |
| `STORAGE_SECRET_ACCESS_KEY` | SECRET | ✓ | ✓ | — | **distinct** | **distinct** | **distinct** |
| `BASEMAP_PROVIDER` | CONFIG | ✓ | — | — | ✓ | ✓ | ✓ |
| `BASEMAP_TILE_URL` | CONFIG | ✓ | — | — | ✓ | ✓ | ✓ |
| `BASEMAP_ATTRIBUTION` | PUBLIC | ✓ | — | — | ✓ | ✓ | ✓ |
| `MAPTILER_KEY` | SECRET / OPTIONAL | ✓ | — | — | licence | licence | **licence required** |
| `EMAIL_ADAPTER` | CONFIG | ✓ | — | — | ✓ | ✓ | ✓ |
| `EMAIL_FROM` | CONFIG | ✓ | — | — | ✓ | ✓ | ✓ |
| `WORKER_DB_CHECK` | CONFIG | — | ✓ | — | true | true | true |
| `WORKER_HEALTH_PORT` | CONFIG | — | ✓ | — | 3100 | 3100 | 3100 |
| `WORKER_HEARTBEAT_MS` | CONFIG / OPTIONAL | — | ✓ | — | — | — | — |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | CONFIG / OPTIONAL | — | ✓ | — | — | — | — |
| `SOCIAL_CLASSIFIER` | CONFIG / OPTIONAL | ✓ | ✓ | — | **unset** | **unset** | **unset** |
| `SOCIAL_CLASSIFIER_MODEL` | CONFIG / OPTIONAL | ✓ | ✓ | — | unset | unset | unset |
| `DOCUMENT_REVIEWER` | CONFIG / OPTIONAL | ✓ | ✓ | — | **unset** | **unset** | **unset** |
| `DOCUMENT_REVIEWER_MODEL` | CONFIG / OPTIONAL | ✓ | ✓ | — | unset | unset | unset |
| `ASSISTANT_GENERATOR` | CONFIG / OPTIONAL | ✓ | — | — | **unset** | **unset** | **unset** |
| `ASSISTANT_GENERATOR_MODEL` | CONFIG / OPTIONAL | ✓ | — | — | unset | unset | unset |
| `AI_GATEWAY_API_KEY` | SECRET / OPTIONAL | ✓ | ✓ | — | unset | unset | unset |
| `EIA_IMAGE` | CONFIG | — | — | — | digest | digest | digest |
| `GIT_SHA` | BUILD | baked | baked | baked | — | — | — |
| `BUILD_ID` | BUILD | baked | baked | baked | — | — | — |

## Rules that are not negotiable

**Nothing is shared across environments.** Not a database, not a bucket, not an auth secret. A
demo session must not authenticate against staging, and it cannot: the secret differs.

**`DEMO_FIXTURES_ENABLED` is refused in production** by the schema itself
(`appEnvSchema.refine`), not by a script that could be skipped.

**AI stays unset everywhere** until the privacy, legal and vendor review of `SECURITY.md` §10a
says otherwise. Unset is a state with a meaning, not a gap.

**Database TLS**: `APP_ENV=production` refuses a URL whose `sslmode` does not verify the server.
Other environments do not enforce it — a deliberate asymmetry, and one worth revisiting for demo
and staging once their databases live off-host.
