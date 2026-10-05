"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { requeueExtractionAction } from "@/lib/document-upload-actions";

import styles from "./documents.module.css";

/**
 * Asking for a version to be read again.
 *
 * One button, for the one case where the page was otherwise a dead end: a version that could not
 * be read, or one that is a scan. `apps/web/lib/document-retry.ts` decides when it is `offered`
 * and says why those two states and not the others.
 *
 * The copy is the catalogue's, in both languages, and so is every outcome.
 * `requeueExtractionAction` already distinguishes *queued* from *it was already queued* and
 * returns a domain error's own message otherwise, so there is nothing here to decide about what
 * happened — only where to put it.
 *
 * ## Why this is mounted in states that do not offer it
 *
 * Because a successful retry changes the state, and the new state does not offer a retry. Gating
 * the whole component on `offered` meant `router.refresh()` unmounted it — the button vanished
 * *and took the confirmation with it*, so the one thing the person had just done left no trace.
 * Found by the e2e, which is the only place a refresh actually happens.
 *
 * So the server renders this for every state that is not `READY`, the **button** is what
 * `offered` controls, and an outcome outlives the control that produced it. With nothing to show
 * and nothing to offer it renders nothing at all.
 *
 * `router.refresh()` because the action revalidates the documents **list** and this is the detail
 * page. Re-reading is what makes the state on screen the state in the database; a message saying
 * "queued" over a page still reading `FAILED` would be the sort of half-truth the rest of this
 * surface works to avoid.
 */
export function ExtractionRetry({
  tenant,
  project,
  versionId,
  offered,
}: {
  tenant: string;
  project: string;
  versionId: string;
  offered: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await requeueExtractionAction({ tenant, project, versionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      router.refresh();
    });
  };

  if (!offered && message === null && error === null) return null;

  return (
    <p className={styles.strategy} data-testid="extraction-retry">
      {offered ? (
        <button
          className={styles.primary}
          data-testid="extraction-retry-button"
          disabled={pending}
          onClick={submit}
          type="button"
        >
          {pending ? t("documents.requeueing") : t("documents.requeue")}
        </button>
      ) : null}
      {message ? (
        <span className={styles.note} data-testid="extraction-retry-ok">
          {" "}
          {message}
        </span>
      ) : null}
      {error ? (
        <span className={styles.error} data-testid="extraction-retry-error">
          {" "}
          {error}
        </span>
      ) : null}
    </p>
  );
}
