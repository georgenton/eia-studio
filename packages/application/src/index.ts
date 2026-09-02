// Application layer: authorization-aware orchestration over persistence (ADR-015).
// Depends on @eia/domain (rules) and @eia/db (adapters); never the reverse.
export { recordAudit } from "./audit/record";
export { buildRequestContext, ensureUser, listUserTenants } from "./tenancy/request-context";
export type { BuildRequestContextInput } from "./tenancy/request-context";
export {
  addTenantMembership,
  changeTenantMembershipRole,
  createTenant,
  createTenantInputSchema,
  DEFAULT_PLAN_ENTITLEMENTS,
  slugSchema,
} from "./tenancy/tenants";
export type { CreateTenantResult } from "./tenancy/tenants";
export {
  addProjectMembership,
  createProject,
  createProjectInputSchema,
  listPortfolio,
  setProjectCapability,
  setTenantCapability,
} from "./tenancy/projects";
export type { PortfolioProject } from "./tenancy/projects";
export {
  loadProjectCapabilityOverrides,
  loadTenantCapabilitySettings,
  projectProfileDefaults,
} from "./tenancy/capability-settings";
export { loadCommandCenter } from "./projects/command-center";
export type { CommandCenterView, ProjectHeader } from "./projects/command-center";
export { loadPortfolio } from "./projects/portfolio";
export type { PortfolioCard, PortfolioView } from "./projects/portfolio";
export {
  facetsOf,
  loadProvenanceRecords,
  loadProvenanceView,
  toProvenanceRecord,
} from "./projects/provenance";
