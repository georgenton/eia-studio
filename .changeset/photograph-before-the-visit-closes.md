---
"@eia/field": patch
"@eia/i18n": patch
---

A photograph that failed to upload no longer loses its visit.

The device used to record the upload failure and carry straight on draining the outbox, so
`survey.submit` closed the visit seconds later. The next attempt asked for a new upload
authorization — deliberately a new one — and the server refused it, because that authorization was
issued after the visit closed. The photograph of predio 102 became undeliverable that way on
19 November 2026.

- A **visit-closing command is withheld** while this device still holds an unacknowledged
  photograph of that visit (`survey.submit`, `visit.finish`). Only that command, only that
  assignment: the `media.declare` of the photograph itself goes out in the same push and is
  admitted, because the visit is still open. Other parcels are untouched.
- The push now advances in **bounded passes**, so a parcel captured entirely offline — visit, ficha
  and photographs with no signal at all — arrives whole on one press of *Sincronizar* instead of
  three.
- The uploader **no longer stops at the first failed photograph**, so one bad file cannot block the
  ones behind it.
- A failed order is marked **resolved** once a later order delivered the same photograph, with the
  server's own rejection text kept. It stops counting as pending work; every other failure still
  blocks sign-out and the project switch.
- The Sync Centre says which ficha is waiting for its photograph, in both languages.
