export * as appSchema from "./app";
export * as authSchema from "./auth";
export * as auditSchema from "./audit";
export * as gisSchema from "./gis";

import * as appTables from "./app";
import * as auditTables from "./audit";
import * as authTables from "./auth";
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
};
