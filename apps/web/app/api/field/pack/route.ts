import { buildFieldPack } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/pack` — the technician downloads their work.
 *
 * A POST rather than a GET because the request names the tenant and project in a body, and
 * because nothing about a Field Pack should be cacheable by anything between the device and here.
 */
const requestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
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
    const result = await buildFieldPack(getDb(), auth.ctx, {
      sessionExpiresAt: auth.sessionExpiresAt,
      technician: { email: auth.user.email, name: auth.user.name },
    });
    return NextResponse.json(result, {
      // A pack carries a validity window and the technician's own assignments; nothing may keep a
      // copy of it on the way past.
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    // A capability this project does not have, and a project the caller cannot see, answer the
    // same way: the surface does not confirm what exists.
    if (error instanceof FeatureDisabled || error instanceof NotFound) return DENIED;
    if (error instanceof PermissionDenied) return DENIED;
    if (error instanceof DomainError) {
      return NextResponse.json({ error: "refused", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
