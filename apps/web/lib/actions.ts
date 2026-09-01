"use server";

import { randomUUID } from "node:crypto";

import { DomainError, createProject, createTenant } from "@eia/domain";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getRequestContext, getSessionUser } from "./context";
import { getDb } from "./db";

export interface ActionState {
  readonly error: string | null;
}

/** Thin server action: validate → context → use-case (CLAUDE.md conventions). */
export async function createTenantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/sign-in");
  const input = z
    .object({ slug: z.string(), name: z.string() })
    .strict()
    .safeParse({ slug: formData.get("slug"), name: formData.get("name") });
  if (!input.success) return { error: "Datos inválidos" };
  let slug: string;
  try {
    await createTenant(
      getDb(),
      { userId: sessionUser.subject, requestId: randomUUID() },
      input.data,
    );
    slug = input.data.slug;
  } catch (error) {
    if (error instanceof DomainError) return { error: `${error.code}: ${error.message}` };
    throw error;
  }
  redirect(`/t/${slug}`);
}

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tenantSlug = String(formData.get("tenant") ?? "");
  const result = await getRequestContext(tenantSlug);
  if (result.kind === "unauthenticated") redirect("/sign-in");
  if (result.kind === "denied") return { error: "PERMISSION_DENIED" };
  const input = z
    .object({ slug: z.string(), name: z.string(), profileKey: z.string() })
    .strict()
    .safeParse({
      slug: formData.get("slug"),
      name: formData.get("name"),
      profileKey: formData.get("profileKey"),
    });
  if (!input.success) return { error: "Datos inválidos" };
  try {
    await createProject(getDb(), result.ctx, input.data);
  } catch (error) {
    if (error instanceof DomainError) return { error: `${error.code}: ${error.message}` };
    throw error;
  }
  redirect(`/t/${tenantSlug}/p/${input.data.slug}`);
}
