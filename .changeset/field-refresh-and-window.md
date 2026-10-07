---
"@eia/field": patch
---

A full refresh reconciles the current set, and the offline window governs invitations too.

**Pressing "update work" now says what a pull says.** The pack a device downloads is the full
current set of its project, and the writer treated it as additions only: an invitation or an
assignment the pack no longer mentioned stayed on screen, and stayed capturable, until some later
sync happened to take it away. The absent ids are now computed inside the same transaction and
handed to the revocation half `applyInvitations` and `applyAssignments` already had — no third
reconciliation algorithm, and revoked rather than deleted, because a draft, a photograph or an
unsent delivery may be sitting under the row.

That also fixed something nobody had hit yet: assignments were inserted plainly, so **a second
refresh of the same project failed on the primary key**. They upsert now.

**And a lapsed window stops a new delivery.** `WorkPack.validity` is what the server is prepared
to stand behind; surveys have refused capture past it since Wave 1 and invitations were not
asking. The screen drops the outcomes, the camera and the save button, and `saveDelivery` re-reads
the pack's expiry immediately before writing and refuses with `OfflineWorkExpired`. Work captured
*before* the lapse is untouched: it keeps its photograph, uploads its evidence and syncs when the
signal returns.
