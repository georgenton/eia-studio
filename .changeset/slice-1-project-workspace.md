---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/ui": minor
"@eia/web": minor
"@eia/worker": patch
---

Slice 1: the first product surfaces. Sign-in, Portfolio, the internal workspace shell with
capability-driven navigation, the Command Center over the project's historical aggregates and
clearly labelled demo simulation, and the reusable Data Provenance drawer.

Provenance is persisted with its four facets (regime, origin, ordered transformations,
granularity) and lineage edges; the v0.2 SOURCE TYPE badges stay derived presentation. Project
metrics are a typed measurement entity over a closed database enum, each row carrying a mandatory
`provenance_id`. The operational forecast is deterministic arithmetic with its inputs,
assumptions and algorithm version stored beside the result.

Authorization is unchanged in principle and now exercised by product routes: every workspace
route rebuilds and verifies the RequestContext server-side, calls `requireCapability` and
`requirePermission`, and the five new project-scoped tables enforce `has_project_access` under
forced RLS — so a tenant ADMIN without a project membership reads no project data (D-015).
