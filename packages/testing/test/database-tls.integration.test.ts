import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Database TLS with the Cinta Vera internal CA (ADR-040 §3–4).
 *
 * The self-hosted deployments present a certificate an internal CA signed, and clients connect
 * with `sslmode=verify-full`. Three properties decide whether that is real, and only the third
 * one is usually tested:
 *
 *   1. the connection is encrypted — `pg_stat_ssl.ssl` is `true` for *this* backend;
 *   2. the right CA is accepted;
 *   3. **a different CA is refused.**
 *
 * Without (3), (2) proves nothing: a client that trusts everything also trusts the right
 * certificate. The suite therefore issues two unrelated CAs and asserts the second one fails,
 * and asserts that the connection fails with no CA at all — which is what catches a test CA that
 * has somehow found its way into the system trust store.
 *
 * The mechanism under test is `sslrootcert` in the connection URL. `pg-connection-string` reads
 * that file into `ssl.ca`, and in its default (non-`uselibpqcompat`) mode `verify-full` leaves
 * Node's TLS defaults alone — certificate chain **and** hostname both verified. So the server
 * certificate must carry a subject alternative name; a common name alone is ignored by every
 * current client, which is why `ssl-entrypoint.sh` emits a SAN even for its self-signed fallback.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PASSWORD = "tls-probe-password";

interface Material {
  readonly dir: string;
  readonly caPath: string;
  readonly strangerCaPath: string;
}

/**
 * Issue a CA, a server certificate for `localhost`, and a second unrelated CA.
 *
 * `openssl` rather than a library: it is present on the CI runners and on every developer
 * machine that can already build the image, and issuing X.509 by hand in Node would be more code
 * to trust than the thing being tested.
 */
function issueMaterial(): Material {
  const dir = mkdtempSync(join(tmpdir(), "eia-tls-"));
  const ssl = (...args: string[]): void => {
    execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  };

  ssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-subj",
    "/CN=EIA test CA",
  );
  ssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=eia-studio-postgres",
  );
  writeFileSync(
    join(dir, "ext.cnf"),
    "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n",
  );
  ssl(
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-days",
    "2",
    "-out",
    "server.crt",
    "-extfile",
    "ext.cnf",
  );
  ssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-keyout",
    "stranger.key",
    "-out",
    "stranger-ca.crt",
    "-subj",
    "/CN=Unrelated CA",
  );

  // The server key is mounted read-only; the entrypoint stages it and fixes the mode itself, but
  // leaving it world-readable here would be a bad example to copy.
  chmodSync(join(dir, "server.key"), 0o600);
  return { dir, caPath: join(dir, "ca.crt"), strangerCaPath: join(dir, "stranger-ca.crt") };
}

interface Attempt {
  readonly connected: boolean;
  /** `undefined` when the connection never opened; `pg_stat_ssl` has no row to report. */
  readonly ssl?: boolean | undefined;
  readonly error?: string | undefined;
}

async function attemptConnection(url: string): Promise<Attempt> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    const result = await client.query<{ ssl: boolean }>(
      "select ssl from pg_stat_ssl where pid = pg_backend_pid()",
    );
    return { connected: true, ssl: result.rows[0]?.ssl };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe("database TLS with an internal CA", () => {
  let material: Material;
  let container: StartedTestContainer;
  let base: string;

  beforeAll(async () => {
    material = issueMaterial();
    const image = await GenericContainer.fromDockerfile(resolve(ROOT, "docker/postgres")).build(
      "eia-studio/postgres-tls-test:17-3.5-pgvector",
      { deleteOnExit: false },
    );
    container = await image
      .withEnvironment({
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: PASSWORD,
        POSTGRES_DB: "tls_probe",
        EIA_SSL_SOURCE_DIR: "/tls",
        // The point of the exercise: this environment refuses to fall back to a self-signed
        // certificate, so a failure here is a failure to use the provided one.
        EIA_SSL_REQUIRE_PROVIDED: "true",
      })
      .withBindMounts([{ source: material.dir, target: "/tls", mode: "ro" }])
      .withExposedPorts(5432)
      // Twice: the official entrypoint runs initdb against a temporary server and restarts. A
      // client that connects in that window is disconnected mid-statement.
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(180_000)
      .start();
    base = `postgres://postgres:${PASSWORD}@${container.getHost()}:${container.getMappedPort(5432)}/tls_probe`;
  }, 300_000);

  afterAll(async () => {
    await container?.stop().catch(() => undefined);
    if (material) rmSync(material.dir, { recursive: true, force: true });
  });

  it("serves TLS from the provided certificate rather than generating one", async () => {
    const attempt = await attemptConnection(`${base}?sslmode=no-verify`);
    expect(attempt.connected).toBe(true);
    expect(attempt.ssl).toBe(true);
  });

  it("accepts a client that trusts the issuing CA, under verify-full", async () => {
    const attempt = await attemptConnection(
      `${base}?sslmode=verify-full&sslrootcert=${material.caPath}`,
    );
    expect(attempt.error).toBeUndefined();
    expect(attempt.connected).toBe(true);
    expect(attempt.ssl).toBe(true);
  });

  it("refuses a client that trusts a different CA", async () => {
    const attempt = await attemptConnection(
      `${base}?sslmode=verify-full&sslrootcert=${material.strangerCaPath}`,
    );
    expect(attempt.connected).toBe(false);
    expect(attempt.error).toMatch(/certificate/i);
  });

  it("refuses a client that supplies no CA at all", async () => {
    // If this ever passes, the test CA reached a system trust store and the previous assertion
    // stopped meaning anything.
    const attempt = await attemptConnection(`${base}?sslmode=verify-full`);
    expect(attempt.connected).toBe(false);
  });
});
