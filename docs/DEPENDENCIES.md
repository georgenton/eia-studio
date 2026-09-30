# Dependencies chosen in Slice 0 (exact versions)

Every dependency solves a current Slice 0 requirement (CLAUDE.md rule 23). Versions are pinned
exactly in the package manifests; `pnpm-lock.yaml` is the single lockfile. Updates arrive through
Dependabot/Renovate PRs (CI.md Stage E) and Changesets when release-visible.

## Runtime

| Package | Version | Where | Why |
|---|---|---|---|
| Node.js | 24 LTS (`.nvmrc`, `.node-version`, `engines`) | all | required by the delivery decision; Node 20 is end-of-life |
| pnpm | 10.33.2 (`packageManager`) | all | workspaces, strict hoisting, single lockfile |
| next | 16.3.4 | web | approved framework and router (ADR-014); Turbopack build |
| react / react-dom | 19.2.8 | web | Next 16 peer; `useActionState` for the foundation forms |
| better-auth | 1.7.2 | web | identity, authentication, sessions only (ADR-010); Drizzle adapter, Next.js cookies plugin |
| drizzle-orm | 0.45.2 | db, domain, web, worker, testing | single query layer (ADR-013); `pgSchema` tables, `set_config` transactions |
| pg | 8.23.0 | db, web, worker, testing | node-postgres driver, pooling per process |
| zod | 4.5.4 | contracts, domain, db (seed), web | strict schemas at every boundary; env validation |
| pino | 10.3.1 | web, worker | structured logs with redaction |
| dotenv | 17.4.2 | db (scripts), web (next.config) | load the repository-root `.env` in local development only |
| @aws-sdk/client-s3 · @aws-sdk/s3-request-presigner | (see manifest) | application | the S3 **protocol**, not a provider: MinIO, R2 and AWS all speak it, and this is the only place that knows the SDK exists (ADR-031) |
| pdfjs-dist | 5.4.149 | application | reads a PDF's own text **per page**, so a citation names the page a reader turns to rather than a chunk index. Mozilla's, the one Firefox uses; the `legacy` build runs on Node with no DOM. Run with `isEvalSupported: false`, no worker and no network fonts — a delivered PDF is untrusted input (ADR-033) |
| fflate | 0.8.3 | application, testing | opens a DOCX's archive entry by entry, so `ARCHIVE_LIMITS` is checked against every entry's declared size *before* anything is expanded. A converter would decide for itself what to decompress, and would throw away the heading trail — the only checkable locator a DOCX has |
| easy-template-x | 7.2.8 | application | fills a consultancy's own `.docx` (ADR-036). Word splits a run whenever anything about the text changes, so `{{project.name}}` normally lives in several `<w:r>` elements and a regex cannot see it — walking the run tree is a parser. MIT, no `eval`/`new Function`/`vm`/`child_process`, and configured so it can only substitute: plugins replaced with text and repetition, delimiters fixed here, and the data resolver **replaced** so a tag is a closed-registry key or nothing. `docx-templates` was rejected because it evaluates JavaScript from the template |
| expo-image-picker · expo-file-system | 57.0.18 · 57.0.7 | field | the camera (never the photo library) and the application's own documents directory, where a photograph waits for signal (ADR-032) |

### One pinned override

```
pnpm.overrides: { "@xmldom/xmldom": "0.8.15" }
```

`easy-template-x` pins `@xmldom/xmldom@0.8.13`, which carries **ten open advisories** — two
high-severity injection bypasses and several quadratic-time or quadratic-memory parsing issues. The
parser is what reads an uploaded template's `word/document.xml`, so the DoS advisories are directly
reachable by a hostile or merely malformed file. `0.8.15` is advisory-clean and is a patch inside
the same LTS line. Recorded as TD-107; the override goes away when the package relaxes its pin.

`fflate` moved `0.8.2` → `0.8.3` in the same change: its `unzipSync` infinite-loop advisory is
reachable from exactly this kind of file, and the template validator is a second caller of it.

## Tooling and tests (devDependencies)

