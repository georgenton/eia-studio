# Changesets

Release-visible changes add a changeset with `pnpm changeset` (RELEASE_POLICY.md). Internal
packages are versioned and tagged but never published; `@eia/web` and `@eia/worker` release
together (linked group). Docs-only, ADR, CI/tooling and test-only changes need no changeset.
