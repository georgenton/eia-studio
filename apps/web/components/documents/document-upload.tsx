"use client";

import { DOCUMENT_KINDS, DOCUMENT_PRIVACY_CLASSIFICATIONS, FORMAT_DESCRIPTORS } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import {
  completeDocumentUploadAction,
  putLocalBytesAction,
  requestDocumentUploadAction,
} from "@/lib/document-upload-actions";
import { documentKindLabel, documentPrivacyLabel } from "@/lib/labels";

import styles from "./documents.module.css";

export interface UploadTarget {
  readonly id: string;
  readonly code: string;
  readonly title: string;
}

/**
 * Upload a delivered file as a version of a document.
 *
 * ## The bytes go to the provider, not through here
 *
 * Three steps: ask for an intent, PUT the file to the URL the provider signed, tell the server it
 * landed. Only the third step writes anything, and it verifies against the provider — the size of
 * the object that is actually there, and its first bytes against the declared format — rather than
 * against what this component says happened.
 *
 * The consequence for this component is the one that matters to a person: if the PUT fails, no
 * version exists and the form is still filled in. Nothing half-written is left behind for someone
 * to discover later, and retrying is retrying, not a second document.
 *
 * ## Why the privacy classification is a question and not a checkbox nobody reads
 *
 * It defaults to *review required*, never to *no personal data*. The product has read nothing at
 * this point; a reassuring default nobody checked is the one that would later be quoted as though
 * somebody had.
 */
