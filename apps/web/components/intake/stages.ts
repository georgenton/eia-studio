import type { MessageKey } from "@eia/i18n";

/**
 * The eight stages, as data both halves can read.
 *
 * Deliberately its own module: the page resolves the stage from the URL on the **server**, and the
 * component renders it in the **client**. A `"use client"` file exports components, not functions
 * a server component may call, so the shared part lives here where neither side owns it.
 */
export const INTAKE_STAGES = [
  { key: "project", label: "intake.stageProject" },
  { key: "team", label: "intake.stageTeam" },
  { key: "gis", label: "intake.stageGis" },
  { key: "documents", label: "intake.stageDocuments" },
  { key: "surveys", label: "intake.stageSurveys" },
  { key: "templates", label: "intake.stageTemplates" },
  { key: "readiness", label: "intake.stageReadiness" },
  { key: "activation", label: "intake.stageActivation" },
] as const satisfies ReadonlyArray<{ key: string; label: MessageKey }>;

export type IntakeStage = (typeof INTAKE_STAGES)[number]["key"];

export function isIntakeStage(value: string | undefined): value is IntakeStage {
  return INTAKE_STAGES.some((stage) => stage.key === value);
}
