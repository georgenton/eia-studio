"use server";

import { publishClientPublication } from "@eia/application";
import { can, DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getTranslator } from "@/lib/locale";
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

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  if (!can(access.ctx, "portal.publish")) {
    return { ok: false, error: t("actions.portalPublishDenied") };
  }

  try {
    const result = await publishClientPublication(getDb(), access.ctx);
    revalidatePath(`/t/${input.tenant}/p/${input.project}/portal`, "layout");
    revalidatePath(`/portal/${input.tenant}/${input.project}`, "layout");
    return {
      ok: true,
      versionLabel: result.versionLabel,
      message: t(
        result.unchangedFromPrevious
          ? "actions.portalPublishedUnchanged"
          : "actions.portalPublished",
        { version: result.versionLabel },
      ),
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: t("actions.checkPayload") };
    throw error;
  }
}
