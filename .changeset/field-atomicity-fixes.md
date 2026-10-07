---
"@eia/i18n": patch
"@eia/field": patch
---

Three windows closed in EIA Field: the delivery queue, the pack snapshot, and a revoked invitation.

**A delivery's id and its command are written together.** They were two calls, and an application
killed between them left an attempt with a `command_id` and no row in `sync_outbox` — which the
selector then skipped for ever, because it asked `command_id is null`. The delivery and its
photograph were stuck with no way out through the product. Both writes are now one transaction,
the selector asks `sync_outbox` instead, and a database already in that state is **repaired with
its own id**, never a new one.

**A work pack is written all at once.** It was the v4 rows, commit, then the survey snapshot — so
a failure in between left a device holding a new project beside another road's campaign, with
nothing on screen saying so. One transaction now, through the same row-level writer
`replaceActiveProject` uses, so the save and the switch cannot disagree about what a pack's rows
are.

**An invitation the device already knows it has lost takes no new capture.** The conflict path is
untouched: capturing offline and learning afterwards still keeps the attempt and its photograph
for review. But once a pull has told the phone the invitation is no longer this technician's,
letting somebody walk to a gate and photograph a delivery that is guaranteed to be refused is
wasting their morning. The screen goes informative, and `saveDelivery` re-reads and refuses
underneath it — because hiding buttons is not a check.
