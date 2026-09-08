---
"@eia/web": minor
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/testing": patch
---

The client portal, as a publication rather than a mirror.

Two surfaces. `Portal del cliente` is where the consulting team prepares an update, sees what it
would say, publishes it and reads the history; `/portal/:tenant/:project` is the standalone page a
customer would see, with its own chrome, no rail, no operational vocabulary and a print stylesheet.
Between them sits `portal.client_publication`: an immutable, versioned, allowlisted snapshot that
somebody with `portal.publish` decided the client may see, on a date. The client's page loads that
one row and issues no statement against a survey answer, an assignment, a validated coding, a
finding, a document or a parcel — asserted by observing the SQL, not by inspection.

The payload is **composed from a closed vocabulary, never filtered from a record**, so there is
nowhere in it to put a respondent, an owner, a parcel code, a technician, a specialist's
justification, a model proposal or a confidence score; a second scan catches a forbidden concept
smuggled into free text. `DEMO_SIMULATION` is refused outright — the demonstration field campaign
never becomes client progress — and live operational data is admitted only as an aggregate the
caller declares publication-safe. The affected-parcel count is withheld by name, because the study's
corpus states 70 in one place and 71 in another and that review is open: publishing either would
settle it by accident in the firm's name.

`portal.preview` is new beside the existing `portal.publish`: a reviewer checks what would go out and
cannot send it. External client access is deliberately **not** built — no grant, no portal session,
and `eia_portal` is still granted nothing — so the standalone route requires an internal session and
says so above the content. Migrations `0029` (schema `portal`, `client_publication`) and `0030`
(grants, RLS, immutability by trigger). ADR-027 records the decision and amends ADR-009 §3 and §5.
