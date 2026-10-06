---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/web": minor
---

A consultancy can write a public presentation for a project, publish it, and take it down.

An editorial extension of the portal rather than a second product: the same authentication, the
same row-level security, the same storage and the same message catalogue. It is deliberately not
an extension of `client_publication` — that payload is a projection in which every figure was
computed and carries a provenance id, and this one is prose people wrote. Sharing a table would
have meant one schema admitting both, and the first hand-typed number stored in a projection is
the moment "every figure carries provenance" stops being true.

Three acts, three permissions: `portal.editorial.write` (new) edits the draft, `portal.preview`
reads it, `portal.publish` decides. Saving is not publishing, and editing after publishing changes
nothing a visitor sees, because a publication is an immutable snapshot with its own list of
authorised attachments.

`/p/:tenant/:project` is the one route served with no session. Its transaction carries no tenant,
project or user; two SELECT policies admit it, only while the page is visible, and every other
table still denies a transaction with no tenant. No fictitious role and no BYPASSRLS.
