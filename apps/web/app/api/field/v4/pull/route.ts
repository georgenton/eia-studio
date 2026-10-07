import { pullWorkChanges } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/v4/pull` — what changed that this device needs to know.
 *
 * The device sends what it currently holds, by id, and gets back the current set plus what is no
 * longer its own. A full bounded set rather than a change feed, for the reason v3 gives: this is
 * one person's work in one project, it is small, and reconciling against the truth cannot drift
 * the way replaying a log can.
 */
const requestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    knownAssignmentIds: z.array(z.uuid()).max(2000).default([]),
    knownInvitationIds: z.array(z.uuid()).max(2000).default([]),
  })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const auth = await authorizeMobileRequest(
    request,
    parsed.data.tenantSlug,
    parsed.data.projectSlug,
  );
  if (auth.kind === "unauthenticated") return UNAUTHENTICATED;
  if (auth.kind === "denied") return DENIED;

  try {
    const result = await pullWorkChanges(
      getDb(),
      auth.ctx,
      {
        knownAssignmentIds: parsed.data.knownAssignmentIds,
        knownInvitationIds: parsed.data.knownInvitationIds,
      },
      {
        sessionExpiresAt: auth.sessionExpiresAt,
        technician: { email: auth.user.email, name: auth.user.name },
      },
    );
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof FeatureDisabled || error instanceof NotFound) return DENIED;
    if (error instanceof PermissionDenied) return DENIED;
    if (error instanceof DomainError) {
      return NextResponse.json({ error: "refused", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
