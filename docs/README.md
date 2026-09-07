# EIA Studio documentation index

Phase: **architecture approved with conditions at Gate 1; implementation not yet authorized.**
See [DECISIONS/GATE-1.md](DECISIONS/GATE-1.md) for the conditions (D-013…D-020) and
`../CLAUDE.md` for the working rules every session must follow.

| Document | Purpose |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Product overview, personas, surfaces, the 14 invariants, capability catalogue summary |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modular monolith, bounded modules and dependencies, request lifecycle, routing, data layer, jobs, GIS, cross-cutting concerns, technology evaluation, proposed repository tree, system states |
| [TENANCY.md](TENANCY.md) | User / Tenant / TenantMembership / Project / ProjectMembership / Role / Permission model, active context, defense in depth, escalation prevention |
| [FEATURES.md](FEATURES.md) | Capability catalogue, resolution rule, capability vs configuration, project profiles and the extension model |
| [SECURITY.md](SECURITY.md) | Threat model, authentication, authorization, RLS, jobs, storage, vector, audit, PII, portal, escalation |
| [DATA_MODEL.md](DATA_MODEL.md) | Domain decomposition, aggregates, dangerous couplings, entity specifications, regimes, Parcel as territorial workspace |
| [PROVENANCE.md](PROVENANCE.md) | Provenance vocabularies, pattern evaluation and recommendation, forecast reproducibility, spatial replacement, demo guards |
| [AI_GOVERNANCE.md](AI_GOVERNANCE.md) | Three-layer HITL model, classification provenance, deidentification pipeline, ports, taxonomy governance |
| [DEMO_ZAMORA.md](DEMO_ZAMORA.md) | What is real vs synthetic in the pilot, fixture layout, rules that keep Zamora out of the core, prototype artefacts |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, typography, spacing, component families, interaction patterns, golden references |
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | Test layers and the suites future slices must implement (cross-tenant suite is a release gate) |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Proposed vertical slices, dependency reasoning, slice 0 exit criteria |
| [DESIGN_BUNDLE_KNOWN_ISSUES.md](DESIGN_BUNDLE_KNOWN_ISSUES.md) | Known issues of the approved design bundle, recorded at Gate 1 without modifying the design files |
| [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md) | Git workflow, branches, Conventional Commits, PRs, branch protection, hooks, review checklist |
| [RELEASE_POLICY.md](RELEASE_POLICY.md) | Changesets, SemVer, changelogs, when a changeset is required, traceability |
| [CI.md](CI.md) | GitHub Actions quality gates by stage; only real scripts are ever called |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel + Railway topology, environments, secrets (names only), database evaluation, repository commands |
| [DEPENDENCIES.md](DEPENDENCIES.md) | Exact dependency versions chosen in Slice 0 and why; what is deliberately not installed |
| [CONSULTANCY_DEMO_PREFLIGHT.md](CONSULTANCY_DEMO_PREFLIGHT.md) | What to verify before a walkthrough: `pnpm demo:preflight`, `pnpm demo:doctor`, the hosting surfaces, and what to do when a check fails while you are already late |
| [CONSULTANCY_FEEDBACK_TEMPLATE.md](CONSULTANCY_FEEDBACK_TEMPLATE.md) | The form to fill in during a walkthrough, the seven kinds of remark, and where each one is routed afterwards |
| [AI_LIVE_ACTIVATION.md](AI_LIVE_ACTIVATION.md) | What is configured, what would leave this system per feature, what it would cost, the bounded smoke procedure, and how to turn it off |
| [AI_MODEL_SELECTION.md](AI_MODEL_SELECTION.md) | Which gateway model, chosen from the live catalogue with the filters that eliminated the others, and the prices it was written against |
| [CONSULTANCY_DEMO_BRIEF.md](CONSULTANCY_DEMO_BRIEF.md) | One page in non-technical Spanish for the meeting: the problem, what is real, what is simulated, what is not enabled, and the six questions to ask |
| [THESIS_ALIGNMENT.md](THESIS_ALIGNMENT.md) | What the product preserves for Conditions B and C of a human-in-the-loop coding study, and why Condition A is not possible today |
| [SECOND_PROJECT_READINESS.md](SECOND_PROJECT_READINESS.md) | Every component classified GENERIC / PROFILE-CONFIGURED / IMPORTER-SPECIFIC / ZAMORA-SPECIFIC, and what the next study would actually cost |
| [BASEMAP_POLICY.md](BASEMAP_POLICY.md) | The reference basemap: context and never evidence, the four modes, the no-provider floor, the failure invariant, key security, and what activation still requires |
| [TECH_DEBT.md](TECH_DEBT.md) | Intentional technical debt with owner and removal trigger |
| [DECISIONS/](DECISIONS/) | GATE-1 record · ADR-001 multi-tenancy · ADR-002 capability resolution · ADR-003 project profiles · ADR-004 RLS · ADR-005 provenance · ADR-006 survey versioning · ADR-007 AI human-in-the-loop · ADR-008 quality gate · ADR-009 client portal isolation · ADR-010 identity provider boundary · ADR-011 release/versioning · ADR-012 deployment topology · ADR-013 Drizzle/PostgreSQL · ADR-014 frontend stack scope · ADR-015 domain/application layering |

Slice 0 starts only after an explicit go is appended to `DECISIONS/GATE-1.md`.
