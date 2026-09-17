"use client";

import { FORMAT_DESCRIPTORS, TEMPLATE_KINDS, TEMPLATE_LOCALES } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import {
  activateTemplateVersionAction,
  completeTemplateUploadAction,
  createTemplateAction,
  generateDocumentAction,
  putTemplateBytesAction,
  requestTemplateUploadAction,
  revalidateTemplateVersionAction,
} from "@/lib/template-actions";
import { templateKindLabel, templateLocaleLabel, templateStateLabel } from "@/lib/labels";

import styles from "./templates.module.css";

export interface TemplateVersionView {
  readonly id: string;
  readonly versionLabel: string;
  readonly locale: string;
  readonly state: string;
  readonly supported: ReadonlyArray<string>;
  readonly unknown: ReadonlyArray<string>;
  readonly required: ReadonlyArray<string>;
  readonly tagCount: number;
  readonly validationError: string | null;
}

export interface TemplateView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly purpose: string;
  readonly versions: ReadonlyArray<TemplateVersionView>;
}

/**
 * Registering a template, uploading a version, activating it and generating from it (ADR-036).
 *
 * The surface's whole job is to make the **unknown placeholders** visible before anybody can
 * activate anything. A template's errors belong to a person, not to a silently blank paragraph in
 * a document a client receives.
 */
