"use server";

import { createProject } from "@eia/application";
import { DomainError, SYSTEM_PROFILES } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getRequestContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getTranslator } from "@/lib/locale";

/**
 * Creating a project (Wave 3).
 *
 * `createProject` has existed since Slice 0 and nothing called it: a project could only be created
 * by a developer running a script. That is fine for one pilot and wrong for eight studies — the
 * point of ADR-030's intake is that a firm's own data staff prepare a project, and they cannot
 * prepare one that does not exist.
 *
 * So this is the first half of the product path: create the project from a system profile, then
 * prepare it in *Preparar proyecto*. The action is thin, as every action here is; the permission,
 * the slug rules, the profile snapshot and the audit line belong to the use-case.
 */
const createSchema = z
  .object({
    tenant: z.string(),
    slug: z.string(),
    name: z.string(),
    profileKey: z.string(),
  })
  .strict();

export type CreateProjectResult =
  { ok: true; slug: string; message: string } | { ok: false; error: string };

export async function createProjectAction(raw: unknown): Promise<CreateProjectResult> {
  const input = createSchema.parse(raw);
  const t = await getTranslator();

  const result = await getRequestContext(input.tenant);
  if (result.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  if (!SYSTEM_PROFILES.has(input.profileKey)) {
    return { ok: false, error: t("portfolio.newProjectUnknownProfile") };
  }

  try {
    await createProject(getDb(), result.ctx, {
      slug: input.slug,
      name: input.name,
      profileKey: input.profileKey,
    });
    revalidatePath(`/t/${input.tenant}`);
    return {
      ok: true,
      slug: input.slug,
      message: t("portfolio.newProjectCreated", { name: input.name }),
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}
