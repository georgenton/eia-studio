"use client";

import { FORMAT_DESCRIPTORS, type EditorialAssetRole } from "@eia/domain";
import { useId, useRef, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import {
  completeEditorialUploadAction,
  requestEditorialUploadAction,
} from "@/lib/portal-editorial-actions";

import styles from "./editorial-editor.module.css";

/**
 * Pick a file, upload it, and hand the caller an asset — or nothing at all.
 *
 * Three steps, the same ones every upload in this product takes: intent, PUT, finalize. For a
 * photograph the server adds a fourth and returns the **derivative**, so the id that reaches the
 * draft is never the original. This component cannot produce an id for the original even if it
 * wanted to: `completeEditorialUploadAction` is what decides.
 *
 * ## What it refuses to get wrong
 *
 * `onAdded` fires **once**, and only after finalize returned. A failed PUT adds nothing and says
 * so; a failed finalize does not say "uploaded". The button is disabled for the whole transition,
 * so a second click cannot start a second upload — and on success the input is cleared both ways:
 * the React state **and** `inputRef.current.value`, because a file input keeps its own value and
 * a browser would otherwise still show the old filename under a form that no longer has it. That
 * ghost filename is the defect the document smoke found; this is the place it would come back.
 */
export function EditorialFileField({
  tenant,
  project,
  role,
  disabled,
  onAdded,
}: {
  tenant: string;
  project: string;
  role: EditorialAssetRole;
  disabled: boolean;
  onAdded: (asset: { storedObjectId: string; filename: string; mimeType: string }) => void;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Three of these sit one under another in a section — a photograph, a PDF and a deck — and the
   * field and its button say which is which. Labelled only "Elegir archivo", they were three
   * identical rows whose meaning was their order on screen.
   */
  const kind = t(
    role === "photo"
      ? "portal.editorial.fileKindPhoto"
      : role === "slides"
        ? "portal.editorial.fileKindSlides"
        : "portal.editorial.fileKindDocument",
  );

  const accept =
    role === "photo"
      ? FORMAT_DESCRIPTORS.jpeg.extensions.concat(FORMAT_DESCRIPTORS.png.extensions).join(",")
      : role === "slides"
        ? FORMAT_DESCRIPTORS.pptx.extensions.join(",")
        : FORMAT_DESCRIPTORS.pdf.extensions.join(",");

  /** Cleared both ways: React's state and the input element's own value. */
  const clear = () => {
    setFile(null);
    if (inputRef.current !== null) inputRef.current.value = "";
  };

  const submit = () => {
    if (file === null || pending) return;
    const chosen = file;
    setError(null);
    setState("idle");
    startTransition(async () => {
      const intent = await requestEditorialUploadAction({
        tenant,
        project,
        filename: chosen.name,
        mimeType: chosen.type || "application/octet-stream",
        sizeBytes: chosen.size,
      });
      if (!intent.ok) {
        setError(intent.error);
        setState("failed");
        return;
      }

      const transferred = intent.viaServer
        ? await putThroughServer(tenant, project, intent.objectKey, intent.headers, chosen)
        : await putToProvider(intent.url, intent.method, intent.headers, chosen);
      if (!transferred) {
        // Nothing was written and nothing is added: the intent expires unconsumed.
        setError(t("portal.editorial.uploadFailed"));
        setState("failed");
        return;
      }

      const finalized = await completeEditorialUploadAction({
        tenant,
        project,
        intentId: intent.intentId,
        objectKey: intent.objectKey,
      });
      if (!finalized.ok) {
        setError(finalized.error);
        setState("failed");
        return;
      }
      onAdded({
        storedObjectId: finalized.storedObjectId,
        filename: finalized.filename,
        mimeType: finalized.mimeType,
      });
      setState("done");
      clear();
    });
  };

  return (
    <div className={styles.uploader}>
      <label className={styles.field} htmlFor={fieldId}>
        {t("portal.editorial.chooseFileOfKind", { kind })}
        <input
          accept={accept}
          className={styles.input}
          disabled={disabled || pending}
          id={fieldId}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setState("idle");
            setError(null);
          }}
          ref={inputRef}
          type="file"
        />
      </label>
      <button
        className={styles.secondary}
        data-testid={`editorial-upload-${role}`}
        disabled={disabled || pending || file === null}
        onClick={submit}
        type="button"
      >
        {pending ? t("portal.editorial.uploading") : t("portal.editorial.addFileOfKind", { kind })}
      </button>
      {state === "done" ? (
        <span className={styles.ok} data-testid="editorial-upload-ok">
          {t("portal.editorial.uploaded")}
        </span>
      ) : null}
      {error ? (
        <span className={styles.error} data-testid="editorial-upload-error" role="alert">
          {error}
        </span>
      ) : null}
      {role === "photo" ? (
        <span className={styles.help}>{t("portal.editorial.photoDerivative")}</span>
      ) : null}
    </div>
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
 * Only `local` and `test` take this path, and the action refuses it anywhere else.
 */
async function putThroughServer(
  tenant: string,
  project: string,
  objectKey: string,
  headers: Record<string, string>,
  file: File,
): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const { putLocalBytesAction } = await import("@/lib/document-upload-actions");
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
