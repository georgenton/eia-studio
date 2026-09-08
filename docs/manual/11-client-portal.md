# 11 · Client portal — the published client view

Two surfaces, and the distance between them is the point.

- `/t/…/p/…/portal` — **Portal del cliente**, where the consulting team prepares, previews,
  publishes and reads the history.
- `/portal/:tenant/:project` — **Vista del cliente**, the standalone page a customer would see.

## What a publication is

**An immutable, dated snapshot somebody decided the client may see.** Not a view over the project.
Between one publication and the next, what the client sees does not change, and the page shows the
date so nothing looks fresher than it is.

`v1`, `v2`, `v3`. A publication is never edited: the database refuses UPDATE and DELETE by grant and
by trigger, so a correction is a new version and _what did we tell the client in September_ stays
answerable.

## What the client's page reads

One row of `portal.client_publication`, and nothing else. It issues no query against a survey
answer, an assignment, a validated coding, a quality finding, a document or a parcel table — not
"filters them out"; does not ask. An integration test watches the SQL to keep it that way.

## What a publication may contain

Composed from an allowlist, never filtered from a record. The payload has **nowhere to put** a
respondent, an owner, a parcel code, a technician, a finding, a specialist's justification, a model
proposal, a confidence score, an audit entry or an internal note.

| Section                           | Today, for the pilot                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Resumen del estudio               | 7,4 km de corredor · 141 predios frentistas                                           |
| Territorio                        | the corridor and the four areas of influence, generalised for drawing. **No parcels** |
| Participación y componente social | 119 fichas socioeconómicas · 185 participantes en asambleas                           |
| Plan de Manejo Ambiental          | 9 planes · 20 programas · 86 medidas, and the plans' titles. Not the measure text     |
| Seguimiento                       | _"No se ha publicado todavía información de avance operativo."_                       |
| Entregables                       | an honest empty state                                                                 |

## What it refuses, and why the surface says so

**Simulated activity.** The demonstration field campaign — twelve assignments, four submitted
responses — carries regime `DEMO_SIMULATION` and can never be published. A client reading simulated
activity as their project's progress is the worst thing this product could do.

**The affected-parcel count.** The study's corpus states 70 in one place and 71 in another, and the
consistency review is open. The portal picks neither: publishing one would settle an open review by
accident in the firm's name, and publishing both would hand the client an internal review record.

Both appear under **No se publica** on the internal surface, with the reason, so the omission is a
decision a coordinator can read rather than a gap they have to notice.

**A forecast.** `client.portal.show_forecast` is false (D-019) and the validator rejects one
outright.

## Who may do what

|                          | Prepare and preview | Publish |
| ------------------------ | ------------------- | ------- |
| Coordinación de proyecto | yes                 | yes     |
| Revisión                 | yes                 | **no**  |
| Everyone else            | no                  | no      |

`portal.preview` and `portal.publish`. A reviewer checks what would go out without being able to
send it, exactly as they check a finding without running the rules.

## What is **not** built

**External client access.** There is no client identity, no invitation, no portal session, and
`eia_portal` is granted nothing. `/portal/:tenant/:project` requires an ordinary authenticated
internal session with `portal.preview`, and says so above the content:

> Vista previa interna · este enlace aún no está compartido con el cliente

There is no share token and no unguessable URL. Do not expose this route on a public hostname
(TD-005, TD-078).

**Withdrawing a publication.** Not implemented; the row is immutable and nothing marks it superseded
(TD-077).

**Milestones and deliverables.** No model exists yet, so those sections render empty states rather
than invented content.

## Printing

`Imprimir resumen` uses the browser. The print stylesheet drops the preview strip and the card
chrome and keeps the project, the date, the figures, the map and the notes — enough to take to a
council session. There is no PDF service, deliberately.
