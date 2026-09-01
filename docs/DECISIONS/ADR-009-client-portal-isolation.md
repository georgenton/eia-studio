# ADR-009 — Client Portal as a separate security surface served from explicit publications

- Status: Accepted with conditions at Gate 1 (decisions D-015 and D-019 applied)
- Date: 2026-09-01 (amended 2026-09-01 after Gate 1)
- Related: SECURITY.md §11, DATA_MODEL.md §3.7, TENANCY.md, ADR-001, ADR-004, ADR-005, GATE-1.md

## Context

Invariant 3 and spec decision 02: the Client Portal is another surface, not the workspace with
hidden fields; it is served from an aggregated projection, never from operational tables; every
publication to the portal is an explicit decision. Never shown: names, phones, individual
economic data, health, individual vulnerability, parcel codes, internal notes, raw AI
classifications, Quality Gate findings, security/audit logs. The prototype's portal shows overall
progress, aggregate figures, milestones, sector progress by segment, upcoming deliverables,
recent activities, last update, a PDF download and a legal note. The prototype also shows a
projected close date inside a milestone note, which is a synthetic forecast value.

## Decision

1. **Separate surface**: own route group (`/portal/:tenant/:project`), own layout and chrome,
   own session cookie, own context type (`PortalContext`) that cannot be passed to internal
   use-cases, own database role (`eia_portal`) with grants only on the `portal` schema.
2. **Access exclusively by `ClientPortalGrant`** (D-015): `CLIENT` is not a project role and
   there is no other representation of client access. Internal users open the portal through
   the rail link and see the same projection (never a richer view).
3. **Explicit publication**: a role with `portal.publish` creates a `PortalPublication`
   (versioned, audited) whose `projection` is validated by a strict zod **allowlist schema**
   containing only: overall progress and phase summary, aggregate figures with regime and source
   type, milestones flagged visible, sector progress by project unit (no parcel identifiers),
   deliverables flagged visible, published activities, last update, legal note, branding
   references. Anything else is unrepresentable. Publication can be withdrawn immediately.
4. **No request-time reads of operational tables**: the portal reads `portal.publication` rows
   only; the PDF is rendered from the same projection.
5. **Provenance and forecast rules** (D-019): every figure in the projection carries its
   provenance facets; `DEMO_SIMULATION` values are rejected unless the tenant is a demo tenant.
   `client.portal.show_forecast` defaults to **false**; future projects may enable it. When
   enabled, only **explicitly published** `ForecastSnapshot`s may enter the publication
   (`published_forecast_snapshot_id`), and each published snapshot must include its provenance
   record, calculation time, algorithm version and assumptions, rendered with clear projection
   wording. A `DEMO_SIMULATION` forecast may **never** be published as real client progress; the
   publication validator rejects it. The prototype's "cierre proyectado" milestone note is a
   fixture artefact (DESIGN_BUNDLE_KNOWN_ISSUES.md).
6. **Denylist tests**: sentinel PII, parcel codes, internal notes, raw classifications, findings
   and audit entries seeded in the project must never appear in the rendered portal or PDF.
7. **Portal identity**: invitation-based accounts with magic link/password and optional 2FA;
   sessions are not interchangeable with internal sessions.

## Consequences

- Portal content can lag the workspace until someone publishes; that is intended ("cada
  publicación al portal es una decisión explícita").
- Two rendering paths (workspace read models vs portal projection) share tokens and primitives
  but not data hooks; some duplication of presentational code is accepted.
- Branding (logos, accent colour, legal footer) is portal configuration (Tenant Settings ›
  Branding, "próximamente") stored with the publication for reproducibility.
- Client users may hold grants in several tenants (a public authority contracting several
  consultancies); `User` is global, grants are per project.

## Alternatives rejected

- Same pages with role-based field hiding: one missed condition leaks PII; violates invariant 3.
- Read-only DB user over operational tables with column masks: still exposes structure and
  joins, and cannot express "aggregated only".
- Generating the portal from live queries at request time: not reproducible, not an explicit
  publication.
