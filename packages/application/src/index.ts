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
export { AiGatewayClassifier, createClassifier, FakeClassifier } from "./social/classifier";
export type { FakeScenario } from "./social/classifier";
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

// Quality Gate (Slice 5). The rule catalogue itself lives in @eia/domain (ADR-020).
export { runQualityCheck } from "./quality/run";
export type { QualityRunResult } from "./quality/run";
export { decideQualityFinding, decideFindingInputSchema } from "./quality/review";
export type { DecideFindingInput, FindingDecisionResult } from "./quality/review";
export { loadQualityOverview, loadFindingDetail } from "./quality/read-models";
export type {
  FindingDetail,
  FindingEvidenceItem,
  FindingReviewEntry,
  FindingSummary,
  QualityOverview,
} from "./quality/read-models";

// Document intelligence (Slice 6). Retrieval is full-text; there is no embedding path (ADR-021).
export { ingestDocumentVersion } from "./documents/ingest";
export type { IngestedVersion } from "./documents/ingest";
export { FullTextRetriever } from "./documents/retriever";
export { askDocuments } from "./documents/assistant";
export type { AssistantAsk, AssistantConfig, AssistantResponse } from "./documents/assistant";
export {
  AiGatewayAssistantGenerator,
  createAssistantGenerator,
  FakeAssistantGenerator,
  renderAssistantSystemPrompt,
  renderAssistantUserPrompt,
} from "./documents/generator";
export type { FakeGeneratorScenario } from "./documents/generator";
export { loadDocuments, loadDocumentVersion } from "./documents/read-models";
export type { DocumentSummary, DocumentVersionDetail } from "./documents/read-models";

// Report generation (Slice 7). The snapshot is the deliverable; prose renders it (ADR-022).
export { generateSocialChapter } from "./reports/generate";
export type { GeneratedReportVersion, ReportGeneratorConfig } from "./reports/generate";
export { buildSocialSnapshot } from "./reports/snapshot";
export {
  AiGatewayNarrativeGenerator,
  createNarrativeGenerator,
  FakeNarrativeGenerator,
  renderChapterSystemPrompt,
  renderChapterUserPrompt,
} from "./reports/generator";
export type { FakeNarrativeScenario } from "./reports/generator";
export { renderChapterDocx } from "./reports/docx";
export type { RenderedDocx } from "./reports/docx";
export { loadReportOverview, loadReportVersion } from "./reports/read-models";
export type {
  ReportOverview,
  ReportVersionDetail,
  ReportVersionSummary,
} from "./reports/read-models";
