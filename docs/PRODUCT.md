# EIA Studio — Product Overview

> Status: architecture phase (Gate 1 pending). This document restates the approved design bundle
> (`design/reference/claude-design-v0.2/`) in product terms so that engineering decisions can be
> traced back to it. When this document and the bundle disagree, the bundle wins:
> **README = contract → prototype = behaviour → spec v0.2 = rules → screenshots = visual reference.**

## 1. What EIA Studio is

EIA Studio is a multi-tenant B2B SaaS for environmental consulting firms. It turns the scattered
process of producing an environmental and social impact study (field work, spreadsheets, GIS,
shared drives, photographs, PDFs, manual writing) into one traceable workflow:

```
Project → planning → field capture → parcels → surveys → validation
→ tabulation → social analysis → assisted coding → progress control
→ quality review → document generation → client progress portal
```

The tenant is the consulting organisation. Each tenant owns projects. Each project is created from
a **project profile** that decides which capabilities are enabled and how the territory is modelled.

## 2. The first real case (and why it is not the product)

The only real project available today is a completed road EIA in Zamora Chinchipe, Ecuador. Its
aggregate figures (road length, roadside parcels, socioeconomic surveys, consultation
participants) are **historical, verifiable numbers from a finished study**. Everything else the
prototype shows about that project (visited parcels, revisits, productivity, projected close,
activity feed, parcel geometry, the corridor alignment) is **DEMO / SYNTHETIC or RECONSTRUCTED**
and is labelled as such on screen.

Architectural consequence: none of those figures, the project name, the province, the customer
(a GAD, a local government), the consultancy name or the "road" project type may appear in
reusable core code. They live in project datasets, fixtures and seeds. See `docs/DEMO_ZAMORA.md`.

## 3. Personas and roles

The bundle names eight roles. The prototype's permission matrix collapses them into six columns.

| Role (README) | Matrix column (prototype) | Model (Gate 1 D-015) | Typical surface |
|---|---|---|---|
| Owner / Admin | ADMIN | tenant `OWNER` / `ADMIN` | Tenant Settings, Portfolio |
| Coordinador de proyecto | COORD. | project `COORDINATOR` | Command Center, Field Surveys inbox |
| Especialista social | ESPEC. | project `SOCIAL_SPECIALIST` | Social Intelligence, Parcel Workspace |
| Especialista ambiental | ESPEC. | project `ENVIRONMENTAL_SPECIALIST` | Quality Gate, Documents |
| Cartógrafo / GIS | GIS | project `GIS_SPECIALIST` | GIS / Parcel Explorer |
| Técnico de campo | CAMPO | project `FIELD_TECHNICIAN` | FieldFlow (mobile, later), Visits |
| Revisor | (not in matrix) | project `REVIEWER` | Quality Gate |
| Cliente (read-only) | CLIENTE | **not a role**: `ClientPortalGrant` | Client Portal only |
| (internal read-only) | — | project `VIEWER` | any surface, read-only |
| (staff without admin rights) | — | tenant `MEMBER` | Portfolio (own projects) |

Prototype permission matrix (capability × role), values RW / R / A (approval) / —:

| Capability | Admin | Coord. | Espec. | GIS | Campo | Cliente |
|---|---|---|---|---|---|---|
| Projects and configuration | RW | RW | R | R | R | — |
| Parcels and geometry | RW | RW | R | RW | R | — |
| Field surveys | RW | RW | R | — | RW | — |
| Personal and economic data | RW | R | RW | — | — | — |
| Social Intelligence | RW | R | RW | — | — | — |
| Quality Gate | RW | RW | RW | R | — | — |
| Report generation | RW | RW | RW | — | — | — |
| Deliverable approval | A | A | — | — | — | — |
| Client portal (aggregated) | RW | RW | R | — | — | R |

Gaps resolved at Gate 1 (see `docs/TENANCY.md`): "Revisor" and "Especialista ambiental" have no
dedicated column in the prototype matrix and are explicit project roles; the matrix mixes
tenant-wide rights (projects and configuration) with project-specific rights, which the model
separates; ADMIN has no implicit access to sensitive project data, OWNER does (audited).

## 4. Surfaces

Each surface answers one question and hands off to the next (spec §03).

