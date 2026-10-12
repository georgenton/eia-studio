---
"@eia/field": minor
---

EIA Field staging builds now target the validated Coolify STAGING origin. Build-time environment
labels no longer infer production from the host, and configuration rejects cross-environment,
malformed, loopback and credential-bearing API origins.

The next Android staging APK uses versionCode 4.
