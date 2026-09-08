"use server";

import { publishClientPublication } from "@eia/application";
import { can, DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Publishing an update.
 *
 * The action takes the tenant and project slugs and nothing else. It does **not** accept the
 * payload the browser previewed: the use-case rebuilds the draft server-side, so a client that
 * could post a body cannot publish a sentence of its own in the consultancy's name.
 */
export type PortalActionResult =
  | { readonly ok: true; readonly message: string; readonly versionLabel: string }
  | { readonly ok: false; readonly error: string };

export async function publishPublicationAction(raw: unknown): Promise<PortalActionResult> {
  const input = z
    .object({ tenant: z.string().min(1).max(80), project: z.string().min(1).max(80) })
    .strict()
    .parse(raw);

  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: "No tienes acceso a esta superficie." };
  if (!can(access.ctx, "portal.publish")) {
    return {
      ok: false,
      error: "Tu rol permite revisar la publicación, pero no publicarla.",
    };
  }

  try {
    const result = await publishClientPublication(getDb(), access.ctx);
    revalidatePath(`/t/${input.tenant}/p/${input.project}/portal`, "layout");
    revalidatePath(`/portal/${input.tenant}/${input.project}`, "layout");
    return {
      ok: true,
      versionLabel: result.versionLabel,
      message: result.unchangedFromPrevious
        ? `Publicada la actualización ${result.versionLabel}. Dice exactamente lo mismo que la anterior: los datos publicables no han cambiado.`
        : `Publicada la actualización ${result.versionLabel}. Es lo que el cliente ve desde ahora.`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Revisa los datos enviados." };
    throw error;
  }
}
