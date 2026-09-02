import { defineRailway, preserve, project, service, volume } from "railway/iac";

/**
 * Railway Infrastructure as Code for the EIA Studio staging environment
 * (ADR-012, docs/DEPLOYMENT.md, docs/STAGING_GATE_0_5.md).
 *
 * This file replaces the deprecated `railway.toml` (Config as Code), which Railway stops reading
 * on 2026-12-01. It describes the whole `eia-studio-staging` project: omitting a resource here
 * deletes it, so every live service and volume is declared even when Railway owns its lifecycle.
 *
 * Scope and safety rules:
 * - Staging only. There is no production Railway environment and none is declared here.
 * - No secrets. Every variable is `preserve()`, which keeps the value already set in Railway, so
 *   `railway config plan|apply` never writes credentials into source and never prints them.
 * - The web application is deployed on Vercel and is deliberately absent from this project.
 * - Database migrations are never run by a service: they use the migrator role from an operator
 *   session (docs/DEPLOYMENT.md §5). The worker only ever connects with the RLS-enforced runtime
 *   role.
 *
 * Workflow: `railway config plan` (safe, read-only) and then `railway config apply`.
 */
export default defineRailway(() => {
  // Data directory of the PostgreSQL service.
  const postgresGisData = volume("postgres-gis-data", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "us-west2",
    sizeMB: 5000,
  });

  // PostgreSQL 17 + PostGIS + pgvector + TLS, built from `docker/postgres/Dockerfile` in this
  // repository. Railway's stock template has no PostGIS, so migration 0000 cannot run on it.
  //
  // `rootDirectory` selects the Docker build context. No Git repository is connected to this
  // service (deploys are explicit uploads), so Railway IaC models the source as `empty` with a
  // root directory; declaring `github(...)` here would switch the database to push-triggered
  // deployments, which is not wanted. Railway keeps reporting the historical source type
  // `github` for this service, so `railway config plan` always shows one pending
  // `source.type` change; applying it is a no-op (docs/TECH_DEBT.md TD-021).
  const postgresGis = service("postgres-gis", {
    rootDirectory: "/docker/postgres",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile", buildEnvironment: "V3" },
    replicas: { "us-west2": 1 },
    // Public TCP endpoint for operator sessions (migrations, integration runs). Applications use
    // the private network instead. Declared through `tcp` rather than `networking.tcpProxies`:
    // the SDK overwrites the latter with its computed value (railway 3.11.0).
    tcp: [5432],
    volumeMounts: { "/var/lib/postgresql/data": postgresGisData },
    env: {
      PGDATA: preserve(),
      POSTGRES_DB: preserve(),
      POSTGRES_PASSWORD: preserve(),
      POSTGRES_USER: preserve(),
    },
  });

  // The persistent worker. Node runs as PID 1 on purpose: a package-manager wrapper swallows
  // SIGTERM and reports a non-zero exit, which defeats the graceful shutdown path
  // (observed on Railway, docs/STAGING_GATE_0_5.md §4a).
  const worker = service("worker", {
    build: {
      builder: "RAILPACK",
      buildCommand: "pnpm install --frozen-lockfile && pnpm --filter @eia/worker build",
      buildEnvironment: "V3",
    },
    start: "node apps/worker/dist/main.js",
    healthcheck: "/health",
    healthcheckTimeout: 60,
    replicas: { "us-west2": 1 },
    // Restart policy: Railway's platform default is already ON_FAILURE and the service reports
    // it, but declaring `restartPolicyType` here re-plans as pending on every run (railway CLI
    // 5.47.2 / SDK 3.11.0 never reads it back), so only the retry limit is declared.
    deploy: { restartPolicyMaxRetries: 5 },
    env: {
      APP_ENV: preserve(),
      DATABASE_URL: preserve(),
      DEMO_FIXTURES_ENABLED: preserve(),
      LOG_LEVEL: preserve(),
      PORT: preserve(),
      PUBLIC_APP_URL: preserve(),
      WORKER_DB_CHECK: preserve(),
      WORKER_HEALTH_PORT: preserve(),
    },
  });

  return project("eia-studio-staging", {
    resources: [postgresGis, worker, postgresGisData],
  });
});