export function TemplateLibrary({
  tenant,
  project,
  templates,
  canUpload,
}: {
  tenant: string;
  project: string;
  templates: ReadonlyArray<TemplateView>;
  canUpload: boolean;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("cover");
  const [purpose, setPurpose] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [locale, setLocale] = useState<string>("es-EC");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const accept = FORMAT_DESCRIPTORS.docx.extensions.join(",");

  const announce = (result: { ok: boolean; message?: string; error?: string }) => {
    setMessage(result.ok ? (result.message ?? null) : null);
    setError(result.ok ? null : (result.error ?? null));
  };

  const create = () => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      announce(await createTemplateAction({ tenant, project, code, name, kind, purpose }));
    });
  };

  const upload = () => {
    setMessage(null);
    setError(null);
    if (!file) {
      setError(t("templates.needsFile"));
      return;
    }
    const chosen = file;
    startTransition(async () => {
      const intent = await requestTemplateUploadAction({
        tenant,
        project,
        filename: chosen.name,
        mimeType: chosen.type || "application/octet-stream",
        sizeBytes: chosen.size,
      });
      if (!intent.ok) {
        setError(intent.error);
        return;
      }

      // The bytes go to the provider, not through this application — except on the in-memory
      // store, whose "URL" is a token only the server understands (ADR-031).
      if (intent.viaServer) {
        const buffer = await chosen.arrayBuffer();
        const sent = await putTemplateBytesAction({
          tenant,
          project,
          objectKey: intent.objectKey,
          contentType: chosen.type || "application/octet-stream",
          base64: Buffer.from(buffer).toString("base64"),
        });
        if (!sent.ok) {
          setError(sent.error ?? t("templates.uploadFailed"));
          return;
        }
      } else {
        const response = await fetch(intent.url, {
          method: intent.method,
          headers: intent.headers,
          body: chosen,
        });
        if (!response.ok) {
          setError(t("templates.uploadFailed"));
          return;
        }
      }

      announce(
        await completeTemplateUploadAction({
          tenant,
          project,
          templateId,
          locale,
          intentId: intent.intentId,
          objectKey: intent.objectKey,
        }),
      );
    });
  };

  const act = (
    action: (raw: unknown) => Promise<{ ok: boolean; message?: string; error?: string }>,
    versionId: string,
  ) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      announce(await action({ tenant, project, versionId }));
    });
  };

  return (
    <>
      {canUpload ? (
        <Panel>
          <PanelHeader label={t("templates.newTemplate")} note={t("templates.newTemplateLead")} />
          <PanelBody>
            <label className={styles.field} htmlFor={`${fieldId}-code`}>
              {t("templates.code")}
              <input
                className={styles.input}
                id={`${fieldId}-code`}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                value={code}
              />
              <span className={styles.help}>{t("templates.codeHelp")}</span>
            </label>
            <label className={styles.field} htmlFor={`${fieldId}-name`}>
              {t("templates.name")}
              <input
                className={styles.input}
                id={`${fieldId}-name`}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <label className={styles.field} htmlFor={`${fieldId}-kind`}>
              {t("templates.kind")}
              <select
                className={styles.select}
                id={`${fieldId}-kind`}
                onChange={(event) => setKind(event.target.value)}
                value={kind}
              >
                {TEMPLATE_KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {templateKindLabel(t, entry)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field} htmlFor={`${fieldId}-purpose`}>
              {t("templates.purpose")}
              <input
                className={styles.input}
                id={`${fieldId}-purpose`}
                onChange={(event) => setPurpose(event.target.value)}
                value={purpose}
              />
              <span className={styles.help}>{t("templates.purposeHelp")}</span>
            </label>
            <button className={styles.primary} disabled={pending} onClick={create} type="button">
              {t("templates.create")}
            </button>
          </PanelBody>
        </Panel>
      ) : null}

      {canUpload && templates.length > 0 ? (
        <Panel>
          <PanelHeader
            label={t("templates.uploadVersion")}
            note={t("templates.uploadVersionLead")}
          />
          <PanelBody>
            <p className={styles.note}>{t("templates.localeNote")}</p>
            <label className={styles.field} htmlFor={`${fieldId}-template`}>
              {t("templates.uploadTemplateField")}
              <select
                className={styles.select}
                id={`${fieldId}-template`}
                onChange={(event) => setTemplateId(event.target.value)}
                value={templateId}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.code} · {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field} htmlFor={`${fieldId}-locale`}>
              {t("templates.uploadLocale")}
              <select
                className={styles.select}
                id={`${fieldId}-locale`}
                onChange={(event) => setLocale(event.target.value)}
                value={locale}
              >
                {TEMPLATE_LOCALES.map((entry) => (
                  <option key={entry} value={entry}>
                    {templateLocaleLabel(t, entry)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field} htmlFor={`${fieldId}-file`}>
              {t("templates.uploadFile")}
              <input
                accept={accept}
                className={styles.input}
                id={`${fieldId}-file`}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <button className={styles.primary} disabled={pending} onClick={upload} type="button">
              {pending ? t("templates.uploading") : t("templates.upload")}
            </button>
          </PanelBody>
        </Panel>
      ) : null}

      {message ? (
        <p className={styles.note} data-testid="template-message">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} data-testid="template-error">
          {error}
        </p>
      ) : null}

      <Panel>
        <PanelHeader label={t("templates.title")} note={t("templates.lead")} />
        <PanelBody>
          <p className={styles.note}>{t("templates.distinction")}</p>
          <p className={styles.draft}>{t("templates.draftNote")}</p>
          {templates.length === 0 ? (
            <p className={styles.note} data-system-state="empty">
              {t("templates.noTemplates")}
            </p>
          ) : (
            <ul className={styles.templates}>
              {templates.map((template) => (
                <li className={styles.template} key={template.id} data-testid="template">
                  <div className={styles.templateHead}>
                    <span className={styles.code}>{template.code}</span>
                    <h3 className={styles.templateName}>{template.name}</h3>
                    <span className={styles.label}>{templateKindLabel(t, template.kind)}</span>
                  </div>
                  <p className={styles.note}>{template.purpose}</p>

                  {template.versions.length === 0 ? null : (
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">{t("templates.versionLabel")}</th>
                          <th scope="col">{t("templates.locale")}</th>
                          <th scope="col">{t("templates.state")}</th>
                          <th scope="col">{t("templates.manifestTitle")}</th>
                          <th scope="col">{t("common.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {template.versions.map((version) => (
                          <tr key={version.id} data-testid="template-version">
                            <td className={styles.code}>{version.versionLabel}</td>
                            <td>{templateLocaleLabel(t, version.locale)}</td>
                            <td>{templateStateLabel(t, version.state)}</td>
                            <td>
                              {version.validationError ? (
                                <span className={styles.unknown}>
                                  {t("templates.validationError", {
                                    error: version.validationError,
                                  })}
                                </span>
                              ) : (
                                <div className={styles.manifest}>
                                  <span>
                                    {t("templates.supported")}: {version.supported.join(", ")}
                                  </span>
                                  {version.unknown.length > 0 ? (
                                    <span className={styles.unknown} data-testid="unknown-tags">
                                      {t("templates.unknown")}: {version.unknown.join(", ")}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td>
                              {canUpload ? (
                                <div className={styles.row}>
                                  {version.state === "VALIDATED" ? (
                                    <button
                                      className={styles.primary}
                                      disabled={pending}
                                      onClick={() => act(activateTemplateVersionAction, version.id)}
                                      type="button"
                                    >
                                      {pending
                                        ? t("templates.activating")
                                        : t("templates.activate")}
                                    </button>
                                  ) : null}
                                  {version.state === "UPLOADED" ? (
                                    <button
                                      className={styles.secondary}
                                      disabled={pending}
                                      onClick={() =>
                                        act(revalidateTemplateVersionAction, version.id)
                                      }
                                      type="button"
                                    >
                                      {t("templates.revalidate")}
                                    </button>
                                  ) : null}
                                  {version.state === "ACTIVE" ? (
                                    <button
                                      className={styles.primary}
                                      disabled={pending}
                                      onClick={() => act(generateDocumentAction, version.id)}
                                      type="button"
                                    >
                                      {pending
                                        ? t("templates.generating")
                                        : t("templates.generate")}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {template.versions.some((version) => version.unknown.length > 0) ? (
                    <p className={styles.note}>{t("templates.unknownBlocks")}</p>
                  ) : null}
                  {template.versions.some((version) => version.state === "VALIDATED") ? (
                    <p className={styles.note}>{t("templates.activateHelp")}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
