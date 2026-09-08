import type { PublishedClientView } from "@eia/application";
import type { BasemapCatalogue, PublicFact } from "@eia/domain";

import { PublicationMap } from "./publication-map";
import { PrintButton } from "./print-button";

import styles from "./portal.module.css";

/**
 * What the client sees.
 *
 * Everything on this page comes from `view.payload` — one immutable row that somebody in the firm
 * decided to publish on a date. Nothing here queries the project, and there is no prop through
 * which it could: the component's only data input is the publication.
 *
 * The words are the client's, not ours. No provenance vocabulary, no capability names, no run
 * ids, no questionnaire versions, no model anything. Where a section has nothing to show it says
 * so plainly rather than showing a plausible zero.
 */
const dateLong = (date: Date) =>
  new Intl.DateTimeFormat("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

function Facts({ facts }: { facts: ReadonlyArray<PublicFact> }) {
  return (
    <dl className={styles.facts}>
      {facts.map((fact) => (
        <div className={styles.fact} key={fact.key}>
          <dt className={styles.factLabel}>{fact.label}</dt>
          <dd className={styles.factValue}>
            {fact.value}
            {fact.unit ? <span className={styles.factUnit}>{fact.unit}</span> : null}
            {fact.basis ? <p className={styles.factBasis}>{fact.basis}</p> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ClientPublicationView({
  view,
  basemap,
}: {
  view: PublishedClientView;
  basemap: BasemapCatalogue;
}) {
  const { payload } = view;
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <p className={styles.brand}>Informe de avance para el cliente</p>
          <h1 className={styles.title}>{payload.project.name}</h1>
          <p className={styles.subtitle}>
            {payload.project.locality}
            {payload.project.programmeReference ? ` · ${payload.project.programmeReference}` : ""}
          </p>
          {payload.project.officialTitle ? (
            <p className={styles.officialTitle}>{payload.project.officialTitle}</p>
          ) : null}
          <p className={styles.published}>
            <span>
              Última actualización publicada:{" "}
              <span className={styles.publishedDate}>{dateLong(view.publishedAt)}</span>
            </span>
            <PrintButton />
          </p>
        </div>
      </header>

      <div className={styles.content}>
        <section aria-labelledby="resumen" className={styles.section}>
          <h2 className={styles.sectionTitle} id="resumen">
            Resumen del estudio
          </h2>
          <p className={styles.sectionNote}>{payload.summary.headline}</p>
          {payload.summary.facts.length > 0 ? (
            <Facts facts={payload.summary.facts} />
          ) : (
            <p className={styles.empty}>
              No se ha publicado todavía ninguna cifra de resumen para este estudio.
            </p>
          )}
        </section>

        <section aria-labelledby="territorio" className={styles.section}>
          <h2 className={styles.sectionTitle} id="territorio">
            Territorio
          </h2>
          <p className={styles.sectionNote}>{payload.territory.note}</p>
          <PublicationMap basemap={basemap} territory={payload.territory} />
        </section>

        <section aria-labelledby="participacion" className={styles.section}>
          <h2 className={styles.sectionTitle} id="participacion">
            Participación y componente social
          </h2>
          {payload.participation.note ? (
            <p className={styles.sectionNote}>{payload.participation.note}</p>
          ) : null}
          {payload.participation.facts.length > 0 ? (
            <Facts facts={payload.participation.facts} />
          ) : (
            <p className={styles.empty}>
              No se ha publicado todavía información del componente social.
            </p>
          )}
        </section>

        {payload.managementPlan ? (
          <section aria-labelledby="pma" className={styles.section}>
            <h2 className={styles.sectionTitle} id="pma">
              Plan de Manejo Ambiental
            </h2>
            {payload.managementPlan.note ? (
              <p className={styles.sectionNote}>{payload.managementPlan.note}</p>
            ) : null}
            <Facts facts={payload.managementPlan.facts} />
            <ul className={styles.planList}>
              {payload.managementPlan.plans.map((plan) => (
                <li className={styles.planItem} key={`${plan.code ?? ""}${plan.title}`}>
                  <span className={styles.planTitle}>{plan.title}</span>
                  <span className={styles.planCount}>
                    {plan.measures === 1 ? "1 medida" : `${plan.measures} medidas`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="seguimiento" className={styles.section}>
          <h2 className={styles.sectionTitle} id="seguimiento">
            Seguimiento
          </h2>
          {payload.milestones.length > 0 ? (
            <ul className={styles.planList}>
              {payload.milestones.map((milestone) => (
                <li className={styles.planItem} key={milestone.title}>
                  <span className={styles.planTitle}>{milestone.title}</span>
                  <span className={styles.planCount}>{milestone.state}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              No se ha publicado todavía información de avance operativo.
            </p>
          )}
        </section>

        <section aria-labelledby="entregables" className={styles.section}>
          <h2 className={styles.sectionTitle} id="entregables">
            Entregables
          </h2>
          {payload.deliverables.length > 0 ? (
            <ul className={styles.planList}>
              {payload.deliverables.map((deliverable) => (
                <li className={styles.planItem} key={deliverable.title}>
                  <span className={styles.planTitle}>{deliverable.title}</span>
                  <span className={styles.planCount}>{deliverable.state}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              No hay entregables publicados. Cuando la consultora apruebe un documento para su
              entrega, aparecerá aquí.
            </p>
          )}
        </section>

        {payload.notes.length > 0 ? (
          <ul className={styles.footnotes}>
            {payload.notes.map((note) => (
              <li className={styles.footnote} key={note}>
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
