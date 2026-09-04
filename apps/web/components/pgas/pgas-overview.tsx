import type { PgasPlanView } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";

import { ProvenanceLink } from "@/components/navigation/nav";

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
const FIELD_LABEL: Record<string, string> = {
  indicator: "indicador",
  verification: "medio de verificación",
  responsible: "responsable",
  frequency: "frecuencia",
  deadline: "plazo",
};

function Completeness({ plan }: { plan: PgasPlanView["plans"][number] }) {
  const gaps = Object.entries(plan.completeness.missing).filter(([, count]) => count > 0);
  if (gaps.length === 0) {
    return (
      <p className={styles.complete}>
        Las {plan.completeness.measures} medidas declaran indicador, medio de verificación,
        responsable, frecuencia y plazo.
      </p>
    );
  }
  return (
    <ul className={styles.gaps}>
      {gaps.map(([field, count]) => (
        <li key={field}>
          {count} de {plan.completeness.measures} medidas no indican {FIELD_LABEL[field] ?? field}
        </li>
      ))}
    </ul>
  );
}

export function PgasOverview({ view }: { view: PgasPlanView }) {
  if (!view.imported) {
    return (
      <Panel>
        <PanelHeader label="Plan de Manejo Ambiental y Social" />
        <PanelBody>
          <p className={styles.note} data-system-state="empty">
            Este proyecto todavía no tiene cargado el capítulo del plan de manejo. Cuando se cargue,
            aquí aparecen sus planes, programas y medidas tal como los redactó la consultora.
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
          label="Plan de Manejo Ambiental y Social"
          note={`${view.plans.length} planes · ${measures} medidas`}
        />
        <PanelBody>
          <p className={styles.intro}>
            Este es el plan que <strong>propone</strong> el estudio, leído del capítulo que entregó
            la consultora. EIA Studio no registra aquí su ejecución ni su cumplimiento: muestra qué
            medidas contiene, qué declara cada una y qué deja en blanco.
          </p>
          <p className={styles.source}>
            Fuente: {view.imported.file} · {view.imported.measures} medidas en {view.imported.plans}{" "}
            planes ·{" "}
            <ProvenanceLink href={`?prov=${view.imported.provenanceId}`}>
              Ver origen del dato
            </ProvenanceLink>
          </p>

          {withoutCode.length > 0 ? (
            <p className={styles.observation}>
              {withoutCode.length === 1
                ? "Un plan del capítulo no trae código: "
                : `${withoutCode.length} planes del capítulo no traen código: `}
              {withoutCode.map((p) => p.title).join(" · ")}
            </p>
          ) : null}

          {view.headingVariants.length > 0 ? (
            <p className={styles.observation}>
              El capítulo nombra {view.headingVariants.length} columna(s) de más de una forma:{" "}
              {view.headingVariants
                .map((v) => v.spellings.map((s) => `«${s}»`).join(" / "))
                .join(" · ")}
              . Se conservan tal como aparecen en el documento.
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      {view.plans.map((plan) => (
        <Panel key={`${plan.code ?? plan.title}`}>
          <PanelHeader
            label={plan.code ? `${plan.code} · ${plan.title}` : plan.title}
            note={`${plan.measures.length} medida(s)`}
          />
          <PanelBody>
            {plan.objective ? <p className={styles.objective}>{plan.objective}</p> : null}
            {plan.place ? <p className={styles.place}>{plan.place}</p> : null}
            <Completeness plan={plan} />

            <table className={styles.table}>
              <caption className="sr-only">
                Medidas de {plan.title}, con su aspecto, impacto, indicador y responsable
              </caption>
              <thead>
                <tr>
                  <th scope="col">N° del documento</th>
                  <th scope="col">Código EIA Studio</th>
                  <th scope="col">Aspecto</th>
                  <th scope="col">Impacto</th>
                  <th scope="col">Medida</th>
                  <th scope="col">Indicador</th>
                  <th scope="col">Verificación</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Frecuencia</th>
                  <th scope="col">Plazo</th>
                </tr>
              </thead>
              <tbody>
                {plan.measures.map((m) => (
                  <tr key={m.measureCode}>
                    <td className={styles.stated}>{m.statedNumber || "—"}</td>
                    <td className={styles.code}>{m.measureCode}</td>
                    <td>{m.aspect || "—"}</td>
                    <td>{m.impact || "—"}</td>
                    <td className={styles.measure}>{m.measure || "—"}</td>
                    <td>{m.indicator || "—"}</td>
                    <td>{m.verification || "—"}</td>
                    <td>{m.responsible || "—"}</td>
                    <td>{m.frequency || "—"}</td>
                    <td>{m.deadline || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelBody>
        </Panel>
      ))}

      <p className={styles.footnote}>
        La columna «N° del documento» reproduce la numeración del capítulo, incluidas las
        repeticiones. El «Código EIA Studio» lo genera este producto para poder referenciar una
        medida; no es una referencia de la consultora.
      </p>
    </div>
  );
}
