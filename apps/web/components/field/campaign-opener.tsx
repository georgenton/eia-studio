"use client";

import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { activateCampaignAction, createCampaignAction } from "@/lib/field-work-actions";

import styles from "./field-work.module.css";

export interface PublishedVersionOption {
  readonly id: string;
  readonly label: string;
  readonly templateName: string;
}

/**
 * Opening the operation that field work belongs to.
 *
 * Until this existed, a project with cartography and a published questionnaire reached *Asignación
 * de predios* and found an empty state: there was no campaign, and nothing on any screen could
 * make one. The surface is deliberately small — a name, a published questionnaire, a channel, two
 * optional dates — because a campaign is an operational snapshot, not a plan: no calendar, no
 * distribution rules, no bulk assignment.
 *
 * Creating and activating are two buttons because they are two decisions. A draft can be looked
 * at, have parcels assigned to it and be abandoned; activating is the moment a technician's phone
 * starts downloading it, and the server refuses it until a published questionnaire, at least one
 * assignment and a compatible channel are all true.
 */
export function CampaignOpener({
  tenant,
  project,
  versions,
  draft,
}: {
  readonly tenant: string;
  readonly project: string;
  readonly versions: readonly PublishedVersionOption[];
  /** A campaign that exists but has not been activated, when there is one. */
  readonly draft: {
    readonly id: string;
    readonly name: string;
    readonly assignments: number;
  } | null;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState("");
  const [targetOn, setTargetOn] = useState("");

  function run(
    action: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>,
  ) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) setMessage(result.message);
      else setError(result.error);
    });
  }

  if (draft !== null) {
    return (
      <Panel>
        <PanelHeader label={t("field.campaign.draftTitle")} />
        <PanelBody>
          <p className={styles.lead}>{t("field.campaign.draftLead")}</p>
          <p data-testid="campaign-draft-name">
            <strong>{draft.name}</strong> ·{" "}
            {t("field.campaign.assignmentCount", { count: String(draft.assignments) })}
          </p>
          <button
            className={styles.primary}
            data-testid="campaign-activate"
            disabled={pending}
            onClick={() => {
              run(() => activateCampaignAction({ tenant, project, campaignId: draft.id }));
            }}
            type="button"
          >
            {t("field.campaign.activate")}
          </button>
          {message !== null && <p data-testid="campaign-ok">{message}</p>}
          {/* The server's own words: why it cannot be activated yet is the useful part. */}
          {error !== null && <p data-testid="campaign-error">{error}</p>}
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader label={t("field.campaign.createTitle")} />
      <PanelBody>
        <p className={styles.lead}>{t("field.campaign.createLead")}</p>
        {versions.length === 0 ? (
          <p data-testid="campaign-no-versions">{t("field.campaign.noVersions")}</p>
        ) : (
          <div className={styles.form}>
            <label className={styles.field}>
              {t("field.campaign.name")}
              <input
                data-testid="campaign-name"
                onChange={(e) => setName(e.target.value)}
                placeholder={t("field.campaign.namePlaceholder")}
                type="text"
                value={name}
              />
            </label>
            <label className={styles.field}>
              {t("field.campaign.version")}
              <select
                data-testid="campaign-version"
                onChange={(e) => setVersionId(e.target.value)}
                value={versionId}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.templateName} · {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              {t("field.campaign.startsOn")}
              <input
                data-testid="campaign-starts-on"
                onChange={(e) => setStartsOn(e.target.value)}
                type="date"
                value={startsOn}
              />
            </label>
            <label className={styles.field}>
              {t("field.campaign.targetOn")}
              <input
                data-testid="campaign-target-on"
                onChange={(e) => setTargetOn(e.target.value)}
                type="date"
                value={targetOn}
              />
            </label>
            <button
              className={styles.primary}
              data-testid="campaign-create"
              disabled={pending || name.trim().length < 3 || versionId === ""}
              onClick={() => {
                run(() =>
                  createCampaignAction({
                    tenant,
                    project,
                    name: name.trim(),
                    surveyVersionId: versionId,
                    // The phone is the channel this exists for; the web form stays available to a
                    // project configured for it, and the server decides which the policy allows.
                    captureChannel: "EIA_FIELD_MOBILE",
                    startsOn: startsOn === "" ? null : startsOn,
                    targetOn: targetOn === "" ? null : targetOn,
                  }),
                );
              }}
              type="button"
            >
              {t("field.campaign.create")}
            </button>
          </div>
        )}
        {message !== null && <p data-testid="campaign-ok">{message}</p>}
        {error !== null && <p data-testid="campaign-error">{error}</p>}
      </PanelBody>
    </Panel>
  );
}
