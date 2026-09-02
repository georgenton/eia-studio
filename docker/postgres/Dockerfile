# EIA Studio — local/CI PostgreSQL with PostGIS + pgvector.
#
# Base: imresamu/postgis, a multi-architecture (amd64 + arm64) build of the official
# postgis/postgis image recipe (Debian bookworm + the PostgreSQL Global Development Group apt
# repository). The official postgis/postgis image publishes amd64 only, and pgvector/pgvector
# ships no PostGIS, so neither upstream alone covers this project's requirements on both the
# developer machines and the CI runners.
#
# Supply chain (IG0-M01): the base is pinned by the immutable digest of its *manifest list*, so
# every architecture resolves to reviewed content while multi-architecture builds keep working.
# Tag at the time of pinning: 17-3.5 (PostgreSQL 17.6, PostGIS 3.5.3).
#
# Review/update procedure (also in docs/DEPENDENCIES.md):
#   1. docker buildx imagetools inspect imresamu/postgis:17-3.5   → read the manifest-list digest
#   2. compare the upstream release notes and the PGDG package versions
#   3. update the digest below in a `chore(db)` PR
#   4. CI's `db` job rebuilds and re-runs the extension verification test, which asserts the
#      PostgreSQL, PostGIS and pgvector versions actually present in the image
FROM imresamu/postgis:17-3.5@sha256:35fe7dceda62bfe7d2965b0ba78d915ff9f901b5e0466d633ecc58421b5b5210

# pgvector from the same PGDG repository the base image already trusts.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-17-pgvector; \
    rm -rf /var/lib/apt/lists/*
