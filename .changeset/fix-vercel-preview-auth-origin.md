---
"@eia/web": patch
---

Trust this deployment's own Vercel origins, so a Preview can sign in to itself.

A Vercel deployment answers on two hostnames: its immutable per-deployment URL (`VERCEL_URL`) and
its stable per-branch alias (`VERCEL_BRANCH_URL`). The environment derived `BETTER_AUTH_URL` from
the branch alias, and Better Auth trusts the origin of its base URL plus whatever `trustedOrigins`
lists — which on Preview was empty. A reviewer opening the deployment URL therefore posted from an
origin the server did not know: `POST /api/auth/sign-in/email` → `403`, `Invalid origin`.

`resolveTrustedOrigins` now builds the list from explicit configuration plus this deployment's own
platform hostnames, validated, deduplicated and order-stable. No origin check and no CSRF check is
disabled, and no wildcard is used: `.vercel.app` is a shared domain, not a trust boundary, so every
entry is a literal origin that we configured or that the platform handed to this process as our
own. Loopback origins are honoured only in `local` and `test`, and dropped in deployed environments
even if configuration still carries them.
