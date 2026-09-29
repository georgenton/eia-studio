# syntax=docker/dockerfile:1.10
#
# EIA Studio — one immutable application image for three processes.
#
# The same image runs the web server, the worker and the migration runner; only the command
# differs. That is not a convenience: it is what makes "the digest validated in staging is the
# digest deployed to production" a checkable statement rather than a hope.
#
#   web      node apps/web/server.js
#   worker   node apps/worker/dist/main.js
#   migrate  node packages/db/dist/migrate.js
#
# Supply chain (DEPENDENCIES.md): the base is pinned by the digest of its *manifest list*, so both
# architectures resolve to reviewed content while multi-architecture builds keep working. Update
# procedure: `docker buildx imagetools inspect node:24-bookworm-slim`, compare release notes, bump
# the digest in a `chore(release)` PR. (`deploy` is not a permitted commitlint scope; the
#   allowed list is in commitlint.config.mjs.)
#   Tag at the time of pinning: node:24-bookworm-slim (Node 24 LTS, Debian bookworm).
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# ---------------------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Corepack pins pnpm from packageManager in package.json, so the build uses the same version the
# lockfile was written with. No global install, no drift.
RUN corepack enable
WORKDIR /src

# ---------------------------------------------------------------------------- deps
# Manifests and lockfile only, so a source-only change does not reinstall the world.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json        apps/web/
COPY apps/worker/package.json     apps/worker/
COPY apps/field/package.json      apps/field/
COPY packages/application/package.json      packages/application/
COPY packages/config/package.json           packages/config/
COPY packages/contracts/package.json        packages/contracts/
COPY packages/db/package.json               packages/db/
COPY packages/domain/package.json           packages/domain/
COPY packages/field-sync-contract/package.json packages/field-sync-contract/
COPY packages/i18n/package.json             packages/i18n/
COPY packages/testing/package.json          packages/testing/
COPY packages/ui/package.json               packages/ui/
# `--ignore-scripts` keeps husky (a `prepare` hook) out of a context with no .git.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------- build
FROM deps AS build
COPY . .
# Baked at build time, read by /health. Non-secret by construction: a commit identifier.
ARG GIT_SHA=unknown
ARG BUILD_ID=unknown
ENV NEXT_PUBLIC_GIT_SHA=${GIT_SHA} GIT_SHA=${GIT_SHA} BUILD_ID=${BUILD_ID} \
    NEXT_TELEMETRY_DISABLED=1
# `next build` needs a URL-shaped value to satisfy the env schema; it is a build-time placeholder
# and every deployment overrides it at runtime.
ENV PUBLIC_APP_URL=https://build.invalid
# Asks Next for the standalone server. It is off by default because Vercel, where staging runs
# today, builds its own output format and fails on a missing next-server.js.nft.json when
# standalone is on. The container is the only consumer that wants it.
ENV NEXT_OUTPUT=standalone
RUN pnpm --filter @eia/web build \
 && pnpm --filter @eia/worker build \
 && pnpm --filter @eia/db build

# ---------------------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
# Re-declared: ARGs do not cross stages. The runtime needs them because `apps/web/lib/version.ts`
# reads GIT_SHA at request time, not at build time — that is what makes /health report which
# digest is actually serving.
ARG GIT_SHA=unknown
ARG BUILD_ID=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_SHA=${GIT_SHA} \
    BUILD_ID=${BUILD_ID}
LABEL org.opencontainers.image.title="EIA Studio" \
      org.opencontainers.image.source="https://github.com/georgenton/eia-studio" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${BUILD_ID}"
WORKDIR /app

# The Next standalone tree is the dependency tree for all three commands. It was produced by
# tracing the real imports against the lockfile, so `pg` and `pino` inside it are exactly the
# versions the workspace resolved — no second install, no separate manifest to drift.
COPY --from=build --chown=node:node /src/apps/web/.next/standalone/. ./
COPY --from=build --chown=node:node /src/apps/web/.next/static        ./apps/web/.next/static
COPY --from=build --chown=node:node /src/apps/web/public              ./apps/web/public

# Worker and migrator bundles. Whole directories, not single files: bundling @eia/application
# brings the AWS SDK and pdf.js, whose dynamic imports make esbuild split the output into chunks.
# Their only runtime externals are pg and pino.
COPY --from=build --chown=node:node /src/apps/worker/dist     ./apps/worker/dist
COPY --from=build --chown=node:node /src/packages/db/dist     ./packages/db/dist
# Drizzle reads these at runtime; `MIGRATIONS_FOLDER` is `../migrations` from the bundle, so the
# folder must sit beside dist/ exactly as it does in the repository.
COPY --from=build --chown=node:node /src/packages/db/migrations       ./packages/db/migrations

# Node resolves upwards from the bundle's directory. pnpm's store has no top-level entries, so
# the two externals get an explicit link each — pointing into the same traced copies above.
RUN set -eux; \
    mkdir -p node_modules; \
    for m in pg pino; do \
      d="$(cd node_modules/.pnpm && ls -d "$m"@*/node_modules/"$m" | head -1)"; \
      ln -sfn "./.pnpm/$d" "node_modules/$m"; \
    done; \
    node -e "Promise.all([import('pg'),import('pino')]).then(()=>console.log('runtime deps resolve'))"

USER node
EXPOSE 3000
# Default is the web server; worker and migrate override the command. Nothing here is a secret,
# and no .env is copied: every environment injects its own configuration.
CMD ["node", "apps/web/server.js"]
