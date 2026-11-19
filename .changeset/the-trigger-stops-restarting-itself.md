---
"@eia/field": patch
---

Finishing a synchronisation no longer starts another one.

`sync` depended on `syncing`, so ending a run gave it a new identity, which gave the effect that
calls it a new dependency, which ran it again. With anything left in the count the loop never
closed. Measured on the Android emulator on 19 November 2026: one saved draft, an empty queue,
*Sincronizando…* on screen and the last-sync time advancing from 17:51:41 to 17:52:31 in fifty
seconds nobody touched the phone.

Two changes, and they are separable on purpose:

- `sync` is referentially stable — the guard against overlapping runs now reads a ref, and
  `syncing` stays as state because the screens render it.
- The automatic trigger asks `retryableNow` instead of `countPendingWork`. The first counts what a
  request could actually deliver: queued commands, photographs, delivery photographs. The second
  counts everything the device is holding, including work only a person can clear — an order the
  server refused, a draft nobody submitted, a delivery that needs review.

Nothing stops being shown and nothing stops blocking sign-out; the manual button is untouched; and
coming back into signal still delivers a photograph whose upload had failed.
