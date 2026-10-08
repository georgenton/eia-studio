import { finalizeUpload, resolveFinalizedUpload } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import {
  evidenceFinalizeRequestSchema,
  type EvidenceFinalizeResponse,
} from "@eia/field-sync-contract";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/v4/evidence/finalize` — prove the upload happened.
 *
 * **Idempotent**, unlike the use-case underneath it: a device whose response was lost in the air
 * cannot tell "already finalized" from "failed", so asking twice answers the same thing twice.
 * What is not idempotent is the consumption of the authorisation, which happens exactly once.
 *
 * This matters more here than it does for field media, because of the order the delivery flow
 * requires: the local file is released only when the **command** is acknowledged, never when the
 * upload finishes. A device that finalized and then lost the response must be able to ask again
 * and carry on to the command rather than re-uploading or, worse, dropping the photograph.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = evidenceFinalizeRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const auth = await authorizeMobileRequest(
    request,
    parsed.data.tenantSlug,
    parsed.data.projectSlug,
  );
  if (auth.kind === "unauthenticated") return UNAUTHENTICATED;
  if (auth.kind === "denied") return DENIED;

  const storage = getStorage();
  if (!storage) {
    return NextResponse.json(
      {
        error: "storage_unavailable",
        message: "Este entorno no puede guardar fotografías. Se conservan en el dispositivo.",
      },
      { status: 503 },
    );
  }

  const already = await resolveFinalizedUpload(getDb(), auth.ctx, parsed.data.intentId);
  if (already) {
    const response: EvidenceFinalizeResponse = {
      storedObjectId: already.storedObjectId,
      sizeBytes: already.sizeBytes,
    };
    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  }

  try {
    const stored = await finalizeUpload(getDb(), auth.ctx, storage, {
      intentId: parsed.data.intentId,
      objectKey: parsed.data.objectKey,
    });
    const response: EvidenceFinalizeResponse = {
      storedObjectId: stored.storedObjectId,
      sizeBytes: stored.sizeBytes,
    };
    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof FeatureDisabled || error instanceof NotFound) return DENIED;
    if (error instanceof PermissionDenied) return DENIED;
    if (error instanceof DomainError) {
      // A refusal the device must act on rather than retry: the bytes are not what was declared,
      // the authorisation expired, or the object is not there. It keeps the local file.
      return NextResponse.json({ error: "refused", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
