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
export {
  AnalysisCrsUnusable,
  assertAnalysisSridUsable,
  assertSourceSridUsable,
  inspectAnalysisSrid,
} from "./gis/analysis-crs";
export type { AnalysisCrsCheck } from "./gis/analysis-crs";
export {
  loadAssignmentDetail,
  loadFieldOverview,
  loadFieldProgress,
  loadMyWork,
  loadParcelVisits,
  loadSurveyQuestions,
} from "./field/read-models";
export type {
  AnswerView,
  AssignmentDetail,
  FieldCampaignSummary,
  FieldOverview,
  FieldProgressSummary,
  MyAssignment,
  ParcelVisitEntry,
  SurveyQuestionView,
  TechnicianWorkload,
} from "./field/read-models";
export {
  activateCampaign,
  completeVisit,
  saveSurveyDraft,
  startVisit,
  submitSurveyInstance,
} from "./field/use-cases";
export type {
  CampaignActivation,
  InstanceResult,
  SaveDraftInput,
  StartVisitInput,
  VisitResult,
} from "./field/use-cases";
export { readsAllFieldResponses, withFieldContext } from "./field/context";
export { activateDatasetVersion } from "./gis/activate-dataset-version";
export type { DatasetActivation } from "./gis/activate-dataset-version";
export {
  loadParcelExplorer,
  loadParcelWorkspace,
  loadTerritorialSummary,
  PARCEL_PAYLOAD_LIMIT,
} from "./gis/read-models";
export type {
  LayerProvenance,
  ParcelAffectation,
  ParcelExplorerView,
  ParcelFeature,
  ParcelRow,
  ParcelWorkspaceView,
  TerritorialSummary,
} from "./gis/read-models";

// Social Intelligence (Slice 4): deterministic tabulation, AI proposals, human validation.
export {
  loadDistributions,
  loadOpenQuestion,
  loadOpenResponses,
  loadPublishedTaxonomy,
  loadRuns,
  loadSocialMetrics,
  loadSocialVersions,
  loadTabulation,
  loadTaxonomyDefinition,
} from "./social/read-models";
export type {
  ClassificationRunSummary,
  OpenResponseRow,
  SocialDistributions,
  SocialSurveyVersionOption,
  SocialTabulation,
  SocialWorkflowMetrics,
  TaxonomyVersionSummary,
} from "./social/read-models";
export {
  startClassificationRun,
  startRunInputSchema,
  submitHumanReview,
  submitReviewInputSchema,
} from "./social/use-cases";
export type {
  ClassificationRunConfig,
  ReviewResult,
  StartedRun,
  StartRunInput,
  SubmitReviewInput,
} from "./social/use-cases";
export {
  AiGatewayClassifier,
  CLASSIFIER_KINDS,
  createClassifier,
  FakeClassifier,
} from "./social/classifier";
export type { ClassifierKind, FakeScenario } from "./social/classifier";
export {
  PROMPT_VERSION,
  promptHash,
  renderSystemPrompt,
  renderTaxonomy,
  renderUserPrompt,
} from "./social/prompt";
export {
  claimNextClassification,
  processClassification,
  releaseStaleClaims,
} from "./social/worker";
export type { ClaimedClassification, ProcessOutcome } from "./social/worker";
