---
"@eia/application": minor
---

A project's first corridor can be loaded into it: `planCorridorIntake` reports what a delivery
would do and writes nothing, `applyCorridorIntake` writes the axis, the parcels and their geometry
once, in one transaction, through the caller's own permissions and RLS.

Two layers are enough. Affectations, chainage and influence areas are reported as absent rather
than written as zero, and the same package applied twice is a no-op enforced by the existing
unique index rather than by a prior read. A different package against a destination that already
holds one is refused with `IDENTITY_CONFIRMATION_REQUIRED`, because a source code that is unique
today is not thereby stable across deliveries.

Side and chainage are derived from the delivered axis and recorded as such; a declared abscissa
stays null rather than becoming zero. Nothing is repaired: an invalid ring blocks its package.
