#!/usr/bin/env bash
# Enable TLS before handing over to the official PostgreSQL entrypoint.
#
# The upstream postgres/postgis images ship without TLS, so a database reached over a public
# endpoint (for example a Railway TCP proxy from Vercel) would otherwise be unencrypted. A
# self-signed certificate is generated once per volume; it protects the connection in transit for
# staging. Clients still connect with `sslmode=require` (encryption without certificate pinning);
# a provider-issued or internal CA certificate is required before production (docs/TECH_DEBT.md).
#
# Local development and CI are unaffected: `ssl = on` does not force TLS, and pg_hba still accepts
# plain `host` connections, so Testcontainers and docker compose keep working unchanged.
set -euo pipefail

CERT_DIR="${EIA_SSL_DIR:-/var/lib/postgresql/certs}"
CERT_FILE="${CERT_DIR}/server.crt"
KEY_FILE="${CERT_DIR}/server.key"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "${CERT_DIR}"
  if [ ! -s "${CERT_FILE}" ] || [ ! -s "${KEY_FILE}" ]; then
    echo "eia: generating self-signed TLS certificate in ${CERT_DIR}"
    openssl req -new -x509 -days "${EIA_SSL_DAYS:-825}" -nodes \
      -text -subj "/CN=${EIA_SSL_CN:-eia-studio-postgres}" \
      -out "${CERT_FILE}" -keyout "${KEY_FILE}" 2>/dev/null
  fi
  chown -R postgres:postgres "${CERT_DIR}"
  chmod 600 "${KEY_FILE}"
  chmod 644 "${CERT_FILE}"
fi

# Append the TLS switches so an explicit `command:` in compose or Railway still wins for the rest.
exec /usr/local/bin/docker-entrypoint.sh "$@" \
  -c ssl=on \
  -c ssl_cert_file="${CERT_FILE}" \
  -c ssl_key_file="${KEY_FILE}"
