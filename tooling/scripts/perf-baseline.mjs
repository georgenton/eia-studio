#!/usr/bin/env node
// Drive the workspace's server-rendered routes serially and report what each one costs.
//
//   PERF_BASE_URL=http://localhost:3000 DEMO_USER_PASSWORD=… node tooling/scripts/perf-baseline.mjs
//
// The server must run with LOG_LEVEL=debug for its own per-route timings to be emitted; this
// script's output (wall clock per route) needs nothing from the server.
//
// Serially, and on purpose. The instrumentation in `apps/web/lib/timing.ts` counts database round
// trips per process, so per-route attribution is only exact when one request is in flight at a
// time. This measures the *shape* of a page — how many exchanges it needs and what each costs —
// which is the number that stays true under any load, rather than a throughput figure that would
// say more about the laptop than the product.
//
// It reads the routes it is given, signs in as one synthetic demo identity, and prints JSON. It
// writes nothing, changes nothing, and never touches a persistent environment's data.
import { performance } from "node:perf_hooks";

const BASE = (process.env.PERF_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.PERF_USER_EMAIL ?? "coordinadora@demo.invalid";
const PASSWORD = process.env.DEMO_USER_PASSWORD;
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 12);
const WARMUP = Number(process.env.PERF_WARMUP ?? 3);
const TENANT = process.env.PERF_TENANT ?? "demo-consultancy";
const PROJECT = process.env.PERF_PROJECT ?? "puente-del-amor";

if (!PASSWORD) {
  console.error("perf-baseline: set DEMO_USER_PASSWORD (never commit it, never print it)");
  process.exit(1);
}

const ROUTES = [
  { key: "portfolio", path: `/t/${TENANT}` },
  { key: "command-center", path: `/t/${TENANT}/p/${PROJECT}` },
  { key: "gis", path: `/t/${TENANT}/p/${PROJECT}/gis` },
  { key: "field", path: `/t/${TENANT}/p/${PROJECT}/field` },
  { key: "social", path: `/t/${TENANT}/p/${PROJECT}/social` },
  { key: "quality", path: `/t/${TENANT}/p/${PROJECT}/quality` },
  { key: "documents", path: `/t/${TENANT}/p/${PROJECT}/documents` },
  { key: "pgas", path: `/t/${TENANT}/p/${PROJECT}/pgas` },
  { key: "reports", path: `/t/${TENANT}/p/${PROJECT}/reports` },
];

/** Sign in and keep the session cookie; nothing else about the credential is retained. */
async function signIn() {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    // Better Auth checks the origin; a request without one is refused as cross-site (403).
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`sign-in failed with ${response.status}; is the target seeded and running?`);
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  const jar = cookies.map((c) => c.split(";")[0]).join("; ");
  if (!jar) throw new Error("sign-in returned no session cookie");
  return jar;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1));
  return Number(sorted[index].toFixed(1));
}

async function timeRoute(path, cookie, label) {
  const started = performance.now();
  const response = await fetch(`${BASE}${path}`, {
    // The label lets the server attribute its own timing log to this route; see `routeLabel`.
    headers: { cookie, "cache-control": "no-cache", "x-perf-route": label },
    redirect: "manual",
  });
  await response.arrayBuffer();
  return {
    ms: performance.now() - started,
    status: response.status,
    region: (response.headers.get("x-vercel-id") ?? "").split("::")[0] || null,
    cache: response.headers.get("x-vercel-cache"),
  };
}

const cookie = await signIn();
const results = [];

for (const route of ROUTES) {
  // The first hit is reported, not warmed away: a reviewer opening a page nobody has opened today
  // pays it, and a median that hides it answers a question nobody asked.
  const cold = await timeRoute(route.path, cookie, route.key);
  for (let i = 1; i < WARMUP; i += 1) await timeRoute(route.path, cookie, route.key);
  const samples = [];
  let status = null;
  let region = null;
  let cache = null;
  for (let i = 0; i < SAMPLES; i += 1) {
    const measured = await timeRoute(route.path, cookie, route.key);
    samples.push(measured.ms);
    status = measured.status;
    region = measured.region;
    cache = measured.cache;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  results.push({
    route: route.key,
    path: route.path.replace(TENANT, "[tenant]").replace(PROJECT, "[project]"),
    status,
    region,
    cache,
    samples: SAMPLES,
    coldMs: cold.ms,
    min: quantile(sorted, 0),
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: quantile(sorted, 1),
  });
}

console.log(
  JSON.stringify(
    {
      target: BASE.replace(/\/\/[^@]*@/, "//"),
      measuredAt: new Date().toISOString(),
      warmup: WARMUP,
      samples: SAMPLES,
      routes: results,
    },
    null,
    2,
  ),
);
