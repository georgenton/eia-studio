# Design bundle v0.2 — known issues (recorded at Gate 1)

The approved bundle under `design/reference/claude-design-v0.2/` is **not modified** by this
record. Issues are listed so that implementation does not reproduce artefacts as requirements
and so that a future design iteration (v0.3) can address them. `support.js` is **not** to be
reconstructed.

| # | Issue | Where | Consequence for engineering | Status |
|---|---|---|---|---|
| 1 | Both `.dc.html` artifacts reference `./support.js`, which is missing from the bundle; the files do not render standalone as the README states. | `EIA Studio.dc.html`, `Arquitectura y Lenguaje Visual.dc.html` | Read behaviour from the extracted script/state model and the screenshots; do not reconstruct the runtime. | Recorded, not fixed |
| 2 | Numeric module counts are inconsistent: the `road_eia_social` template card says "7 módulos · 1 instrumento · 5 quality checks"; the Command Center header shows eight capability chips; Tenant Settings lists eleven included modules; the Portfolio card shows five chips "+ 4 módulos". | Tenant Settings › Project templates; Command Center; Portfolio | The profile enables the eleven capabilities listed in FEATURES.md §5.1 (ADR-003); counts in the prototype are fixture artefacts. | Recorded, not fixed |
| 3 | Some keyboard shortcuts are not wired: only `J`, `K` and `A` act in the coding queue; `M`, `N`, `R`, `S` and the command-palette chords (`G P`, …) are listed but inert. | Social Intelligence › Respuestas abiertas; command palette | The full shortcut set in the spec (§07 "modo lote") is the requirement; the prototype's wiring is partial. | Recorded, not fixed |
| 4 | The Client Portal milestone "Levantamiento socioeconómico" note contains "cierre proyectado 24 sep", a synthetic forecast value shown on the client surface without a DEMO mark, contradicting spec decision 09. | Client Portal | Gate 1 D-019: forecast off in the portal by default; only explicitly published snapshots with provenance; never `DEMO_SIMULATION`. Treat the note as a fixture artefact. | Recorded, not fixed |
| 5 | "Reports" appears in the rail as future/announced navigation ("FASE 3") although invariant 2 says disabled modules do not appear. | Rail | Gate 1 D-014: navigation presentation ANNOUNCED is allowed as a non-navigable placeholder; the capability is disabled for authorization and not invocable. | Recorded, decided |
| 6 | The README lists eight roles; the permission matrix has six columns (no "Revisor", no "Especialista ambiental"). | Tenant Settings › Roles y permisos | Gate 1 D-015 defines explicit project roles REVIEWER and ENVIRONMENTAL_SPECIALIST. | Recorded, decided |
| 7 | The "Usuarios" table lists the client (GAD) as a membership row with role "Cliente (read-only)". | Tenant Settings › Usuarios | Gate 1 D-015: CLIENT is not a project role; the UI may list `ClientPortalGrant`s next to memberships, but the models are distinct. | Recorded, decided |
| 8 | Spec v0.2 lists four SOURCE TYPE values and labels the operational forecast `RECONSTRUCTED`. | Spec §09, prototype provenance records | Gate 1 D-013: the four labels are presentation values derived from faceted provenance; the forecast is `SYSTEM_GENERATED` + `[DERIVED]` and is labelled RECONSTRUCTED by the current mapping until design revisits the label. | Recorded, decided |
| 9 | Prototype provenance validation values include `NO REQUIERE` and `NO VALIDADO`, beyond the spec's four (Validado · Parcial · Pendiente · Requiere especialista). | Provenance drawer | Adopted as `not_required` and `not_validated` in the validation-status vocabulary. | Recorded, adopted |

Anything in this list that requires a design change goes to the design team for v0.3; nothing
here authorises changing the approved files.
