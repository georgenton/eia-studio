---
"@eia/web": patch
---

`bootstrap:owner` — the first account of a real deployment.

Public sign-up is disabled (IG0-H01) and `provision:identity` refuses production and accepts only
synthetic address domains, so a production database had no way to acquire its first identity: no
identity, no organisation, nobody able to sign in.

The new script is that one's mirror image, and the mirroring is the safety property. It accepts a
real address, refuses the synthetic domains, and **refuses any database that already has an
organisation** — so it can never be used as an administration tool and can never add an owner to a
live tenant. It creates the identity through Better Auth's own sign-up (re-enabled inside the
process only), then the organisation through `createTenant`, the same use-case the product would
call, so the capability rows and the `tenant.created` audit row are the product's own. It creates
no project, no campaign and no fixture.

`--dry-run` reports what it would do and writes nothing. `--tls-servername` and `--tls-ca` let it
reach a database over an SSH tunnel **without relaxing anything**: the chain is still verified
against the internal CA and the certificate's name is still checked, against the name the operator
states the tunnel leads to.
