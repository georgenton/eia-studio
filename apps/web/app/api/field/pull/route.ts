import { pullFieldChanges } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/pull` — what changed for this technician.
 *
 * The device sends the assignment ids it holds so the server can name the ones that are no longer
 * the caller's. It is not an audit of the device: the list is used to compute a difference and is
 * never stored.
 */
const requestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    cursor: z.string().min(1).max(200).nullable(),
    knownAssignmentIds: z.array(z.string().uuid()).max(500),
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
    const response = await pullFieldChanges(getDb(), auth.ctx, {
      knownAssignmentIds: parsed.data.knownAssignmentIds,
      sessionExpiresAt: auth.sessionExpiresAt,
    });
    if (!response) {
      return NextResponse.json(
        { error: "no_active_campaign", message: "No hay una campaña en campo ahora mismo." },
        { status: 409 },
      );
    }
    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof FeatureDisabled || error instanceof NotFound) return DENIED;
    if (error instanceof PermissionDenied) return DENIED;
    if (error instanceof DomainError) {
      return NextResponse.json({ error: "refused", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
