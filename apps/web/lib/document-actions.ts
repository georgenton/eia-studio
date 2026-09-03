"use server";

import { askDocuments, createAssistantGenerator, type AssistantResponse } from "@eia/application";
import { DomainError } from "@eia/domain";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * The document assistant's server action.
 *
 * Like every other action in this app it rebuilds the `RequestContext` from the session and the URL
 * and re-runs its own capability and permission checks. Two things are not taken from the client:
 * the **scope**, which comes from the verified context and is what makes cross-project retrieval
 * impossible; and the **generator**, which comes from server configuration — a browser that could
 * name the model could make an answer record a fiction.
 *
 * The generator is constructed only when the resolved availability says one may run (IG4-001). When
 * it may not, the use-case still answers: retrieval and citations do not depend on a model.
 */
export type AskResult =
  | { readonly ok: true; readonly answer: AssistantResponse }
  | { readonly ok: false; readonly error: string };

export async function askDocumentsAction(raw: unknown): Promise<AskResult> {
  const input = z
    .object({
      tenant: z.string().min(1).max(80),
      project: z.string().min(1).max(80),
      question: z.string().min(3).max(500),
    })
    .strict()
    .parse(raw);

  const access = await resolveSurfaceAccess(input.tenant, input.project, "documents");
  if (access.kind !== "ok") return { ok: false, error: "No tienes acceso a esta superficie." };

  const env = getEnv();
  try {
    const answer = await askDocuments(
      getDb(),
      access.ctx,
      { question: input.question },
      {
        generator: env.assistant,
        ...(env.assistant.state === "AVAILABLE"
          ? { create: () => createAssistantGenerator(env.assistant) }
          : {}),
      },
    );
    return { ok: true, answer };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Revisa la pregunta enviada." };
    throw error;
  }
}
