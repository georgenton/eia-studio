import type { DocumentProcessingState } from "@eia/domain";

/**
 * Whether the document detail page offers *Procesar de nuevo*.
 *
 * ## Why this is a module rather than an expression in the page
 *
 * Because it is the rule the tests are about. A version that cannot be read is the one case where
 * a reader is looking at a dead end, and until this wave the product offered them nothing: the
 * server action and both languages' copy existed, and nothing on any screen called it (the
 * extraction fix of 3 Oct 2026 was deployed and then could not be exercised, because no document
 * could be asked again).
 *
 * ## Why it is narrower than the use-case
 *
 * `queueDocumentExtraction` accepts `UPLOADED`, `FAILED` and `REQUIRES_OCR`, and refuses `READY`
 * — chunks are immutable, so a second reading of the same bytes would make every citation of the
 * first ambiguous (ADR-033). This predicate deliberately admits **two** of those three.
 *
 * `UPLOADED` is left out because it is not a dead end on this page: the upload flow asks for the
 * reading itself, and a version sitting in `UPLOADED` is one nobody has asked about yet rather
 * than one that failed. Offering a retry there would invite a reader to re-ask a question that was
 * never asked. That it *would* also be accepted by the use-case is recorded as TD-124, because the
 * one way to reach `UPLOADED` after a successful upload is a queue request that failed silently,
 * and that is a different defect from this one.
 *
 * `QUEUED` and `PROCESSING` are left out because the answer is "wait", and the use-case says so by
 * returning `queued: false` rather than erroring — a button whose honest outcome is *nothing
 * happened* is worse than no button.
 *
 * ## What this is not
 *
 * It is not authorization. The action calls `resolveSurfaceAccess`, and the use-case behind it
 * calls `requireCapability('core.documents')` and `requirePermission('documents.write')`; the row
 * is then reached under the caller's own RLS. A reader who forges a request to this action gets
 * the same refusal they would get with the control hidden. This decides what is *shown*.
 */
const OFFERED_FOR: ReadonlyArray<DocumentProcessingState> = ["FAILED", "REQUIRES_OCR"];

export function showsExtractionRetry(
  processingState: DocumentProcessingState | string,
  canWrite: boolean,
): boolean {
  if (!canWrite) return false;
  return (OFFERED_FOR as ReadonlyArray<string>).includes(processingState);
}
