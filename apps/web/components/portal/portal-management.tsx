"use client";

import type { PortalManagementView, PublicationDraft } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { publishPublicationAction } from "@/lib/portal-actions";

import styles from "./portal.module.css";

/**
 * `Portal del cliente`, for the consulting team.
 *
 * Three things and no more: what the client can see now, what an update *would* say, and the
 * history of what has been said. Deliberately not a content manager — nobody writes copy here.
 * The draft is computed from the project's own verified aggregates, and the only decision on this
 * screen is whether to make it the thing the client sees.
 */
export function PortalManagementPanel({
  management,
  draft,
  tenant,
  project,
  canPublish,
}: {
  management: PortalManagementView;
  draft: PublicationDraft;
  tenant: string;
  project: string;
  canPublish: boolean;
}) {
  const { t, fmt } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const publish = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await publishPublicationAction({ tenant, project });
      setFailed(!result.ok);
      setMessage(result.ok ? result.message : result.error);
    });
  };

  const draftFacts = [
    ...draft.payload.summary.facts,
    ...draft.payload.participation.facts,
    ...(draft.payload.managementPlan?.facts ?? []),
  ];
  const viewHref = `/portal/${tenant}/${project}`;

  return (
    <div className={styles.surface}>
      <Panel>
        <PanelHeader
          label={t("portal.whatClientSees")}
          note={
            management.latest
              ? `${management.latest.versionLabel} · ${fmt.dateTime(management.latest.publishedAt)}`
              : t("portal.nothingPublished")
          }
          action={
            <span className={styles.actions}>
              <Link className={styles.secondary} href={viewHref}>
                {t("portal.clientView")}
              </Link>
              {canPublish ? (
                <button
                  className={styles.primary}
                  disabled={pending}
                  onClick={publish}
                  type="button"
                >
                  {pending
                    ? t("portal.publishing")
                    : management.latest
                      ? t("portal.publish")
                      : t("portal.publishFirst")}
                </button>
              ) : null}
            </span>
          }
        />
        <PanelBody>
          <p className={styles.lead}>{t("portal.portalLead")}</p>
          {message ? (
            <p
              aria-live="polite"
              className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}
              role="status"
            >
              {message}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label={t("portal.prepare")}
          note={t("portal.draftCount", { count: fmt.count(draftFacts.length) })}
        />
        <PanelBody>
          <p className={styles.lead}>{t("portal.draftLead")}</p>
          <ul className={styles.draftFacts}>
            {draftFacts.map((fact) => (
              <li className={styles.draftFact} key={fact.key}>
                {fact.label}: {fact.value}
                {fact.unit ? ` ${fact.unit}` : ""}
              </li>
            ))}
          </ul>
          {draft.withheld.length > 0 ? (
            <>
              <h3
                className={styles.factLabel}
                style={{ marginTop: 18, marginBottom: 10, fontSize: "9.5px" }}
              >
                {t("portal.notPublished")}
              </h3>
              <ul className={styles.withheld}>
                {draft.withheld.map((item) => (
                  <li className={styles.withheldItem} key={item.key}>
                    <span className={styles.withheldLabel}>{item.label}</span>
                    {item.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label={t("portal.history")}
          note={
            management.history.length === 0
              ? t("portal.noPublications")
              : t("portal.publicationsCount", { count: fmt.count(management.history.length) })
          }
        />
        <PanelBody>
          {management.history.length === 0 ? (
            <p className={styles.empty}>{t("portal.historyEmpty")}</p>
          ) : (
            <table className={styles.table}>
              <caption className="sr-only">{t("portal.historyCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("common.version")}</th>
                  <th scope="col">{t("portal.publishedAt")}</th>
                  <th scope="col">{t("portal.publishedBy")}</th>
                  <th scope="col">{t("portal.figures")}</th>
                  <th scope="col">{t("portal.view")}</th>
                </tr>
              </thead>
              <tbody>
                {management.history.map((entry) => (
                  <tr key={entry.sequence}>
                    <td className={styles.version}>{entry.versionLabel}</td>
                    <td>{fmt.dateTime(entry.publishedAt)}</td>
                    <td>{entry.publishedByName}</td>
                    <td>{fmt.count(entry.figures)}</td>
                    <td>
                      <Link href={`${viewHref}?v=${entry.sequence}`}>{t("common.open")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
