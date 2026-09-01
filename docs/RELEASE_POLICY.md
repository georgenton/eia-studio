# Release and versioning policy

> Related: ADR-011 (Changesets). Applies from Slice 0. Nothing is published to a package
> registry; "release" means a tagged, changelogged state of the monorepo that staging and,
> later, production deploy from.

## 1. Goals

- Semantic Versioning per package and for the deployable apps.
- Changelog generated from human-written change summaries, not from commit noise.
- Monorepo-aware versioning (a change in `packages/domain` bumps the packages that depend on
  it) without publishing to npm.
- Release traceability: any deployed build maps to a version, a tag, a changelog entry and the
  PRs that produced it.

## 2. Tool: Changesets

- `pnpm changeset` creates a `.changeset/*.md` file describing the change, the affected
  packages and the bump level (`patch` / `minor` / `major`).
- The Changesets GitHub Action opens and maintains a **"Version Packages" PR** on `main` that
  applies bumps and updates `CHANGELOG.md` files. Merging that PR is the release commit; the
  workflow tags it (`eia-studio-web@x.y.z`, `eia-studio-worker@x.y.z`, package tags) and
  creates a GitHub Release with the aggregated notes.
- Private packages: `"access": "restricted"` and no publish step; `privatePackages: { version:
  true, tag: true }` in `.changeset/config.json` so internal packages are still versioned.
- Linked versioning: `apps/web` and `apps/worker` are in one **linked group** so they release
  with a shared version (they deploy together and share the domain packages); `packages/*` are
  versioned independently within the workspace.

## 3. When a changeset is required

A changeset is required when the change is **release-visible**: user-facing behaviour, UI,
server entry points, schema/migrations, configuration keys, capability catalogue, fixtures that
seed demo tenants, public read models, job payloads, security controls.

A changeset is **not** required for: documentation-only changes, ADRs, comments, CI/tooling
changes with no runtime effect, test-only changes, refactors with no observable change, formatting.
For these, the PR says "No changeset: docs-only / internal" in the template, and the CI
changeset check is advisory only (it never blocks on docs/tooling-only diffs).

Bump levels:

| Level | Meaning in this project |
|---|---|
| `patch` | fixes, copy corrections, non-breaking internal improvements |
| `minor` | new surface, new capability, new configuration key with a default, new migration that is backward compatible |
| `major` | breaking change to a public read model, job payload, configuration semantics, or a migration that requires manual intervention |

## 4. Release cadence and environments

- Staging deploys from `main` automatically after Slice 0 produces a runnable build (every merge,
  including pre-version merges). Staging therefore runs "unreleased" code between Version
  Packages merges; the app exposes the git SHA and the pending version in a footer/health endpoint.
- A release (Version Packages PR merged) is the unit that production deploys from, manually and
  explicitly, after the production-readiness gate.
- Hotfix: `fix/*` branch → PR → changeset `patch` → merge → Version Packages PR → merge → deploy.
  No release branches; no cherry-picks to long-lived branches.

## 5. Traceability

- Every deployment records: app version, git SHA, changeset ids included, migration head id.
- The GitHub Release notes list PRs; the PR template links ADRs and migration ids.
- Fixture datasets carry their own `version` in the manifest, independent from app versions.

## 6. Pre-1.0 policy

Until the first production release, versions stay `0.x.y`: `minor` may include breaking changes
(SemVer allows it before 1.0), and `major` is reserved for the 1.0 production release itself.
