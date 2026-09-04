import type { ReportSnapshot } from "@eia/domain";

/**
 * The chapter as a .docx, rendered from the snapshot.
 *
 * ## Why a library and not a template engine
 *
 * `docx` is pure TypeScript with no native dependency and no external process — the constraint that
 * ruled out driving LibreOffice, which would put a headless office suite in the request path and
 * make the deliverable depend on a binary nobody pinned. Everything here is a document object.
 *
 * ## What the document says about itself
 *
 * **BORRADOR** on the first page and in every footer, beside the version label. It is not an
 * approved deliverable, approval is a workflow this slice does not build (TD-060), and a Word file
 * detached from the product has to carry that on its face rather than in a screen the reader left
 * behind. The regimes are on the first page for the same reason: a chapter built partly on
 * simulated data says so where it cannot be missed.
 *
 * Styling is institutional and restrained on purpose. A generated draft that looks like a finished
 * report invites being circulated as one.
 */
export interface RenderedDocx {
  readonly fileName: string;
  readonly buffer: Buffer;
}

const REGIME_LABEL: Record<string, string> = {
  HISTORICAL_OBSERVED: "Dato histórico observado",
  LIVE_OPERATIONAL: "Operación en curso",
  DEMO_SIMULATION: "Simulación de demostración",
};

const SOURCE_LABEL: Record<string, string> = {
  metric: "Cálculo determinista",
  human_review: "Codificación validada por especialista",
  quality_finding: "Hallazgo de calidad",
  document_chunk: "Pasaje citado del expediente",
  provenance: "Registro de procedencia",
};

/** One line naming where a fact came from, in the reader's language. */
function sourceLine(source: ReportSnapshot["sections"][number]["facts"][number]["source"]): string {
  const label = SOURCE_LABEL[source.kind] ?? source.kind;
  switch (source.kind) {
    case "metric":
      return `${label} · ${source.metric} — ${source.method}`;
    case "human_review":
      return `${label} · ${source.reviews} codificación(es) validada(s), taxonomía ${source.taxonomyVersionLabel}`;
    case "quality_finding":
      return `${label} · ${source.findingCode} (${source.state})`;
    case "document_chunk":
      return `${label} · ${source.documentCode} ${source.versionLabel}${source.page === null ? "" : ` · p. ${source.page}`}`;
    case "provenance":
      return `${label} · ${REGIME_LABEL[source.facets.regime] ?? source.facets.regime} · ${source.facets.transformations.join(" → ")}`;
  }
}

export async function renderChapterDocx(input: {
  readonly snapshot: ReportSnapshot;
  readonly versionLabel: string;
  readonly narratives: ReadonlyMap<string, string>;
  readonly generatedAt: Date;
}): Promise<RenderedDocx> {
  // Dynamic import so `@eia/application` loads — in tests, in the seeder, in the worker — without
  // pulling in the document library for callers that never render one.
  const { AlignmentType, Document, Footer, HeadingLevel, Packer, Paragraph, TextRun } =
    await import("docx");

  const when = new Intl.DateTimeFormat("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(input.generatedAt);

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: "BORRADOR — NO ES UN ENTREGABLE APROBADO", bold: true, size: 22 }),
      ],
    }),
    new Paragraph({ text: "Capítulo social", heading: HeadingLevel.TITLE }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: input.snapshot.projectName, size: 24 }),
        new TextRun({
          break: 1,
          text: `Versión ${input.versionLabel} · generado el ${when}`,
          size: 20,
        }),
        new TextRun({
          break: 1,
          text: `Cuestionario ${input.snapshot.surveyVersionLabel}`,
          size: 20,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: "Regímenes de los datos: ", bold: true, size: 20 }),
        new TextRun({
          text: input.snapshot.regimes.map((r) => REGIME_LABEL[r] ?? r).join(" · "),
          size: 20,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 320 },
      children: [
        new TextRun({
          text:
            "Este documento se generó a partir de datos validados del proyecto: tabulación " +
            "determinista sobre fichas enviadas, codificaciones validadas por especialista, " +
            "hallazgos de calidad con la decisión que un revisor tomó, y documentos del " +
            "expediente citados por versión. Cada cifra indica su origen. Ninguna afirmación de " +
            "este borrador constituye una conclusión de cumplimiento normativo.",
          size: 18,
          italics: true,
        }),
      ],
    }),
  ];

  for (const section of input.snapshot.sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: section.summary, size: 19, italics: true })],
      }),
    );

    const narrative = input.narratives.get(section.key);
    if (narrative) {
      children.push(new Paragraph({ spacing: { after: 160 }, text: narrative }));
    }

    for (const fact of section.facts) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: `${fact.label}: `, bold: true, size: 20 }),
            new TextRun({ text: fact.value, size: 20 }),
          ],
        }),
      );
      if (fact.basis) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            indent: { left: 360 },
            children: [new TextRun({ text: fact.basis, size: 17 })],
          }),
        );
      }
      children.push(
        new Paragraph({
          spacing: { after: 140 },
          indent: { left: 360 },
          children: [new TextRun({ text: sourceLine(fact.source), size: 16, color: "6B747C" })],
        }),
      );
    }
  }

  const document = new Document({
    creator: "EIA Studio",
    title: `Capítulo social · ${input.snapshot.projectName} · ${input.versionLabel}`,
    description: "Borrador generado a partir de datos validados. No es un entregable aprobado.",
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21 }, paragraph: { spacing: { line: 276 } } },
      },
    },
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `BORRADOR · ${input.snapshot.projectName} · versión ${input.versionLabel}`,
                    size: 16,
                    color: "6B747C",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  const slug = input.snapshot.projectName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return {
    fileName: `capitulo-social-${slug}-${input.versionLabel}-borrador.docx`,
    buffer: Buffer.from(buffer),
  };
}
