"use client";

import type { EditorialPayload } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import {
  publishEditorialAction,
  saveEditorialDraftAction,
  withdrawEditorialAction,
} from "@/lib/portal-editorial-actions";

import styles from "./editorial-editor.module.css";

/**
 * Writing the public page.
 *
 * One structure, not a layout language: a page is a headline, an optional management summary and
 * an ordered list of sections. There is no column, no grid and no component palette, so an editor
 * cannot compose something the public renderer has never seen.
 *
 * Three buttons, three permissions. Saving is **not** publishing, and the surface says so after
 * every save rather than leaving somebody to assume. Publishing names the version it made;
 * withdrawing asks why, and says plainly what withdrawal cannot do.
 */
type Draft = {
  revision: number;
  payload: EditorialPayload;
  publishedSequence: number | null;
  publishedAt: string | null;
};

type Section = EditorialPayload["sections"][number];

type Summary = NonNullable<EditorialPayload["executiveSummary"]>;

const emptySummary = (): Summary => ({
  findings: "",
  implications: "",
  measures: "",
  accountable: null,
  asOf: null,
  sources: [],
});

export function EditorialEditor({
  tenant,
  project,
  draft,
  mayWrite,
  mayPublish,
  publicUrl,
}: {
  tenant: string;
  project: string;
  draft: Draft;
  mayWrite: boolean;
  mayPublish: boolean;
  publicUrl: string;
}) {
  const { t } = useI18n();
  const formId = useId();
  const [payload, setPayload] = useState<EditorialPayload>(draft.payload);
  const [revision, setRevision] = useState(draft.revision);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edit = (patch: Partial<EditorialPayload>) => setPayload((p) => ({ ...p, ...patch }));
  const editSection = (index: number, patch: Partial<Section>) =>
    setPayload((p) => ({
      ...p,
      sections: p.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  const move = (index: number, delta: number) =>
    setPayload((p) => {
      const next = [...p.sections];
      const target = index + delta;
      if (target < 0 || target >= next.length) return p;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...p, sections: next };
    });

  /** One place decides what a click does, so no button can report an outcome it did not get. */
  const run = (
    act: () => Promise<{ ok: boolean; message?: string; error?: string; revision?: number }>,
  ) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await act();
      if (!result.ok) {
        setError(result.error ?? "");
        return;
      }
      if (typeof result.revision === "number") setRevision(result.revision);
      setMessage(result.message ?? "");
    });
  };

  return (
    <div className={styles.surface}>
      <Panel>
        <PanelHeader label={t("portal.editorial.surface")} note={t("portal.editorial.lead")} />
        <PanelBody>
          <p className={styles.note}>{t("portal.editorial.humanWritten")}</p>
          <p className={styles.state} data-testid="editorial-state">
            {draft.publishedSequence === null
              ? t("portal.editorial.nothingPublished")
              : t("portal.editorial.publicSince", {
                  version: String(draft.publishedSequence),
                  date: draft.publishedAt ?? "",
                })}
          </p>
          <p className={styles.note}>
            {t("portal.editorial.publicUrl")}:{" "}
            <a className={styles.link} href={publicUrl} rel="noreferrer" target="_blank">
              {publicUrl}
            </a>
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label={t("portal.editorial.draft")} />
        <PanelBody>
          <label className={styles.field} htmlFor={`${formId}-headline`}>
            {t("portal.editorial.headline")}
            <input
              className={styles.input}
              disabled={!mayWrite || pending}
              id={`${formId}-headline`}
              maxLength={160}
              onChange={(e) => edit({ headline: e.target.value })}
              value={payload.headline}
            />
          </label>
          <label className={styles.field} htmlFor={`${formId}-sub`}>
            {t("portal.editorial.subheadline")}
            <input
              className={styles.input}
              disabled={!mayWrite || pending}
              id={`${formId}-sub`}
              maxLength={160}
              onChange={(e) => edit({ subheadline: e.target.value === "" ? null : e.target.value })}
              value={payload.subheadline ?? ""}
            />
          </label>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>{t("portal.editorial.summarySection")}</legend>
            {(["findings", "implications", "measures"] as const).map((key) => (
              <label className={styles.field} htmlFor={`${formId}-${key}`} key={key}>
                {t(`portal.editorial.${key}`)}
                <textarea
                  className={styles.textarea}
                  disabled={!mayWrite || pending}
                  id={`${formId}-${key}`}
                  onChange={(e) =>
                    edit({
                      executiveSummary: {
                        ...(payload.executiveSummary ?? emptySummary()),
                        [key]: e.target.value,
                      },
                    })
                  }
                  rows={4}
                  value={payload.executiveSummary?.[key] ?? ""}
                />
              </label>
            ))}
            <p className={styles.help}>{t("portal.editorial.sourcesHelp")}</p>
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>{t("portal.editorial.sections")}</legend>
            {payload.sections.map((section, index) => (
              <div className={styles.section} key={section.key}>
                <label className={styles.field} htmlFor={`${formId}-${section.key}-title`}>
                  {t("portal.editorial.sectionTitle")}
                  <input
                    className={styles.input}
                    disabled={!mayWrite || pending}
                    id={`${formId}-${section.key}-title`}
                    maxLength={160}
                    onChange={(e) => editSection(index, { title: e.target.value })}
                    value={section.title}
                  />
                </label>
                <label className={styles.field} htmlFor={`${formId}-${section.key}-body`}>
                  {t("portal.editorial.sectionBody")}
                  <textarea
                    className={styles.textarea}
                    disabled={!mayWrite || pending}
                    id={`${formId}-${section.key}-body`}
                    onChange={(e) => editSection(index, { body: e.target.value })}
                    rows={6}
                    value={section.body}
                  />
                </label>
                <div className={styles.rowActions}>
                  <button
                    className={styles.secondary}
                    disabled={!mayWrite || pending || index === 0}
                    onClick={() => move(index, -1)}
                    type="button"
                  >
                    {t("portal.editorial.moveUp")}
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={!mayWrite || pending || index === payload.sections.length - 1}
                    onClick={() => move(index, 1)}
                    type="button"
                  >
                    {t("portal.editorial.moveDown")}
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={!mayWrite || pending}
                    onClick={() =>
                      setPayload((p) => ({
                        ...p,
                        sections: p.sections.filter((_, i) => i !== index),
                      }))
                    }
                    type="button"
                  >
                    {t("portal.editorial.removeSection")}
                  </button>
                </div>
              </div>
            ))}
            <button
              className={styles.secondary}
              disabled={!mayWrite || pending}
              onClick={() =>
                setPayload((p) => ({
                  ...p,
                  sections: [
                    ...p.sections,
                    {
                      key: `s-${Date.now().toString(36)}`,
                      kind: "custom",
                      title: "",
                      body: "",
                      assets: [],
                    },
                  ],
                }))
              }
              type="button"
            >
              {t("portal.editorial.addSection")}
            </button>
          </fieldset>

          <div className={styles.actions}>
            <button
              className={styles.primary}
              data-testid="editorial-save"
              disabled={!mayWrite || pending}
              onClick={() =>
                run(() =>
                  saveEditorialDraftAction({
                    tenant,
                    project,
                    expectedRevision: revision,
                    payload,
                  }),
                )
              }
              type="button"
            >
              {pending ? t("portal.editorial.saving") : t("portal.editorial.save")}
            </button>
            {mayPublish ? (
              <button
                className={styles.primary}
                data-testid="editorial-publish"
                disabled={pending || revision === 0}
                onClick={() =>
                  run(() => publishEditorialAction({ tenant, project, expectedRevision: revision }))
                }
                type="button"
              >
                {pending ? t("portal.editorial.publishing") : t("portal.editorial.publish")}
              </button>
            ) : null}
          </div>

          {message ? (
            <p className={styles.ok} data-testid="editorial-ok" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} data-testid="editorial-error" role="alert">
              {error}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      {mayPublish && draft.publishedSequence !== null ? (
        <Panel>
          <PanelHeader label={t("portal.editorial.withdraw")} />
          <PanelBody>
            <label className={styles.field} htmlFor={`${formId}-reason`}>
              {t("portal.editorial.withdrawReason")}
              <input
                className={styles.input}
                disabled={pending}
                id={`${formId}-reason`}
                onChange={(e) => setReason(e.target.value)}
                value={reason}
              />
              <span className={styles.help}>{t("portal.editorial.withdrawReasonHelp")}</span>
            </label>
            <button
              className={styles.secondary}
              data-testid="editorial-withdraw"
              disabled={pending || reason.trim().length < 8}
              onClick={() => run(() => withdrawEditorialAction({ tenant, project, reason }))}
              type="button"
            >
              {pending ? t("portal.editorial.withdrawing") : t("portal.editorial.withdraw")}
            </button>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
