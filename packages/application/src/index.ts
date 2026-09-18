// Application layer: authorization-aware orchestration over persistence (ADR-015).
// Depends on @eia/domain (rules) and @eia/db (adapters); never the reverse.
export { recordAudit } from "./audit/record";
export {
  buildRequestContext,
  ensureUser,
  listUserTenants,
  resolveAccessContext,
} from "./tenancy/request-context";
export type { AccessContext } from "./tenancy/request-context";
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
export { loadWorkspaceHeader, loadPortfolio } from "./projects/portfolio";
export { uploadDocumentVersion, uploadDocumentVersionInputSchema } from "./documents/upload";
export type { UploadedDocumentVersion } from "./documents/upload";
export { createMemoryStorage } from "./storage/memory-adapter";
export type { MemoryStorage } from "./storage/memory-adapter";
export { createS3Storage } from "./storage/s3-adapter";
export type { S3StorageConfig } from "./storage/s3-adapter";
export {
  createUploadIntent,
  finalizeUpload,
  finalizeUploadInputSchema,
  presignStoredObjectDownload,
  uploadIntentInputSchema,
} from "./storage/upload";
export { resolveFinalizedUpload } from "./storage/upload";
export type { FinalizedUpload, IssuedUploadIntent } from "./storage/upload";
export { declareFieldMedia, loadParcelMedia, loadVisitMedia } from "./field/media";
export type { DeclaredFieldMedia, VisitMedia } from "./field/media";
export {
  activateProject,
  loadProjectIntake,
  updateProjectIntake,
  updateProjectIntakeInputSchema,
} from "./projects/intake";
export type {
  IntakeDocument,
  IntakeSurvey,
  IntakeTeamMember,
  ProjectIntakeView,
  StorageReadiness,
} from "./projects/intake";
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
  closeCampaign,
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
export {
  createSurveyDraft,
  createSurveyTemplate,
  loadSurveyAuthoring,
  publishSurveyVersion,
  saveSurveyDefinition,
} from "./field/authoring";
export type {
  AuthoringSelection,
  AuthoringTemplateSummary,
  AuthoringVersionSummary,
  CreateSurveyDraftInput,
  CreateSurveyTemplateInput,
  PublishSurveyVersionInput,
  SaveSurveyDefinitionInput,
  SurveyAuthoringView,
} from "./field/authoring";
export { readsAllFieldResponses, withFieldContext } from "./field/context";
// EIA Field (Production V1, Wave 1): the scoped download a technician works from offline.
export { buildFieldPack, decodeCursor, encodeCursor } from "./field/field-pack";
export type { FieldPackOptions } from "./field/field-pack";
export { processSyncCommands, pullFieldChanges } from "./field/sync";
export type { ProcessSyncOptions } from "./field/sync";
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
export {
  claimNextExtraction,
  processDocumentExtraction,
  queueDocumentExtraction,
  releaseStaleExtractions,
} from "./documents/extraction";
export type { ExtractionClaim, ExtractionOutcome } from "./documents/extraction";
export { extractPdf, PdfUnreadable, PDF_LIMITS } from "./documents/extract-pdf";
export { extractDocx, DocxUnreadable } from "./documents/extract-docx";
export { issueDocumentDownload } from "./documents/download";
export type { DocumentDownloadLink } from "./documents/download";
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
export {
  claimNextDocumentReview,
  decideDocumentReviewCandidate,
  listDocumentReviewCandidates,
  listDocumentReviewRuns,
  processDocumentReview,
  releaseStaleDocumentReviews,
  startDocumentReviewRun,
  REVIEW_PASSAGE_LIMIT,
} from "./documents/review";
export type {
  DecidedCandidate,
  ReviewCandidateRow,
  ReviewClaim,
  ReviewOutcome,
  ReviewRunRow,
  StartReviewInput,
  StartedReviewRun,
} from "./documents/review";
export {
  AiGatewayDocumentReviewer,
  createDocumentReviewer,
  FakeDocumentReviewer,
  renderReviewSystemPrompt,
  renderReviewUserPrompt,
  DOCUMENT_REVIEW_PROMPT_VERSION,
} from "./documents/reviewer";
export type { FakeReviewerScenario } from "./documents/reviewer";
// The template library (Wave 3, ADR-036). The renderer has no database access, and no model is
// anywhere on this path.
export {
  activateTemplateVersion,
  createReportTemplate,
  createTemplateInputSchema,
  generateDocumentFromTemplate,
  listGeneratedDocuments,
  listReportTemplates,
  revalidateTemplateVersion,
  uploadTemplateVersion,
  uploadTemplateVersionInputSchema,
  issueGeneratedDocumentDownload,
} from "./templates/use-cases";
export type {
  CreateTemplateInput,
  GeneratedDocumentResult,
  GeneratedDocumentRow,
  TemplateRow,
  TemplateVersionRow,
  UploadTemplateVersionInput,
  UploadedTemplateVersion,
  GeneratedDocumentLink,
} from "./templates/use-cases";
export { buildTemplateBinding } from "./templates/binding";
export type { BuildBindingInput } from "./templates/binding";
export {
  assertTemplateArchiveSafe,
  inspectDocxArchive,
  readTemplateManifest,
  renderTemplate,
  TEMPLATE_ARCHIVE_LIMITS,
} from "./templates/renderer";
export type { RenderedTemplate } from "./templates/renderer";
export { loadDocuments, loadDocumentVersion } from "./documents/read-models";
export type { DocumentSummary, DocumentVersionDetail } from "./documents/read-models";

// Report generation (Slice 7). The snapshot is the deliverable; prose renders it (ADR-022).
export { importPgasChapter, clearPgas } from "./pgas/import";
export type { PgasImportResult } from "./pgas/import";
export { loadPgasPlan } from "./pgas/read-models";
export type { PgasPlanView, PgasPlanSummary } from "./pgas/read-models";
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

// Client portal (ADR-027). A publication, not a mirror: the builder allowlists, the publish
// use-case writes once, and the client view reads the projection and nothing else.
export { buildClientPublicationDraft } from "./portal/build";
export type { PublicationDraft, WithheldFigure } from "./portal/build";
export { publishClientPublication } from "./portal/publish";
export type { PublishResult } from "./portal/publish";
export { loadPortalManagement, loadPublishedClientView } from "./portal/read-models";
export type {
  PortalManagementView,
  PublicationHistoryEntry,
  PublishedClientView,
} from "./portal/read-models";

export { supersedeOtherCampaigns } from "./field/campaign-canonicalization";
export type { CampaignSupersession } from "./field/campaign-canonicalization";
