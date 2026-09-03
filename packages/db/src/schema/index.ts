export * as appSchema from "./app";
export * as authSchema from "./auth";
export * as auditSchema from "./audit";
export * as gisSchema from "./gis";
export * as fieldSchema from "./field";

import * as appTables from "./app";
import * as auditTables from "./audit";
import * as authTables from "./auth";
import * as fieldTables from "./field";
import * as gisTables from "./gis";

/** Flat schema object for the drizzle client (unique keys across schemas). */
export const schema = {
  appUser: appTables.user,
  tenant: appTables.tenant,
  tenantMembership: appTables.tenantMembership,
  project: appTables.project,
  projectMembership: appTables.projectMembership,
  tenantCapability: appTables.tenantCapability,
  projectCapabilitySetting: appTables.projectCapabilitySetting,
  tenantRole: appTables.tenantRole,
  projectRole: appTables.projectRole,
  membershipStatus: appTables.membershipStatus,
  projectLifecycle: appTables.projectLifecycle,
  authUser: authTables.user,
  authSession: authTables.session,
  authAccount: authTables.account,
  authVerification: authTables.verification,
  auditLog: auditTables.log,
  spatialDataset: gisTables.spatialDataset,
  spatialDatasetVersion: gisTables.spatialDatasetVersion,
  alignment: gisTables.alignment,
  parcel: gisTables.parcel,
  parcelGeometry: gisTables.parcelGeometry,
  affectation: gisTables.affectation,
  projectConfiguration: fieldTables.projectConfiguration,
  surveyTemplate: fieldTables.surveyTemplate,
  surveyVersion: fieldTables.surveyVersion,
  surveyQuestion: fieldTables.surveyQuestion,
  surveyOption: fieldTables.surveyOption,
  surveyCampaign: fieldTables.surveyCampaign,
  fieldAssignment: fieldTables.fieldAssignment,
  fieldVisit: fieldTables.fieldVisit,
  surveyInstance: fieldTables.surveyInstance,
  surveyAnswer: fieldTables.surveyAnswer,
  surveyAnswerOption: fieldTables.surveyAnswerOption,
};
