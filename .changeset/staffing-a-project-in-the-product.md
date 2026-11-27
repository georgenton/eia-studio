---
"@eia/application": minor
"@eia/i18n": minor
"@eia/web": minor
---

A project created in the product can be staffed in the product

Found by running the new-project rehearsal on staging rather than by reading the code: *Nuevo
proyecto* created the project, redirected the creator to *Preparar proyecto*, and refused them —
*Tu rol Administración no incluye Preparar proyecto*. Every part of that was working as designed. A
tenant ADMIN has no implicit access to project data (D-015), the team stage read and did not write,
and `addProjectMembership` had no caller anywhere in the product. The only path left was an
operator script that also rewrites an identity's credential.

`createProject` now writes the creator a `COORDINATOR` membership in the same transaction and
audits it, and *Preparar proyecto* › **Equipo** gained one control — a person, a role, a button —
behind `project.members.manage`. The read model offers candidates as **null** rather than empty to
a reader who may not add anyone, so *this is not yours to decide* and *there is nobody left to add*
read differently; a candidate carries a display name and a tenant role and no address.

Nothing widens: `projects.create` is held only by OWNER and ADMIN, both of which already hold
`project.members.manage`, and TENANCY §6 asks precisely that such access be an audited membership
change. A `PROJECT_DATA_MANAGER` sees the team and no form. Another tenant's membership is refused
by the composite foreign key, asserted in the integration suite.

Closes TD-111. Opens TD-136: nobody can be taken off a project yet.
