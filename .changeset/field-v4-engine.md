---
"@eia/i18n": minor
"@eia/field-sync-contract": patch
"@eia/web": patch
"@eia/field": minor
---

EIA Field can deliver an invitation: one sync engine, a road selector, and the atomic switch.

Closes the implementation half of TD-126. The engine is **evolved, not duplicated**: `ensureWorkPack`
converts a v3 pack a handset was holding, evidence uploads before the outbox is read so a delivery
goes out in one window of signal, the delivery command shares `sync_outbox` with every other
command, the push goes through `/api/field/v4/sync` where the five inherited commands run on v3's
own engine, and the sweep releases a photograph only when the **command** was acknowledged.

Four audit findings fixed before any of it was wired. The v4 pull contract declared a `cursor`
while both ends sent two arrays of ids — the schema is now the wire, imported by the route and
validated by the client. A network cut during an evidence upload parked the photograph for ever,
because the failure wrote `SYNC_ERROR` and the selector only looked at `EVIDENCE_PENDING`;
retryable and permanent failures are now distinguished and a test fails the first sync and watches
the second pick it up. A hardcoded `APP_VERSION` made a build lie about itself. And `commandId`
came from `globalThis.crypto`, which is not on every React Native runtime.

Two gaps the audit had not named. `saveWorkPack` never filled the four tables the questionnaire
screens read, so a clean installation could hold a valid pack and show no surveys; the survey half
is now projected into v3's shape and written by `saveFieldPack` rather than by a second
implementation. And `replaceActiveProject` committed the deletion before writing the new pack — a
failure in between left a phone with neither road. It is one transaction now, and a test forces a
failure halfway and asserts road A survives whole.

`pendingCommands` no longer re-sends a command the server rejected. `FAILED` is written only when
the server answered and refused, and retrying a refusal for ever is a queue that never empties —
which `outbox-policy.ts` has said since Slice 3 while the selector contradicted it (TD-128).

**No emulator ran.** An AVD exists on this machine and there is no Java runtime, so the development
build the app requires cannot be produced here. EMULATOR_UAT_PENDING.
