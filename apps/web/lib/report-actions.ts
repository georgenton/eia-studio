"use server";

import {
  createNarrativeGenerator,
  generateSocialChapter,
  loadSocialVersions,
} from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Generating one version of the social chapter.
 *
 * The survey version is resolved **server-side** from the project's own submitted responses, not
 * accepted from the client: a browser that could name the version could produce a chapter about a
 * different questionnaire than the one it says it is about.
 *
 * The narrative generator likewise comes from server configuration, and is constructed only when
 * the resolved availability says one may run (IG4-001). When it may not, the version is still
 * produced — the snapshot is the deliverable (ADR-022).
 */
export type ReportActionResult =
  | { readonly ok: true; readonly message: string; readonly versionLabel: string }
  | { readonly ok: false; readonly error: string };

export async function generateChapterAction(raw: unknown): Promise<ReportActionResult> {
  const input = z
    .object({ tenant: z.string().min(1).max(80), project: z.string().min(1).max(80) })
    .strict()
    .parse(raw);

  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: "No tienes acceso a esta superficie." };

  const env = getEnv();
  try {
    const versions = await loadSocialVersions(getDb(), access.ctx);
    const withResponses = versions.filter((option) => option.submitted > 0);
    const chosen = withResponses[0];
    if (!chosen) {
      return {
        ok: false,
        error:
          "No hay respuestas enviadas que reportar. El capítulo se construye sobre fichas " +
          "enviadas; los borradores de campo no participan en ninguna cifra.",
      };
    }

    const result = await generateSocialChapter(
      getDb(),
      access.ctx,
      { surveyVersionId: chosen.versionId },
      {
        narrative: env.assistant,
        ...(env.assistant.state === "AVAILABLE"
          ? { create: () => createNarrativeGenerator(env.assistant) }
          : {}),
      },
    );
    revalidatePath(`/t/${input.tenant}/p/${input.project}/reports`, "layout");
    return {
      ok: true,
      versionLabel: result.versionLabel,
      message: result.unchangedFromPrevious
        ? `Versión ${result.versionLabel} generada. Los datos no han cambiado desde la versión anterior: el contenido es idéntico.`
        : `Versión ${result.versionLabel} generada a partir de los datos validados actuales.`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Revisa los datos enviados." };
    throw error;
  }
}