| Package | Version | Why |
|---|---|---|
| typescript | 5.9.3 | strict TS; TypeScript 7 (native) was available but not yet supported by typescript-eslint / Next |
| turbo | 2.10.12 | task orchestration for `typecheck`/`build` across packages |
| drizzle-kit | 0.31.10 | schema diff → table migrations; custom SQL migrations share the journal |
| vitest | 4.1.11 | unit/domain + integration projects |
| testcontainers | 12.1.0 | builds `docker/postgres` and starts PostgreSQL for integration tests |
| tsx | 4.23.13 | run TypeScript scripts (migrate, provision, seed, worker dev) |
| tsup | 8.5.1 | bundle the worker (workspace packages inlined, native deps external) |
| eslint | 9.39.5 | ESLint 10 exists but the plugin ecosystem (Next plugin) still targets 9 |
| typescript-eslint | 8.69.0 | TS rules (non type-aware for speed) |
| @eslint/js | 9.39.5 | recommended base rules |
| eslint-config-prettier | 10.1.8 | disable formatting rules (one formatter) |
| eslint-plugin-boundaries | 7.2.0 | domain module dependency direction + public entry points |
| eslint-plugin-react-hooks | 7.1.1 | hooks rules for the web app |
| @next/eslint-plugin-next | 16.3.4 | Next.js rules |
| prettier | 3.9.6 | the formatter |
| husky | 9.1.7 | git hooks |
| lint-staged | 17.4.1 | staged-file checks on pre-commit |
| @commitlint/cli, @commitlint/config-conventional | 21.2.2 | Conventional Commits with project scopes |
| @changesets/cli | 3.0.1 | versioning and changelogs (ADR-011) |
| @changesets/changelog-github | 1.0.0 | PR-linked changelog entries |
| @types/node | 24.13.3 | Node 24 types |
| @types/pg | 8.23.1 | driver types |
| @types/react, @types/react-dom | 19.2.18 / 19.2.5 | React types |

## Not installed on purpose (Slice 0)

TanStack Router/Start/Table/Query/Virtual/Form, MapLibre, pg-boss, Redis, Prisma, Playwright,
OpenTelemetry/Sentry SDKs, any email provider SDK, any S3 SDK. Each arrives with the slice that
needs it (ADR-012, ADR-014; ports exist in `packages/domain/src/core/ports`).

## Workspace layout (ADR-015)

`@eia/domain` is pure (only `zod`). `@eia/application` orchestrates persistence and depends on
`@eia/domain` + `@eia/db`. Apps depend on both. The boundary is enforced by ESLint
(`domainPurityConfig`) and by `packages/domain/test/purity.test.ts`.

## Container image and supply chain (IG0-M01)

`docker/postgres/Dockerfile` builds on `imresamu/postgis:17-3.5`, pinned by the **immutable
digest of its manifest list**:

```
sha256:35fe7dceda62bfe7d2965b0ba78d915ff9f901b5e0466d633ecc58421b5b5210
```

Pinning the manifest-list digest (not a per-architecture digest) keeps multi-architecture builds
working: arm64 developer machines and amd64 CI runners both resolve to reviewed content.
`imresamu/postgis` is a multi-architecture build of the official `postgis/postgis` image recipe;
the official image publishes amd64 only and `pgvector/pgvector` ships no PostGIS, so neither
upstream alone satisfies this project.

Verified in the running image: PostgreSQL 17.6, PostGIS 3.5.3, pgvector 0.8.6, pg_trgm 1.6, and
the extension test in `packages/testing` re-asserts availability on every CI run.

**Digest review procedure** (run when a PostgreSQL/PostGIS upgrade is wanted, or on a security
advisory):

1. `docker buildx imagetools inspect imresamu/postgis:17-3.5` and read the manifest-list digest;
2. compare upstream release notes and the PGDG package versions;
3. update the digest **and the two apt pins** in `docker/postgres/Dockerfile` in a `chore(db)`
   pull request;
4. CI's `db` job rebuilds and re-runs the extension and RLS suites against it, and
   `postgres-image.yml` starts the built image and asserts the versions it actually contains.

**Closed (ADR-040).** The apt layer is pinned too — `postgresql-17-pgvector=0.8.6-1.pgdg12+2`
and `pgbackrest=2.59.1-1.pgdg12+1`, both from the PGDG repository the base image already trusts —
and the image is published to `ghcr.io/georgenton/eia-studio-postgres` and deployed **by digest**.
An apt pin is reproducible while PGDG keeps the version in its index and fails the build loudly
when it does not; the published digest is what makes the artefact permanent.

## Self-hosted fonts, and why the build fetches nothing

The three families of the approved typographic system (design v0.2) are committed as `.woff2`
under `apps/web/app/fonts/` and loaded through `next/font/local`. They used to be
`next/font/google`, which **downloads them from `fonts.gstatic.com` while `next build` runs**.

That is not a caching detail, it is a build-time dependency on a third party. When the build host
cannot reach Google, Next emits a warning, still emits the generated font CSS module, and the build
then fails resolving files it never fetched:

```
Warning: Error while requesting resource
There was an issue establishing a connection while requesting
https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&display=swap
...
Module not found  [next]/internal/font/google/jetbrains_mono_23b75448.module.css
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @eia/web@0.0.0 build: `next build`
```

