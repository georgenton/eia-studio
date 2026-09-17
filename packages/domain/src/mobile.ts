/**
 * The domain, as EIA Field may import it.
 *
 * ## Why a second entry point exists
 *
 * `@eia/domain` is pure in the sense ADR-015 requires — no persistence adapter, no driver, no ORM
 * — but pure is not the same as *bundle-safe*: `documents/chunking.ts` imports `node:crypto`,
 * which is entirely correct on a server and unresolvable in a React Native bundle. Importing the
 * barrel from the mobile application therefore fails the Metro build, and the honest fix is not to
 * shim a Node builtin onto a phone. It is to say which part of the domain a phone may have.
 *
 * ## What this list is
 *
 * Exactly the rules a technician's device needs to do its work correctly with no server: the
 * questionnaire's own validation, the answer vocabulary, the field workflow's states, and the
 * offline-access policy. Nothing about social analytics, quality rules, reports, documents,
 * capabilities or the portal — none of which a field device has any business computing.
 *
 * `packages/domain/test/purity.test.ts` walks this module's import graph and fails if anything it
 * reaches imports a `node:` builtin, so the boundary is a test rather than a convention.
 */
export {
  ANSWER_COLUMN_FOR_TYPE,
  answerColumnFor,
  answerInputSchema,
  AnswerTypeMismatch,
  assertSubmissionComplete,
  RequiredAnswerMissing,
  validateAnswer,
} from "./field/answers";
export type { AnswerInput } from "./field/answers";

export {
  CHOICE_QUESTION_TYPES,
  isChoiceQuestion,
  QUESTION_SENSITIVITY,
  QUESTION_TYPES,
  questionSensitivitySchema,
  questionTypeSchema,
  SURVEY_VERSION_STATUSES,
  surveyVersionStatusSchema,
} from "./field/survey";
export type {
  QuestionSensitivity,
  QuestionType,
  SurveyOptionDefinition,
  SurveyQuestionDefinition,
  SurveyVersionStatus,
} from "./field/survey";

export {
  ASSIGNMENT_STATUS_PRESENTATION,
  ASSIGNMENT_STATUSES,
  INSTANCE_STATUSES,
  LOCATION_OUTCOMES,
  VISIT_STATUSES,
} from "./field/workflow";
export type {
  AssignmentStatus,
  InstanceStatus,
  LocationOutcome,
  VisitStatus,
} from "./field/workflow";

export {
  OFFLINE_ACCESS_STATE_LABEL,
  OFFLINE_ACCESS_STATES,
  OFFLINE_EXPIRY_WARNING_MS,
  OFFLINE_WINDOW_CAP_MS,
  OFFLINE_WINDOW_FLOOR_MS,
  offlineAccessState,
} from "./field/offline-access";
export type { OfflineAccessState } from "./field/offline-access";

export {
  CAPTURE_CHANNEL_DESCRIPTORS,
  CAPTURE_CHANNELS,
  captureChannel,
} from "./field/capture-channel";
export type { CaptureChannel, CaptureChannelDescriptor } from "./field/capture-channel";

export { FIELD_OFFLINE_MODE_SEMANTICS, FIELD_OFFLINE_MODES } from "./field/offline-mode";
export type { FieldOfflineMode } from "./field/offline-mode";

export {
  FIELD_MEDIA_KINDS,
  LOCAL_MEDIA_STATES,
  MAX_MEDIA_PER_VISIT,
  mayDeleteLocalFile,
} from "./field/media";
export type { FieldMediaKind, LocalMediaState } from "./field/media";

export { InvalidInput } from "./core/errors";
