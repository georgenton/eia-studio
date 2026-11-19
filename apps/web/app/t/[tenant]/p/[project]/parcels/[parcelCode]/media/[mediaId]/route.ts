import { issueFieldMediaDownload } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { resolveSurfaceAccess } from "@/lib/surface-access";

export const dynamic = "force-dynamic";

/**
 * `GET …/parcels/:parcelCode/media/:mediaId` — open one photograph of a visit.
 *
 * A download is a navigation (ADR-034): a route and a 303, rather than a server action that hands
 * the signed URL to the page. The link is a bearer credential for five minutes, and redirecting
 * means the browser follows it once instead of the document holding it.
 *
 * Everything that decides is underneath. `issueFieldMediaDownload` requires `field.surveys` and
 * `field.responses.read`, reads the row **inside the caller's own RLS transaction** — so the
 * row-level policy of SECURITY.md §10b applies, and a technician reaches their own photograph
 * through it rather than through the permission — and audits the issuance. Every refusal is the
 * same 404 somebody following a link to a photograph that does not exist receives.
 *
 * `:parcelCode` is in the path because that is the page the reader came from, and it is
 * deliberately **not** used to resolve anything: the media id is already scoped to tenant and
 * project, and a second identifier the handler trusted would be a second thing to get wrong.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string; project: string; mediaId: string }> },
) {
  const { tenant, project, mediaId } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "gis");
  if (access.kind === "unauthenticated") {
    return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
  }
  if (access.kind !== "ok") return new NextResponse(null, { status: 404 });

  const storage = getStorage();
  // Not configured is not "missing": the photograph exists and this deployment cannot reach it
  // (ADR-031 §5). 503 says try later; 404 would say it is not there.
  if (!storage) return new NextResponse(null, { status: 503 });

  try {
    const link = await issueFieldMediaDownload(getDb(), access.ctx, storage, mediaId);
    return NextResponse.redirect(link.url, {
      status: 303,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof NotFound || error instanceof FeatureDisabled) {
      return new NextResponse(null, { status: 404 });
    }
    // A denial is a 404 too: a distinguishable answer would confirm the photograph exists, which
    // is what somebody editing identifiers wants to learn.
    if (error instanceof PermissionDenied) return new NextResponse(null, { status: 404 });
    if (error instanceof DomainError) return new NextResponse(null, { status: 404 });
    throw error;
  }
}
