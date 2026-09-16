import { processSyncCommands } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { syncPushRequestSchema } from "@eia/field-sync-contract";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/sync` — the device hands over what it captured.
 *
 * The body is parsed by the shared contract schema, so a command shape the server does not
 * understand is rejected at the door rather than half-applied. The session decides who the
 * technician is; the body decides nothing about identity.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = syncPushRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", message: "El formato de las órdenes no es válido." },
      { status: 400 },
    );
  }

  const auth = await authorizeMobileRequest(
    request,
    parsed.data.tenantSlug,
    parsed.data.projectSlug,
  );
  if (auth.kind === "unauthenticated") return UNAUTHENTICATED;
  if (auth.kind === "denied") return DENIED;

  try {
    const response = await processSyncCommands(getDb(), auth.ctx, parsed.data.commands);
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
