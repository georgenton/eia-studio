/** Spanish labels of the project lifecycle chip (design v0.2: `EN CAMPO`). */
export const LIFECYCLE_LABEL: Readonly<Record<string, string>> = {
  planning: "En planificación",
  field: "En campo",
  analysis: "En análisis",
  review: "En revisión",
  delivered: "Entregado",
  closed: "Cerrado",
};

export function lifecycleLabel(value: string): string {
  return LIFECYCLE_LABEL[value] ?? value;
}
