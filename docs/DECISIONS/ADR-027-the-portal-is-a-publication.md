# ADR-027 — The client portal is a publication, and its payload is an allowlist

- Status: Accepted
- Date: 7 September 2026
- Amends: ADR-009 §3 and §5 (the projection's contents and its per-figure provenance)
- Related: ADR-005 (faceted provenance), ADR-019 (rules calculate, AI proposes, a human
  validates), ADR-022 (the report snapshot is the deliverable), ADR-024 (the PGAS is a document
  with a shape), ADR-025 (the product speaks Spanish), Gate 1 decision D-019 (portal forecast),
  `docs/CLIENT_PORTAL_DECISION.md`, `docs/SECURITY.md` §11, TD-005.

## Context

ADR-009 drew the boundary — separate surface, separate session, separate role, reads a published
projection and never the operational tables — and `docs/CLIENT_PORTAL_DECISION.md` recommended not
starting the portal until a second project and the compliance review existed. The owner has instead
authorised a **demonstrable published client view inside the protected Preview environment**, to
show a consulting firm what their customer could be given. That is a narrower thing than the portal
ADR-009 describes: no external client authenticates, nothing is shared outside the organisation,
and no personal data is involved.

Building the narrow thing well requires three decisions ADR-009 did not settle, and one it settled
in a way that has not survived contact with an actual reader.

## Decision

### 1. A publication is a row, and the client's page reads that row

`portal.client_publication` holds `(tenant_id, project_id, sequence, published_at, published_by,
schema_version, content_hash, payload, source_provenance_ids)`. The client surface loads one such
row and renders it. It issues no statement against `survey_answer`, `field_assignment`,
`human_review`, `ai_classification`, `quality_finding`, `document_chunk` or any parcel table — not
"filters them out", *does not query them* — and an integration test observes the SQL on the wire to
say so.

The row is **immutable**: `REVOKE UPDATE, DELETE` from the runtime role *and* a BEFORE UPDATE/DELETE
trigger, so not even the owning role can rewrite one. A correction is `v2`. "What did we tell the
client in September" has to stay answerable, and a projection that can be edited in place cannot
answer it.

It lives in the **`portal` schema** rather than in `app`, because the boundary is the architecture:
a grant can be written against a schema, and that is what the future external role will need.

### 2. The payload is composed from an allowlist, never filtered from a record

`clientPublicationPayloadSchema` is a closed, `strict()` structure with a closed vocabulary of
figure keys. There is nowhere in it to put a respondent, a parcel code, an owner, a technician, a
finding, a specialist's justification, a model proposal, a confidence score, an audit entry or an
internal note. The builder starts from nothing and adds only what it is allowed to add, so a column
added upstream next month contributes nothing here until somebody writes it in deliberately.

A second, weaker check scans the serialised payload for forbidden concepts in **free text**, because
a plan title and a note are the places a technician's name would actually arrive. The schema is the
defence; the scan is the reason a mistake in free text fails loudly rather than shipping.

### 3. `DEMO_SIMULATION` can never be published, and `LIVE_OPERATIONAL` only as a safe aggregate

`assertPublishableRegime` refuses a simulated figure outright, whatever else is true. A client
looking at simulated activity and reading it as their project's progress is the single worst
failure this product could have, and the pilot has exactly that data sitting beside the real
figures: a demonstration field campaign with twelve assignments and four submitted responses. It is
refused, and the internal surface says so by name rather than silently omitting it.

Live operational data may be published only when it is **aggregate** and the caller declares it
publication-safe. A running count of visits is a statement about staff work as much as about
progress, and "not simulated" is not the same as "the client's business".

Consequently the first Zamora publication carries the concluded study's own aggregates and the
shape of the management plan, and no operational progress at all. The *Seguimiento* section says
`No se ha publicado todavía información de avance operativo.` rather than showing a plausible zero.

### 4. An unresolved internal disagreement is not published, and the omission is deliberate

The project's corpus states **70** affected parcels in one place and **71** in another, and the
Quality Gate is holding that open. Publishing either would settle an open review by accident, in the
firm's name, on the customer's screen; publishing both would hand the customer an internal review
record. So the figure is omitted, and `PUBLICATION_WITHHELD_FIGURES` names it with the reason, so
the omission is a decision somebody can read rather than a gap somebody has to notice.

### 5. **Amendment to ADR-009 §5**: the publication carries the provenance; the figures carry words

ADR-009 asked every figure in the projection to carry its provenance facets. That was written before
there was a reader. `HISTORICAL_OBSERVED` on a municipal government's screen is internal vocabulary,
and it is also exactly the sort of leaked enum ADR-025 removed from the rest of the product.

The useful half of provenance for that reader is the **basis, in words** — *«Levantamiento
socioeconómico del estudio concluido»* — so that is what a `PublicFact` carries. The regime is
enforced at **build** time, where it decides whether the figure may be published at all, and the
publication row keeps `source_provenance_ids`, so an auditor can still ask what a published figure
rests on. Traceability is preserved and moved; it is not dropped.

### 6. Publishing is a decision with two grants, and previewing is the other one

`portal.publish` already existed and belonged to the COORDINATOR. This adds **`portal.preview`**:
opening the draft and the standalone client view. A REVIEWER holds preview and not publish — they
check what would go out and do not send it, which is what the role means in the Quality Gate too. A
VIEWER and a FIELD_TECHNICIAN hold neither. There is still no `CLIENT` project role (D-015).

### 7. External client access is not built, and the seam is named rather than half-built

There is no `ClientPortalGrant` row, no portal cookie, no `PortalContext`, and **`eia_portal` is
granted nothing**. A role with SELECT and no caller is surface with nobody behind it. Until the
grant and session model exist, `/portal/:tenant/:project` requires an ordinary authenticated
internal session with `portal.preview`, and says so in a strip *outside* the client content:
`Vista previa interna · este enlace aún no está compartido con el cliente`.

No share token, no unguessable URL, no new public hostname. The protection is the session, which is
the only kind that survives somebody forwarding a link.

## Consequences

- The client's page can lag the workspace indefinitely, and that is the product: *«el portal es una
  publicación, no un reflejo»*. The page always shows its date.
- Two rendering paths exist, as ADR-009 predicted. They share tokens and primitives and no data
  hooks; the duplication is accepted.
- Milestones and deliverables have no model yet, so the corresponding sections render honest empty
  states rather than invented content. When those entities arrive, the payload gains two arrays and
  the builder fills them; nothing else changes.
- The forecast has a shape in the payload and is structurally rejected by the validator. D-019 is
  unchanged: `client.portal.show_forecast` stays false, and a simulated projection can never be
  published.
- Printing is the browser's. A print stylesheet gives a customer something to take to a council
  session on any device today; a PDF rendering service for one page would be a product.
- Making this a real external portal is the work ADR-009 §6–7 describes and this ADR does not do:
  the grant model, a second authentication surface, the `eia_portal` grants and the isolation suite
  that proves a client session cannot reach an internal route (TD-005, TD-078).
