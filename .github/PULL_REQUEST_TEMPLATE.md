<!-- Title must be a Conventional Commit: type(scope): subject  (squash merge uses it) -->

## Summary

<!-- What changes and why, in a few sentences. Link the slice / issue if any. -->

## Architecture

- ADRs touched or relied on: <!-- e.g. ADR-002, ADR-004; "none" -->
- New or changed server entry points (actions / handlers / jobs) and their `requireCapability` / `requirePermission` calls: <!-- list or "none" -->
- Enforcement registry updated: <!-- yes / not applicable -->

## Tenancy and security impact

<!-- Required. State "none" explicitly if that is the case. -->
- New tables carry `tenant_id` (+ `project_id`), RLS policies, composite FK, registry entry: <!-- yes / n/a -->
- Cross-tenant attack harness extended for new entry points: <!-- yes / n/a -->
- PII, audit, portal or identity-provider effects: <!-- describe / none -->

## Schema / migration effects

<!-- Required. Migration ids, policy changes, backfills, rollback notes; or "none". -->

## Provenance effects

<!-- New provenance-bearing tables, runs, facet usage, label mapping changes; or "none". -->

## Changeset

- [ ] Changeset added (`pnpm changeset`)
- [ ] No changeset needed — reason: <!-- docs-only / tooling / test-only / refactor without visible change -->

## Tests

<!-- Paste the actual commands and a short excerpt of their output. State anything skipped. -->

```
pnpm lint && pnpm typecheck && pnpm test:unit
```

## UI

<!-- Screenshots at 1440 px for UI changes, compared against the golden reference when one exists; or "no UI". -->
