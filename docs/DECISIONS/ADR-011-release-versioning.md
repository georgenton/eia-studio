# ADR-011 — Release and versioning with Changesets

- Status: Accepted (delivery alignment after Gate 1)
- Date: 2026-09-01
- Related: RELEASE_POLICY.md, ENGINEERING_STANDARDS.md, CI.md

## Context

The monorepo holds two deployable apps and several internal packages that are never published
to a registry. Releases must be traceable (which code is on staging/production, with which
migrations), changelogs must be readable by non-developers (the consultancy, later clients), and
versioning must be monorepo-aware. Options: semantic-release (commit-driven), release-please
(commit-driven, Google), Changesets (intent-driven files per change), manual tags.

## Decision

1. **Changesets** manages versions and changelogs. Each release-visible change adds a
   `.changeset/*.md` with affected packages, bump level and a human-readable summary.
2. **Semantic Versioning**; `0.x` until the first production release.
3. **Private packages are versioned and tagged but never published**; `apps/web` and
   `apps/worker` form a linked group with a shared version; `packages/*` version independently
   within the workspace.
4. **Version Packages PR** via the Changesets GitHub Action on `push` to `main`; merging it is
   the release commit; tags and a GitHub Release are created automatically.
5. **No changeset for docs-only, ADR, CI/tooling, test-only, formatting or refactor changes**
   without release-visible behaviour; the PR states the reason; the CI changeset check is
   advisory for those paths.
6. **Squash merges with Conventional Commit titles** remain the commit convention; Changesets,
   not commit types, decide bumps, so a `feat` commit without a changeset never bumps by accident.
7. Deployments record app version, git SHA, changeset ids and migration head id for
   traceability.

## Consequences

- One extra file per release-visible PR; the PR template reminds the author.
- Changelogs read as product notes rather than commit lists.
- Commit-driven tools (semantic-release, release-please) are not used; their coupling of commit
  type to version bump was judged too implicit for a monorepo with security-relevant changes.
- The Changesets action needs `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`
  and the repository setting allowing Actions to create PRs.

## Alternatives rejected

- semantic-release / release-please: bump inferred from commits; harder to express "internal
  only" and monorepo groups; noisy changelogs.
- Manual tags: no changelog, no traceability discipline.
