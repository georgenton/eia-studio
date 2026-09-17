import { finalizeUpload, resolveFinalizedUpload } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { mediaFinalizeRequestSchema, type MediaFinalizeResponse } from "@eia/field-sync-contract";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/media/finalize` — the device says the bytes are there, and the server checks.
 *
 * What is verified is the provider's answer, not the device's: an object exists under the key we
 * issued, its size is within the ceiling the intent signed for, and its first bytes are a JPEG or
 * a PNG. The SHA-256 is computed from what was read back (ADR-031 §3–4).
 *
 * **This route is idempotent; the use-case under it is not.** Consuming an authorisation twice is
 * exactly what the intent's state machine prevents, and it stays prevented. But a phone whose
 * response was lost in a valley cannot tell "already finalized" from "failed", and it must be able
 * to carry on — so a second call asks a different question (`resolveFinalizedUpload`: what did the
 * first one write?) rather than repeating the first.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = mediaFinalizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", message: "El formato de la solicitud no es válido." },
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
    const response: MediaFinalizeResponse = {
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
    const response: MediaFinalizeResponse = {
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
