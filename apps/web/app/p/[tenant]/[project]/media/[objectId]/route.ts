import { resolvePublicEditorialAsset } from "@eia/application";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";

/**
 * A published attachment, fetched by somebody with no session.
 *
 * The authorisation is the row written beside the words at publication: this object is reachable
 * because the **currently visible** publication of **this** page names it. Not because it is in
 * the editorial namespace, and not because its id was guessed — an id from another page, another
 * project or a withdrawn version resolves to nothing.
 *
 * The bucket itself stays closed. What is returned is a 303 to a short presigned GET, the same
 * mechanism `Descargar original` uses internally (ADR-034), so the file is served by the provider
 * and never proxied through this process.
 *
 * `no-store` on the redirect, deliberately: the link it points at expires in minutes, and a cached
 * 303 would hand somebody a dead URL after a withdrawal rather than a 404. What this cannot do is
 * reach a copy already downloaded, and the surface says so rather than implying otherwise.
 */
export const dynamic = "force-dynamic";

const TTL_SECONDS = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; project: string; objectId: string }> },
) {
  const { tenant, project, objectId } = await params;
  const asset = await resolvePublicEditorialAsset(getDb(), {
    tenantSlug: tenant,
    projectSlug: project,
    storedObjectId: objectId,
  });
  // Not authorised, withdrawn, and never existed are one answer.
  if (asset === null) return new NextResponse(null, { status: 404 });

  const storage = getStorage();
  if (storage === null) return new NextResponse(null, { status: 404 });

  const link = await storage.presignDownload(
    asset.objectKey,
    TTL_SECONDS,
    asset.filename ?? undefined,
  );
  return NextResponse.redirect(link.url, {
    status: 303,
    headers: { "cache-control": "no-store" },
  });
}
