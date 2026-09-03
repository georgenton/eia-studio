import type { SocialTabulation } from "@eia/application";
import { DENOMINATOR_COPY } from "@eia/domain";
import { formatCount, formatPercent, Panel, PanelBody, PanelHeader } from "@eia/ui";

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
export function TabulationPanel({ tabulation }: { tabulation: SocialTabulation }) {
  if (tabulation.questions.length === 0) {
    return (
      <Panel>
        <PanelHeader label="Tabulación de preguntas cerradas" />
        <PanelBody>
          <p className={styles.note} data-system-state="no-survey-data">
            Esta versión del cuestionario no tiene preguntas cerradas tabulables.
          </p>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        label="Tabulación de preguntas cerradas"
        action={
          <span className={styles.deterministic}>
            Cálculo determinista · sin modelo de lenguaje
          </span>
        }
      />
      <PanelBody>
        <p className={styles.note}>
          {tabulation.templateName} · versión <strong>{tabulation.versionLabel}</strong> ·{" "}
          {formatCount(tabulation.submitted)} respuestas enviadas. Las versiones no se suman entre
          sí: una respuesta solo se interpreta contra el cuestionario que se le hizo.
        </p>

        <div className={styles.questions}>
          {tabulation.questions.map((question) => {
            const copy = DENOMINATOR_COPY[question.denominatorRule];
            return (
              <section key={question.questionId} className={styles.question}>
                <h3 className={styles.questionPrompt}>{question.prompt}</h3>
                <p className={styles.denominator}>
                  {formatCount(question.answered)} respondieron · {formatCount(question.unanswered)}{" "}
                  sin responder · porcentajes {copy.label}
                </p>
                <p className={styles.denominatorHelp}>{copy.help}</p>

                {question.numeric ? (
                  <dl className={styles.numeric}>
                    <div>
                      <dt>Mínimo</dt>
                      <dd>{question.numeric.min}</dd>
                    </div>
                    <div>
                      <dt>Mediana</dt>
                      <dd>{question.numeric.median}</dd>
                    </div>
                    <div>
                      <dt>Promedio</dt>
                      <dd>{question.numeric.mean.toFixed(1).replace(".", ",")}</dd>
                    </div>
                    <div>
                      <dt>Máximo</dt>
                      <dd>{question.numeric.max}</dd>
                    </div>
                  </dl>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Opción</th>
                        <th scope="col">Respuestas</th>
                        <th scope="col">Porcentaje</th>
                        <th scope="col">
                          <span className={styles.srOnly}>Distribución</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {question.tallies.map((tally) => (
                        <tr key={tally.code}>
                          <th scope="row">{tally.label}</th>
                          <td>{formatCount(tally.count)}</td>
                          <td>{tally.share === null ? "—" : formatPercent(tally.share)}</td>
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
