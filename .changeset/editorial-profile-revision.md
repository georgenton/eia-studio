---
"@eia/domain": patch
"@eia/i18n": minor
"@eia/db": minor
"@eia/application": minor
"@eia/web": minor
---

A firm's public profile gets a revision that counts, and a tenant administrator can actually set it.

**The revision was not one.** `portal.editorial_tenant_profile` had no revision column: the read
model derived `0` from absence and `1` from presence, so once the row existed the number never
moved again, every administrator read `1`, every save matched, and the second one silently
overwrote the first. Migration 0054 adds a real counter, and the comparison moves **inside** the
write — `UPDATE … WHERE tenant_id = ? AND revision = ? RETURNING` to change it, `INSERT … ON
CONFLICT DO NOTHING RETURNING` to create it — because a `SELECT` that matches followed by an
unconditional `UPDATE` is passed by both of two concurrent transactions. `saveEditorialDraft` had
the same shape one function above and is fixed the same way; its unique index already existed.

**`portal.profile.manage` was unusable by half the people who hold it.** It is a tenant permission
(OWNER, ADMIN) and an ADMIN with no project membership resolves a project for administration with
no project permissions, so the editorial route's *write-or-preview* gate denied them before the
panel they were entitled to rendered. The surface now has a profile-only mode, and what makes it
correct is that `loadEditorialDraft` is **not called**: the draft is not fetched and hidden, it is
not fetched. No `portal.preview`, no `portal.editorial.write` and no project membership was
granted to achieve it.

**And the content scan was reading identifiers as prose.** It ran over the whole serialised
payload, so a stored object id — a UUID — carrying a run of exactly ten digits refused the page as
an `identity_number`, naming something the author never typed. It now scans the strings a reader
would see and skips the fields this product generates.
