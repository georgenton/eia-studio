---
"@eia/field": patch
---

"Todo sincronizado" now means the device is holding nothing, not that the command queue is empty.

The chip on *Mi trabajo* counted `sync_outbox` rows in state PENDING. With a photograph still on
the phone it read **Todo sincronizado** while the parcel read *Predio · Pendiente de subida*, and
the same device simultaneously refused sign-out with "Hay 4 elemento(s) sin sincronizar" — two
answers to one question.

`countPendingWork` is now the single arithmetic, used by the chip and by the sign-out guard, so
they cannot drift apart again.