It was seen once locally during the pre-deploy wave, could not be reproduced then, and was recorded
as an open question rather than dismissed. It reproduced in the container gate of PR #57 on
30 September 2026. `docs/EIA_COOLIFY_DEPLOYMENT.md` carries the operational account; this section
is the supply-chain record.

### What is committed

| File | Family | Weights declared | Subset | SHA-256 |
|---|---|---|---|---|
| `source-serif-4-latin.woff2` | Source Serif 4 (v14) | 400, 600 | `latin` | `286e05e5…d08ca122` |
| `archivo-latin.woff2` | Archivo (v25) | 400, 500, 600 | `latin` | `7150c0ec…f87c4ba4` |
| `jetbrains-mono-latin.woff2` | JetBrains Mono (v24) | 400, 500 | `latin` | `2c32b9b3…8e400af4` |

**One file per family**, because Google serves one *variable* woff2 per family and subset: the
per-weight `@font-face` rules in its CSS all point at the same file, and `apps/web/app/layout.tsx`
reproduces exactly that — one `src` entry per weight against one file. The bytes are the ones
`next/font/google` was fetching: the identical build, run before and after the change, emitted
woff2 files with these same three hashes.

These are the Google Fonts API's builds — subsetted derivatives of the upstream releases — not the
upstream release files. `tooling/scripts/fetch-web-fonts.mjs` re-derives them, reproducing the same
`css2` URL and the same user agent the Next loader used (Google serves `ttf` to anything that does
not look like a browser), and fails if either the committed file or upstream has moved:

```
pnpm fonts:check                                    verify against upstream
node tooling/scripts/fetch-web-fonts.mjs --write     refresh, then review the diff
```

It is **not** wired into `build`, `dev` or CI, and must not be: a check that reaches the network is
the thing this change removed. `apps/web/test/build-hermeticity.test.ts` runs in the ordinary unit
suite instead — it fails if anything under `apps/web` imports a network font loader again, and pins
the three hashes so a swapped font file fails a test rather than being noticed in a screenshot.

### Licences

All three are under the **SIL Open Font License, Version 1.1**, with no Reserved Font Name, which
permits redistribution of the files and of subsetted derivatives provided the licence travels with
them. The licence text sits beside each font as `<family>-OFL.txt`, copied from each family's
directory in `github.com/google/fonts`:

| Font | Copyright | Upstream |
|---|---|---|
| Source Serif 4 | 2014 The Source Serif 4 Project Authors | `adobe-fonts/source-serif` |
| Archivo | 2020 The Archivo Project Authors | `Omnibus-Type/Archivo` |
| JetBrains Mono | 2020 The JetBrains Mono Project Authors | `JetBrains/JetBrainsMono` |

### The one behavioural narrowing, stated rather than discovered later

`subsets: ["latin"]` in `next/font/google` selects what is **preloaded**, not what is downloaded:
the loader served every subset Google returns — latin, latin-ext, greek, cyrillic, cyrillic-ext and
vietnamese, 15 files and 348 KB — each with its own `unicode-range`. Only `latin` is committed here,
so a character in one of the other five ranges now renders in the CSS fallback chain
(`Georgia` / `system-ui` / `Menlo`, `packages/ui/src/tokens.css`) rather than in the brand font. The
glyph is correct; the typeface is not the brand one for that character.

Measured exposure at the time of the change: **none**. A scan of `packages/i18n/src`,
`packages/ui/src`, `apps/web/app`, `apps/web/components` and all of `fixtures/` found no character
in any of the five. The seven non-ASCII characters in the interface — `→ ↗ ↕ ▾ ● ○ ✓` — fall in no
Google subset of these families and were already rendering from the system font.

What could surface it is **project source data**, which is user input: a Shuar name carrying `ĩ`,
`ũ` or `ẽ` (the `vietnamese` range), or a document with a Central-European name (`latin-ext`). The
remedy is to add that subset's file and its `unicode-range`, which costs one `localFont` call per
subset, because `next/font/local` takes one `declarations` list per call.

## Better Auth upgrade guard (IG0-M02)

`better-auth` is pinned to an exact version. `apps/web/test/auth-schema-compat.test.ts` asks the
installed library which fields it requires (`getAuthTables` from `@better-auth/core/db`, the same
source its own migrator uses) and compares them with our hand-written Drizzle `auth` schema. It
runs offline in the unit suite.

Upgrade procedure:

1. bump `better-auth` (and `@better-auth/core`) in a `chore(deps)` pull request;
2. CI fails the compatibility test naming any missing field (this is how `account.issuer` would
   have been caught before runtime);
3. add the columns to `packages/db/src/schema/auth.ts`, run `pnpm db:generate`, review the SQL by
   hand and commit schema + migration with the version bump;
4. vendor migrations are never executed automatically against any environment.
