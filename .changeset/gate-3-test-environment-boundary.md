---
"@eia/db": patch
"@eia/web": patch
---

Implementation Gate 3 (IG3-001): destructive tests can no longer reach a persistent environment.

The integration suite truncates tenants, projects and identities between files — correct for a
throwaway container, destructive anywhere else. Pointed at staging it removed the synthetic
identities the demo campaign assigns work to, and the re-seed that followed produced a campaign
with zero assignments.

Verification is now two commands against two kinds of database. `pnpm test:integration` runs only
against the Testcontainers container its own setup creates, which that setup stamps with a marker
table holding a token generated in that run; `resetDatabase` verifies the token before its first
statement and refuses everything else — no schema, no row, a different token, any error — with no
flag or environment variable that overrides it. The external-database mode that made the damage
possible (`EIA_TEST_MIGRATOR_URL` / `EIA_TEST_RUNTIME_URL`) is removed, and setting those variables
now fails the run with an explanation.

`pnpm test:staging` is the new non-destructive verification of a persistent environment: it reads
the migration ledger, the eleven field tables and their forced RLS, the policy functions and
immutability triggers, then isolation through the runtime role with the identities provisioned
there, then the demo baseline — and its only writes are inside transactions that always roll back.
`pnpm -s staging:baseline` prints ids and counts so a run can be proved to have changed nothing.

Two operator scripts change with it. `provision:identity` now reconciles an existing identity's
credential to the supplied `DEMO_USER_PASSWORD` instead of leaving an unknown one in place, so
losing a synthetic password no longer makes "wipe the database" the only way back in. Emptying a
local database is the separate, guarded `pnpm db:reset:local`, which refuses unless `APP_ENV=local`,
the host is loopback and `EIA_CONFIRM_RESET` is set — it is never a side effect of `e2e:prepare`.
