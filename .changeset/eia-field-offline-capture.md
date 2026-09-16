---
"@eia/field": minor
"@eia/field-sync-contract": minor
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/web": minor
"@eia/testing": patch
---

EIA Field: offline-first capture for technicians who work where there is no signal.

A first-party React Native + Expo application in the workspace (`apps/field`), and the server half
that makes it safe. The invariant it exists to satisfy: sign in with a signal, drive into a
corridor with none, capture a day of work, close and reopen the application, submit on the device,
come back, synchronise — and produce **zero duplicates**, however many times the synchronisation is
retried.

The device sends four **domain commands** rather than rows — `visit.start`, `survey.upsert_draft`,
`survey.submit`, `visit.finish` — and the server executes them through the same use-cases the web
form calls, so a phone cannot write a row a browser could not. `commandId` is generated once at the
moment of intent and never regenerated; the new `app.field_sync_receipt` remembers what it produced
and replays it on a retry, which is what a draft retried *after* its own submit needs. Five
outcomes, and `superseded` is the one that earns its place: an obsolete intent settles instead of
retrying for ever and blocking the queue behind it.

A conflict never deletes local work. An assignment reassigned or cancelled while the technician was
offline, a campaign closed, a questionnaire that moved — each marks the row *requiere revisión* and
keeps every answer, and the server refuses to reinterpret answers against a questionnaire they were
not given to.

`EIA_FIELD_MOBILE` joins `CAPTURE_CHANNELS` as the first channel with `supportsOffline: true`, so
`field.surveys.offline_mode = required` is now a policy a project can actually set; the capability
catalogue still holds exactly fourteen keys and offline capture remains configuration (ADR-018).

The local database is SQLCipher keyed from SecureStore, and the application refuses to open one it
cannot verify is encrypted. The bundle contains no driver, ORM, application code, `node:` builtin or
secret — asserted by a lint boundary, a bundle-safety test, and a purity test that walks the new
`@eia/domain/mobile` entry point's import graph. Offline access is a window the server stamps,
`min(session expiry, now + 7 days)`; a disconnected device cannot learn that an account was revoked,
which is recorded rather than mitigated.

Migrations 0031 (capture-channel enum value), 0032 (`field_sync_receipt`) and 0033 (grants, FORCE
RLS, write-once by trigger). ADR-028 records the decision and supersedes the plan to adapt
ODK/Kobo/XLSForm, which is kept as history.
