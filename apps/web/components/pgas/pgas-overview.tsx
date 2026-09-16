import type { PgasPlanView } from "@eia/application";
import type { MessageKey } from "@eia/i18n";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";

import { ProvenanceLink } from "@/components/navigation/nav";
import type { I18n } from "@/lib/locale";

import styles from "./pgas.module.css";

/**
 * The management plan, as the study wrote it.
 *
 * Three things this surface is careful about.
 *
 * **It never says the plan is deficient.** It counts what each plan states and what it leaves
 * blank, in the document's own words. Every one of the 86 delivered measures fills all nine
 * columns, so today the completeness row reads zero — and a panel that reports zero honestly is
 * what makes the same panel believable when a revision does not.
 *
 * **It never suggests the plan is being executed.** This is a chapter of a study for a road that
 * has not been built. There is no compliance state, no evidence upload and no tick box, because a
 * screen that offered one would be asserting that somebody is doing the work (ADR-024 §7).
 *
 * **It says which identifiers are ours.** The `N°` column is the document's own, repeats included.
 * The code beside it was minted here so a measure can be linked to at all, and the note says so.
 */
/** «3 programas · 11 medidas», which is what the plan actually contains. */
function planNote(plan: PgasPlanView["plans"][number], { t, fmt }: I18n): string {
  const programmes = new Set(plan.measures.map((m) => m.programmeTitle ?? "—")).size;
  return t("pgas.planNote", {
    programmes: fmt.count(programmes),
    measures: fmt.count(plan.measures.length),
  });
}

/** The measures of a plan, in the document's own programme groupings and order. */
function groupByProgramme(
  measures: PgasPlanView["plans"][number]["measures"],
): ReadonlyArray<{ title: string | null; measures: typeof measures }> {
  const groups: Array<{ title: string | null; measures: Array<(typeof measures)[number]> }> = [];
  for (const measure of measures) {
    const title = measure.programmeTitle;
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.measures.push(measure);
    else groups.push({ title, measures: [measure] });
  }
  return groups;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function Completeness({
  plan,
  i18n: { t, fmt },
}: {
  plan: PgasPlanView["plans"][number];
  i18n: I18n;
}) {
  const gaps = Object.entries(plan.completeness.missing).filter(([, count]) => count > 0);
  if (gaps.length === 0) {
    return (
      <p className={styles.complete}>
        {t("pgas.complete", { count: fmt.count(plan.completeness.measures) })}
      </p>
    );
  }
  return (
    <ul className={styles.gaps}>
      {gaps.map(([field, count]) => (
        <li key={field}>
          {t("pgas.gap", {
            count: fmt.count(count),
            total: fmt.count(plan.completeness.measures),
            field: t(`pgas.field.${field}` as MessageKey),
          })}
        </li>
      ))}
    </ul>
  );
}

export function PgasOverview({ view, i18n }: { view: PgasPlanView; i18n: I18n }) {
  const { t, fmt } = i18n;
  if (!view.imported) {
    return (
      <Panel>
        <PanelHeader label={t("pgas.title")} />
        <PanelBody>
          <p className={styles.note} data-system-state="empty">
            {t("pgas.notImported")}
          </p>
        </PanelBody>
      </Panel>
    );
  }

  const measures = view.plans.reduce((sum, p) => sum + p.measures.length, 0);
  const withoutCode = view.plans.filter((p) => !p.completeness.hasCode);

  return (
    <div className={styles.surface}>
      <Panel>
        <PanelHeader
          label={t("pgas.title")}
          note={t("pgas.countNote", {
            plans: fmt.count(view.plans.length),
            measures: fmt.count(measures),
          })}
        />
        <PanelBody>
          <p className={styles.intro}>{t("pgas.intro")}</p>
          <p className={styles.source}>
            {t("pgas.sourceLine", {
              file: view.imported.file,
              measures: fmt.count(view.imported.measures),
              plans: fmt.count(view.imported.plans),
            })}
            <ProvenanceLink href={`?prov=${view.imported.provenanceId}`}>
              {t("pgas.viewProvenance")}
            </ProvenanceLink>
          </p>

          {withoutCode.length > 0 ? (
            <p className={styles.observation}>
              {withoutCode.length === 1
                ? t("pgas.onePlanWithoutCode")
                : t("pgas.plansWithoutCode", { count: fmt.count(withoutCode.length) })}
              {withoutCode.map((p) => p.title).join(" · ")}
            </p>
          ) : null}

          {view.headingVariants.length > 0 ? (
            <p className={styles.observation}>
              {t("pgas.headingVariants", {
                count: fmt.count(view.headingVariants.length),
                variants: view.headingVariants
                  .map((v) => v.spellings.map((spelling) => `«${spelling}»`).join(" / "))
                  .join(" · "),
              })}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      {view.plans.map((plan) => (
        <Panel key={`${plan.code ?? plan.title}`}>
          <PanelHeader
            label={plan.code ? `${plan.code} · ${plan.title}` : plan.title}
            note={planNote(plan, i18n)}
          />
          <PanelBody>
            {plan.objective ? <p className={styles.objective}>{plan.objective}</p> : null}
            {plan.place ? <p className={styles.place}>{plan.place}</p> : null}
            <Completeness i18n={i18n} plan={plan} />

            {/*
              The document's own second level. A programme is a banner row with a title and nothing
              else (ADR-024), and reading the plan without it turns eleven measures about different
              subjects into one undifferentiated list.
            */}
            {groupByProgramme(plan.measures).map((group) => (
              <section className={styles.programme} key={group.title ?? "sin-programa"}>
                <h3 className={styles.programmeTitle}>{group.title ?? t("pgas.noProgramme")}</h3>
                <ol className={styles.measures}>
                  {group.measures.map((m) => (
                    <li className={styles.measure} key={m.measureCode}>
                      <p className={styles.measureText}>{m.measure || t("common.missing")}</p>
                      <dl className={styles.fields}>
                        <Field label={t("pgas.aspect")} value={m.aspect} />
                        <Field label={t("pgas.impact")} value={m.impact} />
                        <Field label={t("pgas.indicator")} value={m.indicator} />
                        <Field label={t("pgas.verification")} value={m.verification} />
                        <Field label={t("pgas.responsible")} value={m.responsible} />
                        <Field label={t("pgas.frequency")} value={m.frequency} />
                        <Field label={t("pgas.deadline")} value={m.deadline} />
                      </dl>
                      <p className={styles.measureIds}>
                        <span>
                          {t("pgas.documentNumber")}{" "}
                          <strong>{m.statedNumber || t("common.missing")}</strong>
                        </span>
                        <span className={styles.code}>
                          {t("pgas.studioCode", { code: m.measureCode })}
                        </span>
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ))}

            {/*
              Source fidelity, one click away. The labels above are normalized so the plan reads;
              the document's own headings — `FRENCUENCIA` included — are what it actually says, and
              they are what is stored.
            */}
            <details className={styles.headings}>
              <summary>{t("pgas.columnsSummary")}</summary>
              <p>
                {t("pgas.columnsBody", {
                  columns: plan.columns.map((column) => `«${column}»`).join(" · "),
                })}
              </p>
            </details>
          </PanelBody>
        </Panel>
      ))}

      <p className={styles.footnote}>{t("pgas.footnote")}</p>
    </div>
  );
}
