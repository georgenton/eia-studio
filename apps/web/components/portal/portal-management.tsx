"use client";

import type { PortalManagementView, PublicationDraft } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { useState, useTransition } from "react";

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
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-EC", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));

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
          label="Lo que ve el cliente"
          note={
            management.latest
              ? `${management.latest.versionLabel} · ${dateTime(management.latest.publishedAt.toISOString())}`
              : "Todavía no se ha publicado nada"
          }
          action={
            <span className={styles.actions}>
              <Link className={styles.secondary} href={viewHref}>
                Vista del cliente
              </Link>
              {canPublish ? (
                <button
                  className={styles.primary}
                  disabled={pending}
                  onClick={publish}
                  type="button"
                >
                  {pending
                    ? "Publicando…"
                    : management.latest
                      ? "Publicar actualización"
                      : "Publicar la primera actualización"}
                </button>
              ) : null}
            </span>
          }
        />
        <PanelBody>
          <p className={styles.lead}>
            El portal es una <strong>publicación</strong>, no un reflejo del workspace. Entre una
            publicación y la siguiente, lo que el cliente ve no cambia: la consultora decide qué
            información sale y cuándo. La vista del cliente todavía no está compartida con nadie
            fuera de la organización.
          </p>
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
          label="Preparar actualización"
          note={`${draftFacts.length} cifra(s) publicable(s)`}
        />
        <PanelBody>
          <p className={styles.lead}>
            Esto es lo que diría una actualización publicada ahora mismo. Se construye a partir de
            las cifras agregadas verificadas del estudio y de la cartografía publicada; nada se
            redacta a mano.
          </p>
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
                No se publica
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
          label="Historial de publicaciones"
          note={
            management.history.length === 0
              ? "Sin publicaciones"
              : `${management.history.length} publicación(es)`
          }
        />
        <PanelBody>
          {management.history.length === 0 ? (
            <p className={styles.empty}>
              Cuando publiques una actualización aparecerá aquí, con su fecha y quién la publicó.
              Una publicación no se edita: una corrección es una publicación nueva.
            </p>
          ) : (
            <table className={styles.table}>
              <caption className="sr-only">Publicaciones del portal del cliente</caption>
              <thead>
                <tr>
                  <th scope="col">Versión</th>
                  <th scope="col">Publicada</th>
                  <th scope="col">Publicó</th>
                  <th scope="col">Cifras</th>
                  <th scope="col">Ver</th>
                </tr>
              </thead>
              <tbody>
                {management.history.map((entry) => (
                  <tr key={entry.sequence}>
                    <td className={styles.version}>{entry.versionLabel}</td>
                    <td>{dateTime(entry.publishedAt.toISOString())}</td>
                    <td>{entry.publishedByName}</td>
                    <td>{entry.figures}</td>
                    <td>
                      <Link href={`${viewHref}?v=${entry.sequence}`}>Abrir</Link>
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
