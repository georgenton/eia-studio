/**
 * Typed domain errors. They map to the system states of the design (ARCHITECTURE.md §11) and
 * never carry secrets or another tenant's identifiers in their public fields.
 */
export type DomainErrorCode =
  | "PERMISSION_DENIED"
  | "FEATURE_DISABLED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TENANT_CONSISTENCY_VIOLATION"
  | "ROLE_ESCALATION";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

/** State 6 ("permission denied"): names the role and the restricted data, never the resource. */
export class PermissionDenied extends DomainError {
  readonly role: string | null;
  readonly restrictedData: string;
  constructor(input: { role?: string | null; restrictedData: string }) {
    super("PERMISSION_DENIED", `Permission denied for ${input.restrictedData}`);
    this.name = "PermissionDenied";
    this.role = input.role ?? null;
    this.restrictedData = input.restrictedData;
  }
}

/** State 7 ("feature disabled"): copy is generated from catalogue metadata. */
export class FeatureDisabled extends DomainError {
  readonly capability: string;
  readonly whoCanEnable: string;
  constructor(input: { capability: string; whoCanEnable: string }) {
    super("FEATURE_DISABLED", `Capability ${input.capability} is disabled`);
    this.name = "FeatureDisabled";
    this.capability = input.capability;
    this.whoCanEnable = input.whoCanEnable;
  }
}

export class NotFound extends DomainError {
  constructor(what: string) {
    super("NOT_FOUND", `${what} not found`);
    this.name = "NotFound";
  }
}

export class InvalidInput extends DomainError {
  constructor(message: string) {
    super("INVALID_INPUT", message);
    this.name = "InvalidInput";
  }
}

export class TenantConsistencyViolation extends DomainError {
  constructor(message: string) {
    super("TENANT_CONSISTENCY_VIOLATION", message);
    this.name = "TenantConsistencyViolation";
  }
}

export class RoleEscalation extends DomainError {
  constructor(message: string) {
    super("ROLE_ESCALATION", message);
    this.name = "RoleEscalation";
  }
}
