import "server-only";

import { after } from "next/server";

import { logger } from "./logger";

/**
 * The performance baseline's instrumentation.
 *
 * What it answers, and nothing more: how many round trips a rendered route makes to the database,
 * what they cost, and how that cost splits between resolving who is asking and answering what they
 * asked. Those are structural numbers — they do not change with load — and they are the ones
 * needed before anyone argues about regions, pools or caches.
 *
 * ## Two deliberate limitations
 *
 * The counter is **per process, not per request**. A request-scoped counter would need an async
 * context entered outside the render, which the App Router does not offer without wrapping every
 * route. So a measured figure is only exact when requests are driven **serially**, which is what
 * `tooling/scripts/perf-baseline.mjs` does. Under concurrent traffic the per-route attribution
 * blurs; the totals stay true.
 *
 * It records **durations and counts, never content**: no SQL text, no parameters, no identifiers
 * of what was read. A timing log that carried a query's parameters would carry survey answers.
 *
 * It logs at `debug`, so it is silent unless `LOG_LEVEL=debug` asks for it.
 */
interface DbCounters {
  queries: number;
  ms: number;
}

/**
 * On `globalThis`, for the same reason the pool is (`lib/db.ts`): Next.js can instantiate a module
 * more than once across route bundles, and a counter incremented in one instance while another is
 * read would report zero — which is indistinguishable from a page that touched no database.
 */
const counterRef = globalThis as unknown as { __eiaDbCounters?: DbCounters };
counterRef.__eiaDbCounters ??= { queries: 0, ms: 0 };
const counters = counterRef.__eiaDbCounters;

/** Passed to the pool as its `onQuery` hook. */
export function observeQuery(durationMs: number): void {
  counters.queries += 1;
  counters.ms += durationMs;
}

function snapshot(): DbCounters {
  return { queries: counters.queries, ms: counters.ms };
}

function since(before: DbCounters): DbCounters {
  return {
    queries: counters.queries - before.queries,
    ms: Number((counters.ms - before.ms).toFixed(1)),
  };
}

export interface PhaseTimings {
  /** Resolving the session through the identity provider, including its own database reads. */
  readonly session: number;
  /** Reconciling the application user row with the authenticated identity. */
  readonly ensureUser: number;
  /** Tenant, project, memberships, capabilities and permissions. */
  readonly context: number;
}

/**
 * Log what one rendered route cost, after the response has been sent.
 *
 * `after()` rather than an inline log: the measurement must not sit in the path it measures, and
 * the page's own queries have not happened yet when the context finishes resolving. By the time
 * the callback runs they have, so `db.total` is the whole route and `db.context` is the share
 * spent establishing who the caller is.
 */
export function logRouteTiming(input: {
  readonly route: string;
  readonly requestId: string;
  readonly phases: PhaseTimings;
  readonly contextDb: DbCounters;
  readonly startedAt: number;
}): void {
  const beforeAll: DbCounters = {
    queries: counters.queries - input.contextDb.queries,
    ms: counters.ms - input.contextDb.ms,
  };
  after(() => {
    const total = since(beforeAll);
    // `debug`, so measuring is opt-in (`LOG_LEVEL=debug`). One line per rendered route at the
    // default level would bury every other log the moment anyone browsed, and an instrument that
    // makes the ordinary logs unreadable gets removed rather than used.
    logger.debug(
      {
        perf: {
          route: input.route,
          requestId: input.requestId,
          totalMs: Number((performance.now() - input.startedAt).toFixed(1)),
          phases: input.phases,
          db: {
            queries: total.queries,
            ms: total.ms,
            contextQueries: input.contextDb.queries,
            contextMs: Number(input.contextDb.ms.toFixed(1)),
          },
        },
      },
      "route timing",
    );
  });
}

/** Time one phase, returning both its result and what it cost. */
export async function measure<T>(fn: () => Promise<T>): Promise<[T, number, DbCounters]> {
  const started = performance.now();
  const before = snapshot();
  const result = await fn();
  return [result, Number((performance.now() - started).toFixed(1)), since(before)];
}
