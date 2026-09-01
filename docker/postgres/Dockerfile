# EIA Studio — local/CI PostgreSQL with PostGIS + pgvector.
# Base: imresamu/postgis (multi-arch amd64/arm64 builds of the official postgis image recipe,
# Debian bookworm + PGDG apt repository). pgvector is added from the same PGDG repository so
# both extensions come from maintained upstream packages. See docs/DEPLOYMENT.md §4 and
# packages/testing for the extension verification test.
FROM imresamu/postgis:17-3.5

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-17-pgvector; \
    rm -rf /var/lib/apt/lists/*
