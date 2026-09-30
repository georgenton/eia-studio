# EIA Studio — PostgreSQL with PostGIS, pgvector and pgBackRest.
#
# One image for local development, CI and the self-hosted deployments (ADR-040). It is published
# to GHCR by `.github/workflows/postgres-image.yml` and **deployed by digest**, never by tag:
# a database image that moves under a running volume is the one supply-chain change nobody
# notices until a restore.
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
#   3. update the digest and the two apt pins below in a `chore(db)` PR
#   4. CI rebuilds and re-runs the extension verification, which asserts the PostgreSQL, PostGIS,
#      pgvector and pgBackRest versions actually present in the image
FROM imresamu/postgis:17-3.5@sha256:35fe7dceda62bfe7d2965b0ba78d915ff9f901b5e0466d633ecc58421b5b5210

# Exact apt versions, not floating names (TD-001). Both come from the PGDG repository the base
# image already trusts, so this adds no supply chain — only determinism.
#
# The trade-off, stated rather than discovered later: PGDG prunes older versions from its index,
# so a pin eventually stops resolving and the build fails **loudly**. That is the failure we want.
# Silently installing a different pgvector into a database that already holds vector columns is
# the failure we do not.
ARG PGVECTOR_VERSION=0.8.6-1.pgdg12+2
ARG PGBACKREST_VERSION=2.59.1-1.pgdg12+1

# pgvector: required by migration 0000 (`CREATE EXTENSION vector`), which is not conditional.
# pgBackRest: continuous WAL archiving and point-in-time recovery for the self-hosted deployments
#   (ADR-040 §5). It is installed, not configured: archiving is switched on per environment by
#   `archive_command`, and an image that archived by default would write a stranger's WAL
#   somewhere the first time somebody ran it locally.
# openssl: the TLS material handling in eia-ssl-entrypoint.sh.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      "postgresql-17-pgvector=${PGVECTOR_VERSION}" \
      "pgbackrest=${PGBACKREST_VERSION}" \
      openssl; \
    rm -rf /var/lib/apt/lists/*; \
    # Debian's `ssl-cert` package leaves a "snakeoil" self-signed key in the image. Nothing here
    # uses it, and it is world-readable to anyone who pulls the image — which is fine for what it
    # is and not fine as a thing an operator could point `ssl_cert_file` at by accident. A
    # database image that serves TLS should carry exactly one private key: the one it was given.
    rm -f /etc/ssl/private/ssl-cert-snakeoil.key /etc/ssl/certs/ssl-cert-snakeoil.pem

# TLS. Upstream postgres/postgis images ship without it; this wrapper turns it on and decides
# where the key pair comes from (ADR-040 §3). It prefers material an internal CA signed, and falls
# back to a self-signed pair only when nothing was provided — see the script for why that fallback
# can be refused outright.
COPY ssl-entrypoint.sh /usr/local/bin/eia-ssl-entrypoint.sh
RUN chmod +x /usr/local/bin/eia-ssl-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/eia-ssl-entrypoint.sh"]
CMD ["postgres"]