| Surface | Question | Main role | Hands off to | Capability |
|---|---|---|---|---|
| Portfolio | Which projects does this firm have and in what state? | Owner/Admin | Command Center | `core.projects` |
| Command Center | Are we on time and what needs attention today? | Coordinator | GIS · Social · Quality Gate | `core.projects` |
| GIS / Parcel Explorer | Where are the parcels and what state is each in? | GIS · Coordinator | Parcel Workspace | `gis.maps` + `gis.parcels` |
| Parcel Workspace | What do we know about this parcel, in one place? | Specialist · Coordinator | Quality Gate · revisit | `gis.parcels` |
| Field Surveys | What arrived from the field and what is ready to validate? | Coordinator | Parcel Workspace | `field.surveys` |
| Social Intelligence | What does the data say and what remains to be coded? | Social specialist | Reports | `social.analytics` + `social.ai_coding` |
| Quality Gate | What must be reviewed before delivery? | Reviewer · Specialist | Source document · Reports | `quality.document_gate` |
| Client Portal | How is the study going, for the customer? | Client (read-only) | — | `client.portal` |
| Documents / RAG / Reports | (later phase, not designed) | | | `core.documents`, `quality.rag_assistant`, `reports.social_generator` |

Connected flow the prototype demonstrates end to end:
Command Center → alert → GIS → select row/polygon → Parcel Workspace → Quality Gate → finding;
and Command Center → social alert → coding queue → validate answer.

## 5. The fourteen non-negotiable invariants (README)

These are product requirements, not styling. Every one has an architectural owner in this repo.

| # | Invariant | Where it is designed |
|---|---|---|
| 1 | Tenant and project always visible; every internal route is `:tenant/:project/...` | `docs/TENANCY.md`, `docs/ARCHITECTURE.md` (routing) |
| 2 | Navigation governed by capabilities; disabled modules do not appear (no greyed-out, no padlock) | `docs/FEATURES.md`, ADR-002 |
| 3 | Internal workspace ≠ Client Portal; portal served from an aggregated projection | `docs/SECURITY.md`, ADR-009 |
| 4 | Real historical vs operational simulation; every datum carries a source type | `docs/PROVENANCE.md`, ADR-005 |
| 5 | Operational forecast is deterministic (`pending ÷ 5-day moving average`), never presented as AI | `docs/PROVENANCE.md` §Forecast |
| 6 | Map and table share one selection | `docs/ARCHITECTURE.md` (GIS module) |
| 7 | Parcel is the master territorial workspace | `docs/DATA_MODEL.md` |
| 8 | IMMUTABLE SOURCE / AI SUGGESTED / HUMAN VALIDATED are three separate layers | `docs/AI_GOVERNANCE.md`, ADR-007 |
| 9 | Versioned taxonomy; AI proposes, never creates categories | ADR-007 |
| 10 | Model score ≠ calibrated probability | `docs/AI_GOVERNANCE.md` |
| 11 | Quality Gate never declares compliance | ADR-008 |
| 12 | Data provenance is cross-cutting, one drawer component | ADR-005 |
| 13 | Explicit SOURCE TYPE vocabulary (the four v0.2 badges are presentation labels derived from faceted provenance, D-013) | `docs/PROVENANCE.md` |
| 14 | The 15 system states are part of every surface's contract | `docs/ARCHITECTURE.md` §States |

## 6. Capability catalogue and pilot profile

Fourteen capabilities. Pilot profile `road_eia_social` enables eleven; three remain catalogue
extensions visible only in Tenant Settings. Full model in `docs/FEATURES.md`.

```
core.projects        core.documents       gis.maps            gis.parcels
field.surveys        social.analytics     social.ai_coding    quality.document_gate
quality.rag_assistant reports.social_generator client.portal
climate.analytics (ext) compliance.pma (ext) audit.environmental (ext)
```

Note: the phase brief also named `field.offline_sync`. Gate 1 (D-020) kept the approved
14-capability catalogue and deferred the question; Slice 3 settled it in ADR-018. Offline capture
is the configuration `field.surveys.offline_mode = disabled | optional | required` under
`field.surveys`, and the catalogue stays at fourteen keys. Capability resolution is boolean; navigation presentation (ACTIVE / ANNOUNCED / HIDDEN) is
separate (D-014): Reports is ANNOUNCED, the three extensions are HIDDEN.

## 7. Out of scope for the approved design (v0.2)

FieldFlow mobile (only the inbox of synced records exists) · Report Generator · RAG Assistant ·
Climate Analytics · PMA Compliance · Environmental Audit · Branding of the portal.

The architecture must leave room for all of them without designing them now.

## 8. Language and locale

The approved UI copy is Spanish (Ecuador): decimal comma (`0,86`), dates like `28 ago 2026`,
abscissas like `2+840`. Copy is a product asset: system-state copy and Quality Gate language rules
are definitive. The architecture keeps all user-facing strings in message catalogues so that the
approved copy is preserved verbatim and future locales are possible.
