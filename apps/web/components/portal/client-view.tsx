import type { PublishedClientView } from "@eia/application";
import type { BasemapCatalogue, PublicFact } from "@eia/domain";
import { DEFAULT_LOCALE, formatIsoDate } from "@eia/i18n";

import { i18nFor } from "@/lib/locale";

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
 *
 * ## Why this page does not follow the reader's language
 *
 * A publication is a statement the firm made to its customer on a date, and its payload — every
 * headline, fact label and plan title — is stored as it was composed. Translating the headings
 * around it while the figures stay in the language they were published in would produce a page
 * that is half one language and half the other, and would imply the firm said something it did
 * not. So the client's page is rendered in the language the publication was composed in, which
 * today is always `es-EC`; publishing in a second language is a decision with a column behind it
 * (TD-085), not a rendering choice here. The internal preview strip *around* this content is
 * workspace chrome and does follow the reader.
 */
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
  const { t, fmt } = i18nFor(DEFAULT_LOCALE);
  const { payload } = view;
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <p className={styles.brand}>{t("portal.clientBrand")}</p>
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
              {t("portal.lastPublished")}{" "}
              <span className={styles.publishedDate}>
                {formatIsoDate(fmt.locale, view.publishedAt.toISOString().slice(0, 10))}
              </span>
            </span>
            <PrintButton />
          </p>
        </div>
      </header>

      <div className={styles.content}>
        <section aria-labelledby="resumen" className={styles.section}>
          <h2 className={styles.sectionTitle} id="resumen">
            {t("portal.summaryTitle")}
          </h2>
          <p className={styles.sectionNote}>{payload.summary.headline}</p>
          {payload.summary.facts.length > 0 ? (
            <Facts facts={payload.summary.facts} />
          ) : (
            <p className={styles.empty}>{t("portal.summaryEmpty")}</p>
          )}
        </section>

        <section aria-labelledby="territorio" className={styles.section}>
          <h2 className={styles.sectionTitle} id="territorio">
            {t("portal.territoryTitle")}
          </h2>
          <p className={styles.sectionNote}>{payload.territory.note}</p>
          <PublicationMap basemap={basemap} territory={payload.territory} />
        </section>

        <section aria-labelledby="participacion" className={styles.section}>
          <h2 className={styles.sectionTitle} id="participacion">
            {t("portal.participationTitle")}
          </h2>
          {payload.participation.note ? (
            <p className={styles.sectionNote}>{payload.participation.note}</p>
          ) : null}
          {payload.participation.facts.length > 0 ? (
            <Facts facts={payload.participation.facts} />
          ) : (
            <p className={styles.empty}>{t("portal.participationEmpty")}</p>
          )}
        </section>

        {payload.managementPlan ? (
          <section aria-labelledby="pma" className={styles.section}>
            <h2 className={styles.sectionTitle} id="pma">
              {t("portal.managementPlanTitle")}
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
                    {plan.measures === 1
                      ? t("portal.measureOne")
                      : t("portal.measureMany", { count: fmt.count(plan.measures) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="seguimiento" className={styles.section}>
          <h2 className={styles.sectionTitle} id="seguimiento">
            {t("portal.followUpTitle")}
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
            <p className={styles.empty}>{t("portal.followUpEmpty")}</p>
          )}
        </section>

        <section aria-labelledby="entregables" className={styles.section}>
          <h2 className={styles.sectionTitle} id="entregables">
            {t("portal.deliverablesTitle")}
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
            <p className={styles.empty}>{t("portal.deliverablesEmpty")}</p>
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
