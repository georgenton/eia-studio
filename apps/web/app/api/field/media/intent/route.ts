import { createUploadIntent } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { mediaIntentRequestSchema, type MediaIntentResponse } from "@eia/field-sync-contract";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/media/intent` — the device asks where to put a photograph.
 *
 * It does not say where. The key is minted here from the tenant, the project, the `field-media`
 * namespace and a UUID this product generates (ADR-031 §2), because a client that can name a key
 * can name another tenant's. The device receives a signed URL and nothing it could have guessed.
 *
 * The permission is `media.upload`, which is the technician's — `createUploadIntent` decides that
 * from the namespace, so this route grants nothing on its own.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = mediaIntentRequestSchema.safeParse(body);
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
    // Not an outage and not this technician's problem: file storage is not configured in this
    // deployment (ADR-031 §5). The device keeps the photograph and says so on screen.
    return NextResponse.json(
      {
        error: "storage_unavailable",
        message: "Este entorno no puede guardar fotografías. Se conservan en el dispositivo.",
      },
      { status: 503 },
    );
  }

  try {
    const intent = await createUploadIntent(getDb(), auth.ctx, storage, {
      namespace: "field-media",
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    const response: MediaIntentResponse = {
      intentId: intent.intentId,
      url: intent.url,
      method: "PUT",
      headers: { ...intent.headers },
      objectKey: intent.key,
      expiresAt: intent.expiresAt.toISOString(),
      maxBytes: intent.maxBytes,
    };
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
