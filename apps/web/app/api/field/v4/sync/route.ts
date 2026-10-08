import { processWorkSyncCommands } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { v4SyncPushRequestSchema } from "@eia/field-sync-contract";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/v4/sync` — what the technician did, once connectivity returns.
 *
 * The five inherited commands mean exactly what they mean in v3 and go through the same engine;
 * `socialization.delivery.record` is the one addition. The envelope is validated loosely here
 * and strictly underneath — v3's own `.strict()` union for the five, the delivery command's own
 * schema for the sixth — so there is no second copy of five payload definitions to keep in step.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = v4SyncPushRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const auth = await authorizeMobileRequest(
    request,
    parsed.data.tenantSlug,
    parsed.data.projectSlug,
  );
  if (auth.kind === "unauthenticated") return UNAUTHENTICATED;
  if (auth.kind === "denied") return DENIED;

  try {
    const result = await processWorkSyncCommands(getDb(), auth.ctx, parsed.data.commands);
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
