---
"@eia/field": patch
---

Signing out stops deleting work the device has not delivered.

Signing out discards the local database, and the guard in front of it asked one question: are
there commands in `sync_outbox` with state `PENDING`? Three kinds of unsent work answer no to that
while sitting on the phone — a command that **failed**, a captured draft that never produced a
command, and a **photograph** waiting to upload, which lives in `local_media` and which the outbox
knows nothing about. The number was also the one the screen happened to be holding, so a capture
arriving between the last refresh and the tap was not counted either.

`decideSignOut` now reads `summarisePendingWork` — the same six-kind summary that already guarded
*changing project*, a far less destructive act — and reads it from the database at the moment of
the tap. A device holding nothing still signs out.

No message changed: the existing refusal already said how many items are unsynced, and now the
number is the true one.
