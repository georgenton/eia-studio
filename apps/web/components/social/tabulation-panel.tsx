import type { SocialTabulation } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";

import type { I18n } from "@/lib/locale";

import styles from "./social.module.css";

/**
 * Deterministic tabulation of the closed questions.
 *
 * Every figure here was counted in SQL from submitted responses and turned into a share by
 * `tabulateQuestion`; nothing on this panel came from a model, and the copy says so once at the
 * top rather than decorating each row.
 *
 * The denominator is printed beside every question, in words. That is the difference between a
 * percentage a reader can check and one they have to trust: a multi-choice question's shares are
 * over *respondents*, so they can sum past 100 %, and a screen that hid that would be publishing a
 * number whose meaning only the query knows.
 *
 * Bars are two divs and a width. A chart library would add a dependency, a bundle and a rendering
 * mode for something a table already says precisely.
 */
export function TabulationPanel({
  tabulation,
  i18n: { t, fmt },
}: {
  tabulation: SocialTabulation;
  i18n: I18n;
}) {
  if (tabulation.questions.length === 0) {
    return (
      <Panel>
        <PanelHeader label={t("social.tabulationTitle")} />
        <PanelBody>
          <p className={styles.note} data-system-state="no-survey-data">
            {t("social.noClosedQuestions")}
          </p>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        label={t("social.tabulationTitle")}
        action={<span className={styles.deterministic}>{t("social.deterministic")}</span>}
      />
      <PanelBody>
        <p className={styles.note}>
          {t("social.tabulationLead", {
            template: tabulation.templateName,
            version: tabulation.versionLabel,
            submitted: fmt.count(tabulation.submitted),
          })}
        </p>

        <div className={styles.questions}>
          {tabulation.questions.map((question) => {
            const rule = question.denominatorRule;
            return (
              <section key={question.questionId} className={styles.question}>
                <h3 className={styles.questionPrompt}>{question.prompt}</h3>
                <p className={styles.denominator}>
                  {t("social.answeredLine", {
                    answered: fmt.count(question.answered),
                    unanswered: fmt.count(question.unanswered),
                    rule: t(`social.denominator.${rule}` as "social.denominator.submitted"),
                  })}
                </p>
                <p className={styles.denominatorHelp}>
                  {t(`social.denominatorHelp.${rule}` as "social.denominatorHelp.submitted")}
                </p>

                {question.numeric ? (
                  <dl className={styles.numeric}>
                    <div>
                      <dt>{t("social.minimum")}</dt>
                      <dd>{fmt.count(question.numeric.min)}</dd>
                    </div>
                    <div>
                      <dt>{t("social.median")}</dt>
                      <dd>{fmt.count(question.numeric.median)}</dd>
                    </div>
                    <div>
                      <dt>{t("social.mean")}</dt>
                      <dd>{fmt.decimal(question.numeric.mean, 1)}</dd>
                    </div>
                    <div>
                      <dt>{t("social.maximum")}</dt>
                      <dd>{fmt.count(question.numeric.max)}</dd>
                    </div>
                  </dl>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">{t("social.option")}</th>
                        <th scope="col">{t("social.responses")}</th>
                        <th scope="col">{t("social.percentage")}</th>
                        <th scope="col">
                          <span className={styles.srOnly}>{t("social.distribution")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {question.tallies.map((tally) => (
                        <tr key={tally.code}>
                          <th scope="row">{tally.label}</th>
                          <td>{fmt.count(tally.count)}</td>
                          <td>
                            {tally.share === null ? t("common.missing") : fmt.percent(tally.share)}
                          </td>
                          <td className={styles.barCell}>
                            <div className={styles.barTrack}>
                              <div
                                className={styles.barFill}
                                style={{ width: `${Math.round((tally.share ?? 0) * 100)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}
