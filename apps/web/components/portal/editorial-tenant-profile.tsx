"use client";

import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { updateEditorialProfileAction } from "@/lib/portal-editorial-actions";

import styles from "./editorial-editor.module.css";

/**
 * How a firm names itself on its own landing: a public name and the title of the engagement.
 *
 * ## Why it is its own component
 *
 * Because it is its own **permission**, on its own **row**, with its own **audience**.
 * `portal.profile.manage` is tenant-scoped (OWNER, ADMIN) and the two values it writes belong to
 * the organisation rather than to any one road — while everything else on the editorial surface
 * is a project draft behind `portal.editorial.write`.
 *
 * It lived inside `EditorialEditor` and was therefore unreachable by the only people who hold the
 * permission: a tenant ADMIN with no project membership resolves a project for administration
 * with tenant permissions and no project ones, so the surface's own
 * *`portal.editorial.write` or `portal.preview`* gate denied them before this panel rendered.
 * They held the key to a door that was behind a different locked door. Rendered on its own, the
 * administrator reaches exactly these two fields and **no draft is loaded at all** — not hidden,
 * not disabled: not read.
 *
 * ## Its own revision, and its own messages
 *
 * The profile's `revision` is a different counter from the draft's and is kept apart from it, so
 * a profile save cannot reset the number the draft's next save is checked against. The value
 * written here is the one the server returned, never an assumed `1`: with a real counter
 * (migration 0054) the third save would otherwise be rejected against a revision it invented.
 */
export function EditorialTenantProfileEditor({
  tenant,
  project,
  profile,
  mayManage,
}: {
  tenant: string;
  project: string;
  profile: { name: string; engagementLabel: string | null; revision: number };
  mayManage: boolean;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  const [name, setName] = useState(profile.name);
  const [label, setLabel] = useState(profile.engagementLabel ?? "");
  const [revision, setRevision] = useState(profile.revision);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await updateEditorialProfileAction({
        tenant,
        project,
        name: name.trim(),
        engagementLabel: label.trim() === "" ? null : label.trim(),
        expectedRevision: revision,
      });
      if (!result.ok) {
        // A conflict leaves the revision where it was. The next save is refused for the same
        // reason until the administrator reloads and reads what the other one wrote.
        setError(result.error);
        return;
      }
      if (typeof result.profileRevision === "number") setRevision(result.profileRevision);
      setMessage(result.message);
    });
  };

  return (
    <Panel>
      <PanelHeader label={t("portal.editorial.profile")} note={t("portal.editorial.profileLead")} />
      <PanelBody>
        {mayManage ? null : <p className={styles.help}>{t("portal.editorial.profileReadOnly")}</p>}
        <label className={styles.field} htmlFor={`${fieldId}-name`}>
          {t("portal.editorial.profileName")}
          <input
            className={styles.input}
            data-testid="editorial-profile-name"
            disabled={!mayManage || pending}
            id={`${fieldId}-name`}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
            value={name}
          />
        </label>
        <label className={styles.field} htmlFor={`${fieldId}-engagement`}>
          {t("portal.editorial.profileEngagement")}
          <input
            className={styles.input}
            data-testid="editorial-profile-engagement"
            disabled={!mayManage || pending}
            id={`${fieldId}-engagement`}
            maxLength={200}
            onChange={(e) => setLabel(e.target.value)}
            value={label}
          />
        </label>
        {mayManage ? (
          <button
            className={styles.primary}
            data-testid="editorial-profile-save"
            disabled={pending || name.trim() === ""}
            onClick={save}
            type="button"
          >
            {/* Not "save draft": this panel writes the firm's profile, and an administrator who
                holds only `portal.profile.manage` has no draft on the page at all. */}
            {pending ? t("portal.editorial.saving") : t("portal.editorial.profileSave")}
          </button>
        ) : null}

        {message ? (
          <p className={styles.ok} data-testid="editorial-profile-ok" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} data-testid="editorial-profile-error" role="alert">
            {error}
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
