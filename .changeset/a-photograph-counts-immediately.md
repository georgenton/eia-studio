---
"@eia/field": patch
---

Taking a photograph updates the count every screen reads.

The capture handler re-read only the parcel's own list, so the shared summary — the chip, the tab
bar badge, *Ajustes* and the Centro de sincronización — stayed as it was until the next
synchronisation or pull-to-refresh. A technician could hold three things and read two.

**Correction to an earlier description of this change.** It also said the stale summary could let
a device sign out with a just-taken photograph and lose it. That is not true of any build carrying
#80: since then the sign-out refusal calls `summarisePendingWork` **against the database at the
moment of the tap**, not the store's snapshot, and the comment on that call says so. The risk was
real only in the builds before #80, where the guard read the store's `PENDING` count. What this
fixes is the displayed number.
