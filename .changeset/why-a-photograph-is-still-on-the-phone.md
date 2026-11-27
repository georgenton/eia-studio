---
"@eia/domain": minor
"@eia/i18n": minor
"@eia/field": minor
---

A photograph that cannot be sent says so, and says what is missing

A technician may photograph a parcel before starting its visit. The photograph is kept, the row is
written, and the synchronisation skips it — correctly, because there is no visit for the server to
attach it to — and until now it skipped it in silence. On 26 November 2026 predio 100's photograph
sat on a device across three synchronisations reading *Pendiente de subida*: true, and useless.

`mediaHoldReason` is now one rule in `@eia/domain/mobile` that both the synchronisation and the
screen read, so they cannot disagree. The parcel screen names the missing step and the Centro de
sincronización counts the photographs waiting for it. Three further holds that were also silent are
closed: a wait for a position that nothing will ever settle is written off after two minutes rather
than skipped for the lifetime of the process; the capture's location step settles the row even when
the platform throws; and an open ficha re-reads its photographs when a synchronisation finishes, so
a chip no longer keeps saying *pendiente* about a photograph the server has acknowledged.

Separately, the Android reference background counts only the tiles the current frame is asking for,
and keeps the verdict of a tile that is still on screen between two frames. A late answer from a
tile that has scrolled away no longer changes the caption, and a background that painted completely
no longer reads as partial after a pan.

Android `versionCode` moves to demo 4, staging 12, production 4. No wire change:
`FIELD_SYNC_PROTOCOL_VERSION` stays 3 and the field map resource keeps schema version 3.
