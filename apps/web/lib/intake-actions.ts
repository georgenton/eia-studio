"use server";

import { activateProject, updateProjectIntake } from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { storageReadiness } from "@/lib/storage";
import { getTranslator } from "@/lib/locale";
import { resolveSurfaceAccess } from "@/lib/surface-access";

export type IntakeActionResult =
  { ok: true; message: string } | { ok: false; error: string; blocked?: ReadonlyArray<string> };

const scope = z.object({ tenant: z.string(), project: z.string() });

/**
 * Save the project's own identity and its settings.
 *
 * Thin, like every server action here: validate, resolve the context, call the use-case. The
 * permission check is the use-case's (`project.intake.write`) — this layer never decides who may
 * do anything, it only refuses to call with a context it could not build.
 */
export async function saveProjectIntakeAction(raw: unknown): Promise<IntakeActionResult> {
  const input = scope
    .extend({
      name: z.string(),
      officialTitle: z.string().nullable(),
      programmeReference: z.string().nullable(),
      locationLabel: z.string().nullable(),
      offlineMode: z.string(),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "intake");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    await updateProjectIntake(getDb(), access.ctx, {
      name: input.name,
      officialTitle: input.officialTitle,
      programmeReference: input.programmeReference,
      locationLabel: input.locationLabel,
      offlineMode: input.offlineMode,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return { ok: true, message: t("intake.saved") };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: t("actions.checkPayload") };
    throw error;
  }
}

/**
 * Move the project out of planning.
 *
 * The readiness report is recomputed inside the use-case, so the decision rests on the server's
 * picture of the project rather than on whatever the browser last rendered.
 */
export async function activateProjectAction(raw: unknown): Promise<IntakeActionResult> {
  const input = scope.strict().parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "intake");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const result = await activateProject(getDb(), access.ctx, storageReadiness());
    if (result.blocked.length > 0) {
      return { ok: false, error: t("intake.activationBlocked"), blocked: result.blocked };
    }
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return {
      ok: true,
      message: result.lifecycle === "field" ? t("intake.activated") : t("intake.alreadyActive"),
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}
