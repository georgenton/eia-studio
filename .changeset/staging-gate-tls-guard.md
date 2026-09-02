---
"@eia/contracts": minor
"@eia/web": patch
"@eia/worker": patch
---

Refuse an unverified database TLS mode in production. When `APP_ENV=production`, `DATABASE_URL`
and `DATABASE_MIGRATOR_URL` must carry `sslmode=verify-full` or `sslmode=verify-ca`, so the
staging arrangement of an encrypted connection to a self-signed certificate (`sslmode=no-verify`)
cannot reach production unnoticed. Non-production environments are unaffected. The check reads
only the `sslmode` parameter and reports the variable name, never its value.
