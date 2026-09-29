# Staging runbook

Staging is pre-production. Its only job is to answer whether a release candidate will work in
production, and it can only answer that if it resembles production in everything that matters.

## What must match production

Topology, image digest, migration procedure, storage adapter, auth behaviour, worker behaviour
and database strategy. The permitted differences are domain, credentials, data, resource size,
and integrations explicitly disabled.

**Demo is not staging.** Demo runs a certified digest and showcase data; staging runs the
candidate and UAT fixtures.

## Deploying a release candidate

1. Confirm the digest exists and note it. The `image` workflow prints it.
2. Pre-deploy review.
3. Migrate with the same digest and `DATABASE_MIGRATOR_URL`.
4. Deploy `EIA_IMAGE=<digest>`.
5. Smoke: `/health` returns the expected `gitSha`; sign-in renders; the worker logs
   `database reachable with RLS-enforced role`.
6. UAT.
7. Validation report, then GO or NO-GO.

A bug is NO-GO. Branch, test, new pre-deploy. No coding during a deployment.

## Data policy

Controlled synthetic and UAT fixtures. **No production clone with PII by default.** If a
production-like dataset is ever required, it arrives through an anonymisation procedure that does
not exist yet and would need writing first.

`pnpm test:staging` runs read-only assertions inside transactions that always roll back. It never
truncates, never seeds and never repairs fixtures — the guard added after the integration suite,
pointed at a persistent environment, removed the synthetic identities the demo campaign assigns
work to (IG3-001).

## What staging validates that nothing else can

Migrations against a database with real history. RLS under the runtime role. The worker's
`BYPASSRLS` refusal. Object storage against a real provider. The mobile sync routes against a
real origin. Restart and rollback behaviour. The recovery procedure itself.

## Current state

Staging today runs on Vercel and Railway (`docs/STAGING_OPERATIONS.md`). Whether it migrates to
OVH or coexists is an owner decision, recorded in ADR-039 as open.
