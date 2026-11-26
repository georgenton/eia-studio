import { readFileSync } from "node:fs";
import { checkServerIdentity, type PeerCertificate } from "node:tls";

/**
 * The TLS options for a database reached through an SSH tunnel.
 *
 * ## The problem this solves
 *
 * A production database is not published, so an operator reaches it through a tunnel — and a
 * tunnel hides the host name, which is exactly what `sslmode=verify-full` checks. The connection
 * dials `localhost`; the certificate carries the database's own name. Something has to supply the
 * name that was hidden.
 *
 * ## Why `servername` alone does not do it
 *
 * `servername` is **SNI**: which name the client asks the server for. It does not decide which
 * name the certificate is *checked against* — Node's default `checkServerIdentity` runs against
 * the host it dialled. Through a tunnel that is `localhost`, so the connection fails with *Host:
 * localhost is not in the cert's altnames* and the flag does nothing it promised.
 *
 * Observed against the production database on 26 November 2026, whose certificate carries the
 * container's name and is issued by the internal CA. The failure was **closed** — nothing was
 * weakened, the connection simply never happened — but a flag whose documentation claims a
 * guarantee it does not provide is worse than no flag.
 *
 * ## Why the override is not a relaxation
 *
 * It runs Node's **own** identity algorithm, unchanged, against the name the operator stated the
 * tunnel leads to. A certificate for any other name is refused exactly as it would be without a
 * tunnel, and `rejectUnauthorized` still requires the chain to reach the given CA. What is
 * replaced is the *name to compare against*, which is the one fact the tunnel destroyed.
 *
 * Without `caPath` the system trust store decides, so an internally-issued certificate is
 * refused: the operator has to say which CA, which is the right direction to fail in.
 */
export function tunnelTlsOptions(servername: string, caPath?: string) {
  return {
    rejectUnauthorized: true,
    servername,
    checkServerIdentity: (_host: string, cert: PeerCertificate) =>
      checkServerIdentity(servername, cert),
    ...(caPath ? { ca: readFileSync(caPath, "utf8") } : {}),
  };
}
