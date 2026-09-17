"use client";

import { SYSTEM_PROFILES } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { createProjectAction } from "@/lib/project-actions";

import styles from "@/app/t/[tenant]/portfolio.module.css";

/**
 * Creating a project, from the Portfolio (Wave 3).
 *
 * Deliberately small: a slug, a name and a profile. Everything that makes a project a *study* —
 * its official title, its programme, its locality, its offline policy — is filled in afterwards in
 * *Preparar proyecto*, because that is the surface a firm's data staff work in and duplicating its
 * fields here would create a second place they can disagree (ADR-030).
 *
 * The profile is a choice rather than a default, because it decides which modules the project has.
 */
export function NewProject({ tenant }: { tenant: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const fieldId = useId();
  const profiles = [...SYSTEM_PROFILES.values()];
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [profileKey, setProfileKey] = useState(profiles[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createProjectAction({ tenant, slug, name, profileKey });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Straight into the surface that prepares it: creating a project is the first half of one
      // act, and leaving somebody on a list to find their own way is the other half undone.
      router.push(`/t/${tenant}/p/${result.slug}/intake`);
    });
  };

  return (
    <Panel>
      <PanelHeader label={t("portfolio.newProject")} note={t("portfolio.newProjectLead")} />
      <PanelBody>
        <label className={styles.newProjectField} htmlFor={`${fieldId}-name`}>
          {t("portfolio.newProjectName")}
          <input
            className={styles.newProjectInput}
            id={`${fieldId}-name`}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className={styles.newProjectField} htmlFor={`${fieldId}-slug`}>
          {t("portfolio.newProjectSlug")}
          <input
            className={styles.newProjectInput}
            id={`${fieldId}-slug`}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            value={slug}
          />
          <span className={styles.newProjectHelp}>{t("portfolio.newProjectSlugHelp")}</span>
        </label>
        <label className={styles.newProjectField} htmlFor={`${fieldId}-profile`}>
          {t("portfolio.newProjectProfile")}
          <select
            className={styles.newProjectInput}
            id={`${fieldId}-profile`}
            onChange={(event) => setProfileKey(event.target.value)}
            value={profileKey}
          >
            {profiles.map((profile) => (
              <option key={profile.key} value={profile.key}>
                {t(`vocabulary.profile.${profile.key}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
          <span className={styles.newProjectHelp}>{t("portfolio.newProjectProfileHelp")}</span>
        </label>
        <button
          className={styles.newProjectSubmit}
          disabled={pending}
          onClick={submit}
          type="button"
        >
          {pending ? t("portfolio.newProjectCreating") : t("portfolio.newProjectSubmit")}
        </button>
        {error ? (
          <p className={styles.newProjectError} data-testid="new-project-error">
            {error}
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
