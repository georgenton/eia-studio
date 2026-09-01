# Engineering standards — Git workflow, commits, hooks, reviews

> Approved at the delivery-alignment review after Gate 1 (see `DECISIONS/GATE-1.md` §Delivery
> alignment). Applies from Slice 0 onward. Single-developer project today: the process is kept to
> what protects `main`, keeps history readable and makes releases traceable, nothing more.

## 1. Repository

- Canonical remote: **GitHub**, private repository `eia-studio` (owner: the developer's account
  or organisation, to be confirmed at creation). Never public.
- Default branch: `main`, protected (§5). No direct pushes to `main` once protection is on.
- One repository for the whole monorepo (`apps/*`, `packages/*`, `fixtures/*`, `docs/*`).
- The approved design bundle under `design/reference/` is committed as-is and treated as
  read-only (changes only through a new design version folder).

## 2. Branching model

Short-lived branches off `main`, merged back by pull request, deleted after merge.

| Prefix | Use | Example |
|---|---|---|
| `feat/*` | new capability, surface, use-case | `feat/capability-resolver` |
| `fix/*` | bug fix | `fix/rls-project-listing` |
| `chore/*` | tooling, dependencies, CI, config | `chore/ci-typecheck` |
| `docs/*` | documentation and ADRs only | `docs/adr-011-release-policy` |
| `refactor/*` | behaviour-preserving restructuring | `refactor/provenance-read-models` |
| `test/*` | tests only | `test/cross-tenant-harness-gis` |

Rules: keep branches under a few days; rebase or merge `main` into the branch as needed (no
force-push to shared branches; `--force-with-lease` is acceptable on your own unpushed-elsewhere
feature branch only); one topic per branch.

## 3. Commits — Conventional Commits

Format: `type(scope)?: subject` with an optional body and footers.

- Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.
- Scope (optional) = module or package: `core`, `projects`, `gis`, `field`, `social`, `quality`,
  `documents`, `reports`, `portal`, `ai`, `provenance`, `audit`, `db`, `ui`, `web`, `worker`,
  `fixtures`, `docs`.
- Breaking changes: `!` after the type/scope and a `BREAKING CHANGE:` footer.
- Subject in imperative mood, no trailing period, ≤ 72 characters.
- Footers used by this project: `Refs: ADR-005`, `Tenancy-impact: none | <text>`,
  `Schema-impact: none | <migration id>` (see §6), `Co-Authored-By:` when applicable.

Examples:

```
feat(core): resolve capabilities as booleans with shell-only presentation hint

Refs: ADR-002
Tenancy-impact: none
Schema-impact: none
```

```
fix(db)!: deny project-scoped rows when app.project_id is unset

BREAKING CHANGE: portfolio listings must set app.project_id to NULL explicitly.
Schema-impact: 0007_project_policy_null_guard.sql
```

Validation is enforced locally by commitlint (`commit-msg` hook) and in CI on the PR title,
because squash merges use the PR title as the commit subject.

## 4. Pull requests

- Required for every change that touches `apps/`, `packages/`, `fixtures/`, `.github/`, or that
  changes behaviour documented in `docs/`. Trivial typo fixes in docs may go through a PR as well;
  there is no "direct to main" path once protection is on.
- **Squash merge by default**; the PR title must be a valid Conventional Commit; the squash body
  keeps the PR description.
- The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) asks for: summary, ADRs touched,
  capability/permission enforcement points added, **tenancy and security impact**,
  **schema/migration effects**, provenance effects, changeset present or explicitly not needed,
  tests run with actual output, screenshots for UI changes.
- Reviews: with one developer, the review is a self-review against the template and CI; when a
  second contributor joins, one approving review becomes required in branch protection.
- Merge only when CI is green. Never bypass a failing required check; fix or revert.

## 5. Branch protection (recommendation for `main`)

Apply in GitHub › Settings › Branches (or a ruleset):

- Require a pull request before merging; **allow squash merge only**; delete head branches.
- Require status checks to pass: the `ci / quality` job (name kept stable across stages).
- Require branches to be up to date before merging (keeps squash commits testable).
- Require linear history.
- Block force pushes and deletions.
- Do not allow bypassing the above, including for administrators (the developer can temporarily
  disable a rule in the UI if truly needed, which is itself visible and reversible).
- Required approving reviews: 0 today; raise to 1 when a second contributor exists.
- Optional later: require signed commits.

The CLI equivalent is documented in DEPLOYMENT.md §7 and is only run after the repository exists
and the CI workflow has produced its first run (GitHub needs to see the check name).

## 6. Change hygiene expected in every PR

- **Tenancy/security impact statement**: which entry points were added, whether they call
  `requireCapability`/`requirePermission`, whether new tables have `tenant_id`, RLS and the
  composite FK, whether the cross-tenant harness was extended.
- **Schema/migration effects**: migration ids, whether RLS policies changed, whether data
  backfills run, rollback notes.
- **Provenance effects**: new provenance-bearing tables, new runs, label mapping changes.
- **Changeset**: present, or a one-line reason why the change is not release-visible.
- **Tests**: what ran, with output; anything skipped is stated.

## 7. Git hooks (Husky + lint-staged, installed in Slice 0)

| Hook | Runs | Budget |
|---|---|---|
| `pre-commit` | `lint-staged` only: Prettier on staged files, ESLint `--fix` on staged TS/TSX, forbidden-string check on staged files under `packages/` and `apps/` (Zamora constants, hex colours outside `packages/ui/tokens`) | seconds |
| `commit-msg` | `commitlint --edit` with `@commitlint/config-conventional` plus the project scopes | instant |
| `pre-push` | optional and lightweight: `pnpm typecheck --filter ...[origin/main]` and unit tests of changed packages; can be skipped with `--no-verify` when iterating, because CI is authoritative | < 1 minute |

Hooks are conveniences; **CI is the gate**. Hooks never run integration tests, containers or
builds.

## 8. Code review checklist (self-review today)

1. Does the change contradict an ADR? If so, the ADR was amended first.
2. Are Zamora constants absent from `packages/` and `apps/`?
3. Do new server entry points enforce capability and permission and appear in the enforcement
   registry?
4. Do new tables carry tenancy columns, RLS, composite FK and `provenance_id` when applicable?
5. Is user-facing copy in the message catalogue and free of forbidden phrases?
6. Are tests present for logic, DB and isolation, and did they actually run?
7. Is a changeset present or justified as unnecessary?

## 9. Issue templates and CODEOWNERS

- Issue templates: **not created**. With one developer, GitHub issues are optional; if used, a
  plain issue with a link to the slice and ADR is enough. Revisit when external contributors or a
  client bug-report channel appear.
- CODEOWNERS: **future optional configuration**. A commented example lives at
  `.github/CODEOWNERS.example`; renaming it to `CODEOWNERS` activates review routing once there is
  more than one maintainer.
