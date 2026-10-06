---
"@eia/application": minor
---

A consultancy's intake is planned from a manifest before anything is created.

`plan(manifest, snapshot)` is pure and says one of four things about every tenant, project,
identity, membership and delivered file: it would be created, it already exists, it requires review,
or the product has no path for it. Re-planning an applied manifest proposes nothing, which is what
stops a repeated onboarding duplicating a project or re-sending an invitation.

The manifest is data outside the repository, because it carries a team's names and will carry their
addresses. `pnpm intake:plan` is dry-run only and refuses `--apply` rather than ignoring it: applying
needs an explicit destination and an authorization the script cannot verify.

Two refusals are the point. An email address is never derived from a name. A declared CRS is never
assumed, and a layer is never attributed to a road by name resemblance.
