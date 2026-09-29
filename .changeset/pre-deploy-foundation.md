---
"@eia/contracts": minor
"@eia/db": minor
"@eia/worker": patch
"@eia/web": patch
---

Prepare EIA Studio for container deployment across three permanent environments.

`APP_ENV` gains `demo`, a persistent showcase environment that refuses a stand-in classifier and
an in-memory store exactly as staging and production do, and whose only extra permission is an
explicit `DEMO_FIXTURES_ENABLED` opt-in. Production's refusal is unchanged and now asserted over
the whole enum, so a seventh environment cannot be added without deciding what it may do.

Adds the application `Dockerfile`: one immutable image running web, worker and the migration
runner under three different commands, so the digest validated in staging is provably the digest
deployed to production. Next.js emits `output: "standalone"`; the worker and the migration runner
are compiled bundles, which removed `tsx` from the runtime layer and exposed two packaging gaps
that only appear outside the workspace — the worker bundle was missing `@eia/application`, and
both bundles needed a real `require` for their CommonJS dependencies.

No deployment, no infrastructure change.