export function DocumentUpload({
  tenant,
  project,
  documents,
}: {
  tenant: string;
  project: string;
  documents: ReadonlyArray<UploadTarget>;
}) {
  const { t, fmt } = useI18n();
  const fieldId = useId();
  const [target, setTarget] = useState<"new" | "existing">(
    documents.length > 0 ? "existing" : "new",
  );
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("report");
  const [privacy, setPrivacy] = useState<string>("REVIEW_REQUIRED");
  const [sourceDate, setSourceDate] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const accept = FORMAT_DESCRIPTORS.pdf.extensions
    .concat(FORMAT_DESCRIPTORS.docx.extensions)
    .join(",");

  const submit = () => {
    setMessage(null);
    setError(null);
    if (!file) {
      setError(t("documents.uploadNeedsFile"));
      return;
    }
    const chosen = file;

    startTransition(async () => {
      const intent = await requestDocumentUploadAction({
        tenant,
        project,
        filename: chosen.name,
        // A browser's guess, checked twice on the server: against the allowlist now, and against
        // the stored file's first bytes at finalize.
        mimeType: chosen.type || "application/octet-stream",
        sizeBytes: chosen.size,
      });
      if (!intent.ok) {
        setError(intent.error);
        return;
      }

      const transferred = intent.viaServer
        ? await putThroughServer(tenant, project, intent.objectKey, intent.headers, chosen)
        : await putToProvider(intent.url, intent.method, intent.headers, chosen);
      if (!transferred) {
        // Nothing was written: the intent is still unconsumed and will expire on its own.
        setError(t("documents.uploadTransferFailed"));
        return;
      }

      const result = await completeDocumentUploadAction({
        tenant,
        project,
        intentId: intent.intentId,
        objectKey: intent.objectKey,
        documentId: target === "existing" ? documentId : null,
        code: target === "new" ? code.trim() : null,
        title: target === "new" ? title.trim() : null,
        kind: target === "new" ? kind : null,
        privacyClassification: privacy,
        sourceDate: sourceDate === "" ? null : sourceDate,
        sourceNote: sourceNote.trim(),
      });
      if (result.ok) {
        setMessage(result.message);
        setFile(null);
        setSourceNote("");
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Panel>
      <PanelHeader
        label={t("documents.uploadTitle")}
        note={t("documents.uploadNote", {
          pdf: fmt.bytes(FORMAT_DESCRIPTORS.pdf.maxBytes),
          docx: fmt.bytes(FORMAT_DESCRIPTORS.docx.maxBytes),
        })}
      />
      <PanelBody>
        <p className={styles.note}>{t("documents.uploadLead")}</p>

        <fieldset className={styles.uploadFields}>
          <legend className={styles.uploadLegend}>{t("documents.uploadTarget")}</legend>
          {documents.length > 0 ? (
            <label className={styles.uploadChoice}>
              <input
                checked={target === "existing"}
                name={`${fieldId}-target`}
                onChange={() => setTarget("existing")}
                type="radio"
                value="existing"
              />
              {t("documents.uploadTargetExisting")}
            </label>
          ) : null}
          <label className={styles.uploadChoice}>
            <input
              checked={target === "new"}
              name={`${fieldId}-target`}
              onChange={() => setTarget("new")}
              type="radio"
              value="new"
            />
            {t("documents.uploadTargetNew")}
          </label>
        </fieldset>

        {target === "existing" ? (
          <div className={styles.uploadField}>
            <label htmlFor={`${fieldId}-document`}>{t("documents.uploadExistingLabel")}</label>
            <select
              className={styles.input}
              id={`${fieldId}-document`}
              onChange={(event) => setDocumentId(event.target.value)}
              value={documentId}
            >
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.code} · {document.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className={styles.uploadField}>
              <label htmlFor={`${fieldId}-code`}>{t("documents.uploadCode")}</label>
              <input
                aria-describedby={`${fieldId}-code-help`}
                className={styles.input}
                id={`${fieldId}-code`}
                onChange={(event) => setCode(event.target.value)}
                placeholder="DOC-014"
                value={code}
              />
              <span className={styles.uploadHelp} id={`${fieldId}-code-help`}>
                {t("documents.uploadCodeHelp")}
              </span>
            </div>
            <div className={styles.uploadField}>
              <label htmlFor={`${fieldId}-title`}>{t("documents.uploadTitleField")}</label>
              <input
                className={styles.input}
                id={`${fieldId}-title`}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </div>
            <div className={styles.uploadField}>
              <label htmlFor={`${fieldId}-kind`}>{t("documents.uploadKind")}</label>
              <select
                className={styles.input}
                id={`${fieldId}-kind`}
                onChange={(event) => setKind(event.target.value)}
                value={kind}
              >
                {DOCUMENT_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {documentKindLabel(t, value)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className={styles.uploadField}>
          <label htmlFor={`${fieldId}-file`}>{t("documents.uploadFile")}</label>
          <input
            accept={accept}
            className={styles.input}
            id={`${fieldId}-file`}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </div>

        <div className={styles.uploadField}>
          <label htmlFor={`${fieldId}-privacy`}>{t("documents.uploadPrivacy")}</label>
          <select
            aria-describedby={`${fieldId}-privacy-help`}
            className={styles.input}
            id={`${fieldId}-privacy`}
            onChange={(event) => setPrivacy(event.target.value)}
            value={privacy}
          >
            {DOCUMENT_PRIVACY_CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>
                {documentPrivacyLabel(t, value)}
              </option>
            ))}
          </select>
          <span className={styles.uploadHelp} id={`${fieldId}-privacy-help`}>
            {t("documents.uploadPrivacyHelp")}
          </span>
        </div>

        <div className={styles.uploadField}>
          <label htmlFor={`${fieldId}-date`}>{t("documents.uploadSourceDate")}</label>
          <input
            aria-describedby={`${fieldId}-date-help`}
            className={styles.input}
            id={`${fieldId}-date`}
            onChange={(event) => setSourceDate(event.target.value)}
            type="date"
            value={sourceDate}
          />
          <span className={styles.uploadHelp} id={`${fieldId}-date-help`}>
            {t("documents.uploadSourceDateHelp")}
          </span>
        </div>

        <div className={styles.uploadField}>
          <label htmlFor={`${fieldId}-note`}>{t("documents.uploadSourceNote")}</label>
          <input
            aria-describedby={`${fieldId}-note-help`}
            className={styles.input}
            id={`${fieldId}-note`}
            onChange={(event) => setSourceNote(event.target.value)}
            value={sourceNote}
          />
          <span className={styles.uploadHelp} id={`${fieldId}-note-help`}>
            {t("documents.uploadSourceNoteHelp")}
          </span>
        </div>

        <button className={styles.primary} disabled={pending} onClick={submit} type="button">
          {pending ? t("documents.uploading") : t("documents.uploadSubmit")}
        </button>

        {message ? (
          <p className={styles.note} data-upload-outcome="ok">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className={styles.unavailable} data-upload-outcome="error" role="alert">
            {error}
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** The ordinary path: straight to the provider, with the headers its signature covers. */
async function putToProvider(
  url: string,
  method: string,
  headers: Record<string, string>,
  file: File,
): Promise<boolean> {
  try {
    const response = await fetch(url, { method, headers, body: file });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The in-memory store has no URL a browser can PUT to, so the bytes go through a server action.
 * Only `local` and `test` ever take this path, and the action refuses it anywhere else.
 */
async function putThroughServer(
  tenant: string,
  project: string,
  objectKey: string,
  headers: Record<string, string>,
  file: File,
): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const result = await putLocalBytesAction({
      tenant,
      project,
      objectKey,
      contentType: headers["content-type"] ?? "application/octet-stream",
      base64: btoa(binary),
    });
    return result.ok;
  } catch {
    return false;
  }
}
