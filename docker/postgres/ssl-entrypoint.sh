#!/usr/bin/env bash
# Enable TLS before handing over to the official PostgreSQL entrypoint (ADR-040 §3).
#
# ## Where the key pair comes from
#
# Two sources, in order:
#
#   1. **Provided** — `EIA_SSL_SOURCE_DIR` holds `server.crt` and `server.key` signed by the Cinta
#      Vera internal CA. This is what staging and production use, and it is the only source that
#      lets a client connect with `sslmode=verify-full`: a certificate the server signed for
#      itself proves nothing about who the server is.
#   2. **Self-signed fallback** — generated here, once, for local development and CI, where the
#      client and the server are the same machine and a CA would be ceremony.
#
# The material is always *staged* into `EIA_SSL_DIR` rather than read in place, because a mounted
# secret arrives owned by whoever mounted it and PostgreSQL refuses to start when its key is
# readable by anyone else. Staging is also what makes a read-only mount work.
#
# `EIA_SSL_REQUIRE_PROVIDED=true` refuses the fallback. An environment that meant to present a
# CA-signed certificate and silently presented a self-signed one instead would still answer
# `ssl = on`, still encrypt, and still fail `verify-full` at the first client — at which point the
# obvious remedy is to weaken the client. That is the failure this switch exists to prevent.
#
# ## What this script does not do
#
# It does not configure `archive_command`. pgBackRest is installed in the image and switched on
# per environment (ADR-040 §5); an image that archived by default would write WAL to somebody's
# bucket the first time they ran it locally.
set -euo pipefail

SSL_DIR="${EIA_SSL_DIR:-/var/lib/postgresql/certs}"
SOURCE_DIR="${EIA_SSL_SOURCE_DIR:-}"
CERT_FILE="${SSL_DIR}/server.crt"
KEY_FILE="${SSL_DIR}/server.key"

log() { echo "eia-ssl: $*" >&2; }
die() { log "$*"; exit 1; }

if [ "$(id -u)" = "0" ]; then
  mkdir -p "${SSL_DIR}"

  if [ -n "${SOURCE_DIR}" ] && [ -s "${SOURCE_DIR}/server.crt" ] && [ -s "${SOURCE_DIR}/server.key" ]; then
    log "using the certificate provided in ${SOURCE_DIR}"
    cp "${SOURCE_DIR}/server.crt" "${CERT_FILE}"
    cp "${SOURCE_DIR}/server.key" "${KEY_FILE}"
  elif [ ! -s "${CERT_FILE}" ] || [ ! -s "${KEY_FILE}" ]; then
    if [ "${EIA_SSL_REQUIRE_PROVIDED:-false}" = "true" ]; then
      die "EIA_SSL_REQUIRE_PROVIDED=true but no certificate was provided in '${SOURCE_DIR:-<unset>}' and none is present in ${SSL_DIR}. Refusing to fall back to a self-signed certificate."
    fi
    # The subject alternative name matters more than the common name: clients have verified
    # hostnames against the SAN for years and ignore CN, so a certificate without one fails
    # `verify-full` even when its CA is trusted. Defaulting to the CN keeps a bare configuration
    # working.
    CN="${EIA_SSL_CN:-eia-studio-postgres}"
    SAN="${EIA_SSL_SAN:-DNS:${CN},DNS:localhost,IP:127.0.0.1}"
    log "generating a self-signed certificate in ${SSL_DIR} (CN=${CN})"
    openssl req -new -x509 -days "${EIA_SSL_DAYS:-825}" -nodes -text \
      -subj "/CN=${CN}" -addext "subjectAltName=${SAN}" \
      -out "${CERT_FILE}" -keyout "${KEY_FILE}" 2>/dev/null
  else
    log "reusing the certificate already present in ${SSL_DIR}"
  fi

  # A certificate and a key that do not belong together make PostgreSQL fail with an error about
  # the private key rather than about the pair, which sends the reader to the wrong file.
  crt_hash="$(openssl x509 -noout -pubkey -in "${CERT_FILE}" | openssl sha256)"
  key_hash="$(openssl pkey -pubout -in "${KEY_FILE}" | openssl sha256)"
  [ "${crt_hash}" = "${key_hash}" ] || die "server.crt and server.key are not a pair"

  chown -R postgres:postgres "${SSL_DIR}"
  chmod 600 "${KEY_FILE}"
  chmod 644 "${CERT_FILE}"
fi

# Append the TLS switches so an explicit `command:` in compose or a deployment still wins for the
# rest.
exec /usr/local/bin/docker-entrypoint.sh "$@" \
  -c ssl=on \
  -c ssl_cert_file="${CERT_FILE}" \
  -c ssl_key_file="${KEY_FILE}"
