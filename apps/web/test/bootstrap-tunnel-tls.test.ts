import type { PeerCertificate } from "node:tls";

import { describe, expect, it } from "vitest";

import { tunnelTlsOptions } from "../scripts/tunnel-tls";

/**
 * What `--tls-servername` must actually do.
 *
 * A production database is not published, so `bootstrap:owner` reaches it through an SSH tunnel —
 * and a tunnel hides the host name, which is precisely what `sslmode=verify-full` checks. The
 * flag exists to supply the name that was hidden.
 *
 * The first implementation set only `servername`, which is **SNI**: which name the client asks
 * for. It does not decide which name the certificate is checked against — Node checks the host it
 * dialled, which through a tunnel is `localhost`. The connection died with *Host: localhost is not
 * in the cert's altnames* and the flag did nothing it promised. The failure was closed, so nothing
 * was ever weakened; but a flag whose documentation claims a guarantee it does not provide is
 * worse than no flag.
 *
 * These assertions hold the options to the promise. They are cheap and they are the only thing
 * standing between a future refactor and a silent return to that state — in either direction,
 * because the negative control below fails just as loudly if somebody "fixes" a connection
 * problem by turning the check off.
 */
const CERT_NAME = "mcy3cskts8lspyv1pu0g37vz";

/** Enough of a certificate for Node's own identity algorithm: it reads these two fields. */
function certFor(name: string): PeerCertificate {
  return { subject: { CN: name }, subjectaltname: `DNS:${name}` } as unknown as PeerCertificate;
}

describe("the TLS options of a tunnelled bootstrap connection", () => {
  it("still verifies the chain", () => {
    expect(tunnelTlsOptions(CERT_NAME).rejectUnauthorized).toBe(true);
  });

  it("asks for the declared name by SNI", () => {
    expect(tunnelTlsOptions(CERT_NAME).servername).toBe(CERT_NAME);
  });

  it("checks the certificate against the declared name, not the host it dialled", () => {
    const options = tunnelTlsOptions(CERT_NAME);
    // The second argument is the host Node would otherwise check — the loopback end of the
    // tunnel. It must be ignored in favour of the name the operator stated.
    expect(options.checkServerIdentity("localhost", certFor(CERT_NAME))).toBeUndefined();
  });

  it("refuses a certificate for any other name", () => {
    /*
     * The negative control, and the reason the override is not a relaxation: it runs Node's own
     * algorithm unchanged, so a certificate that does not carry the declared name is refused
     * exactly as it would be without a tunnel.
     */
    const options = tunnelTlsOptions(CERT_NAME);
    const error = options.checkServerIdentity("localhost", certFor("otra-base-de-datos"));
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/does not match certificate/i);
  });

  it("reads no CA file when none was given, so the system store decides", () => {
    // Without `--tls-ca` the internal CA is not trusted, and an internally-issued certificate is
    // refused. That is the right direction to fail in: the operator has to say which CA.
    expect("ca" in tunnelTlsOptions(CERT_NAME)).toBe(false);
  });
});
