---
"@eia/db": patch
"@eia/web": patch
---

MVP integration: one walkthrough test for the whole product, and a measured performance baseline.

**The demo is now a test.** `e2e/mvp-journey.spec.ts` walks the coordinator's path from Portfolio
to a downloaded chapter in the order `docs/manual/10-demo-walkthrough.md` describes, asserting the
**seams** rather than the features: that tenant and project ride the rail across every surface,
that a selection made in the map survives into a parcel workspace, that a Quality Gate finding
raised before any document existed now links into the passage it was transcribed from, and that the
generated chapter carries the five sections and says it is a draft. Each surface's own guarantees
stay with the spec that owns them.

**A performance baseline, measured rather than assumed** (`docs/PERFORMANCE_BASELINE.md`). The pg
pool gained an `onQuery` hook — a duration and nothing else, never SQL text or parameters — and the
request context now emits one `debug` line per rendered route with its phases and round-trip count.
`pnpm perf:baseline` drives the eight server-rendered routes serially and reports median and p95.

What it found: **every project page makes 37 to 95 database round trips, and 17 of them are spent
deciding who is asking — 12 of those 17 being transaction framing**, because the request context is
built across four separate transactions. On a local database with sub-millisecond latency, 62 % to
95 % of a route's wall clock is already inside the driver, and Social Intelligence is an outlier at
78 page queries. The web functions run in `iad1` while the database is in `us-west2`, which
multiplies a count that is too large before geography is considered.

**Nothing was changed in response.** The four candidate remedies are recorded as TD-064 … TD-067
with their costs, and the region question is left explicitly to the owner. The count is worth fixing
before the distance is: a page that needs 17 round trips to know who you are is slow in every region.

Also fixed: `getByRole("link", { name: "v1" })` in the report specs matched `v10` too, a failure
that would first appear on the tenth run of a suite that had passed nine times.
