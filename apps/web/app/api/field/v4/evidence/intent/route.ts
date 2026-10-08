import { createUploadIntent } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { evidenceIntentRequestSchema, type EvidenceIntentResponse } from "@eia/field-sync-contract";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/v4/evidence/intent` — where to put a photograph of a delivery.
 *
 * The same three steps a field photograph takes (ADR-032) in a **different namespace**, and the
 * namespace is the whole reason this route exists rather than reusing `/api/field/media/intent`:
 * `socialization-evidence` is private evidence of a convocation, and a query written for a
 * visit's photographs must not be able to reach it — or the reverse.
 *
 * The device does not name the key. It is minted here from the tenant, the project, the
 * namespace and a UUID this product generated, because a client that can name a key can name
 * another tenant's (ADR-031 §2). The permission is `media.upload`, decided by
 * `createUploadIntent` from the namespace; this route grants nothing on its own.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = evidenceIntentRequestSchema.safeParse(body);
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
    // Not an outage and not this technician's problem (ADR-031 §5). The device keeps the
    // photograph, the attempt stays local, and the screen says so.
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
      namespace: "socialization-evidence",
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    const response: EvidenceIntentResponse = {
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
