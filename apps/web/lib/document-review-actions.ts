"use server";

import { decideDocumentReviewCandidate, startDocumentReviewRun } from "@eia/application";
import {
  DomainError,
  REVIEW_CANDIDATE_DECISIONS,
  REVIEW_LENS_KEYS,
  ReviewCorpusRefused,
} from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getTranslator } from "@/lib/locale";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Starting an AI review, and settling one of its candidates (ADR-035).
 *
 * Thin, as every action here is. The permission, the privacy gate, the availability rule, the
 * lens's bounds and the two-sided rule all belong to `@eia/application` and `@eia/domain`, which
 * the worker calls with the same guarantees. This file resolves a context and translates an error.
 *
 * The one thing it does that matters on screen: a `ReviewCorpusRefused` is turned into the list of
 * **documents that blocked the run**, so the reader is told which file to look at rather than that
 * "something was not allowed".
 */

const scope = z.object({ tenant: z.string(), project: z.string() });

export type StartReviewResult =
  | { ok: true; runId: string; sourceCount: number }
  | { ok: false; error: string; blocked?: ReadonlyArray<{ code: string; reason: string }> };

export async function startDocumentReviewAction(raw: unknown): Promise<StartReviewResult> {
  const input = scope
    .extend({
      lens: z.enum(REVIEW_LENS_KEYS as unknown as [string, ...string[]]),
      documentIds: z.array(z.uuid()).min(1).max(200),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "documents");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const started = await startDocumentReviewRun(getDb(), access.ctx, getEnv().reviewer, {
      lens: input.lens as (typeof REVIEW_LENS_KEYS)[number],
      documentIds: input.documentIds,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/documents/review`);
    return { ok: true, runId: started.runId, sourceCount: started.sourceCount };
  } catch (error) {
    if (error instanceof ReviewCorpusRefused) {
      return {
        ok: false,
        error: t("documents.review.refusedLead"),
        blocked: error.blocked.map((item) => ({ code: item.documentCode, reason: item.reason })),
      };
    }
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export type DecideCandidateResult = { ok: true; state: string } | { ok: false; error: string };

export async function decideCandidateAction(raw: unknown): Promise<DecideCandidateResult> {
  const input = scope
    .extend({
      candidateId: z.uuid(),
      decision: z.enum(REVIEW_CANDIDATE_DECISIONS as unknown as [string, ...string[]]),
      justification: z.string(),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "documents");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const decided = await decideDocumentReviewCandidate(getDb(), access.ctx, input.candidateId, {
      decision: input.decision as (typeof REVIEW_CANDIDATE_DECISIONS)[number],
      justification: input.justification,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/documents/review`);
    return { ok: true, state: decided.toState };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}
