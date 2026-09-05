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

/** «3 programas · 11 medidas», which is what the plan actually contains. */
function planNote(plan: PgasPlanView["plans"][number]): string {
  const programmes = new Set(plan.measures.map((m) => m.programmeTitle ?? "—")).size;
  const measures = plan.measures.length;
  return `${programmes} programa(s) · ${measures} medida(s)`;
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
            note={planNote(plan)}
          />
          <PanelBody>
            {plan.objective ? <p className={styles.objective}>{plan.objective}</p> : null}
            {plan.place ? <p className={styles.place}>{plan.place}</p> : null}
            <Completeness plan={plan} />

            {/*
              The document's own second level. A programme is a banner row with a title and nothing
              else (ADR-024), and reading the plan without it turns eleven measures about different
              subjects into one undifferentiated list.
            */}
            {groupByProgramme(plan.measures).map((group) => (
              <section className={styles.programme} key={group.title ?? "sin-programa"}>
                <h3 className={styles.programmeTitle}>
                  {group.title ?? "Medidas sin programa declarado"}
                </h3>
                <ol className={styles.measures}>
                  {group.measures.map((m) => (
                    <li className={styles.measure} key={m.measureCode}>
                      <p className={styles.measureText}>{m.measure || "—"}</p>
                      <dl className={styles.fields}>
                        <Field label="Aspecto ambiental" value={m.aspect} />
                        <Field label="Impacto identificado" value={m.impact} />
                        <Field label="Indicador" value={m.indicator} />
                        <Field label="Medio de verificación" value={m.verification} />
                        <Field label="Responsable" value={m.responsible} />
                        <Field label="Frecuencia" value={m.frequency} />
                        <Field label="Plazo" value={m.deadline} />
                      </dl>
                      <p className={styles.measureIds}>
                        <span>
                          N° del documento: <strong>{m.statedNumber || "—"}</strong>
                        </span>
                        <span className={styles.code}>Código EIA Studio: {m.measureCode}</span>
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
              <summary>Cómo nombra este plan sus columnas</summary>
              <p>
                Los rótulos de arriba están normalizados para poder leer el plan. El capítulo, en
                este plan, escribe: {plan.columns.map((c) => `«${c}»`).join(" · ")}. Se conserva tal
                cual en el dato almacenado.
              </p>
            </details>
          </PanelBody>
        </Panel>
      ))}

      <p className={styles.footnote}>
        El «N° del documento» reproduce la numeración del capítulo, incluidas las repeticiones. El
        «Código EIA Studio» lo genera este producto para poder referenciar una medida; no es una
        referencia de la consultora.
      </p>
    </div>
  );
}
