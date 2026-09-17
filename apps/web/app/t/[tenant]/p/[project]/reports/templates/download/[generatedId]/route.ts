import { issueGeneratedDocumentDownload } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { resolveSurfaceAccess } from "@/lib/surface-access";

export const dynamic = "force-dynamic";

/**
 * A generated document's bytes, as a navigation (ADR-036, the shape ADR-034 established).
 *
 * The page holds a **route**, never a key: the route resolves the caller's context, mints a
 * five-minute presigned GET and redirects. A server action returning the URL would put a bearer
 * credential into the page and into whatever caches it.
 *
 * Everything that is not an authorised fetch of this project's own generated document answers
 * **404** — another project's document, one that does not exist, a caller without the permission.
 * A distinguishable error would confirm the row exists, which is what somebody editing ids wants
 * to learn (ADR-016).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; project: string; generatedId: string }> },
) {
  const { tenant, project, generatedId } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "reports");
  if (access.kind === "unauthenticated") {
    return NextResponse.redirect(new URL("/sign-in", process.env.PUBLIC_APP_URL), { status: 303 });
  }
  if (access.kind !== "ok") return new NextResponse(null, { status: 404 });

  const storage = getStorage();
  // Storage off is a state, not a missing file: saying 404 here would blame the reader for the
  // environment (ADR-031).
  if (!storage) return new NextResponse(null, { status: 503 });

  try {
    const link = await issueGeneratedDocumentDownload(getDb(), access.ctx, storage, generatedId);
    return NextResponse.redirect(link.url, {
      status: 303,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (
      error instanceof NotFound ||
      error instanceof FeatureDisabled ||
      error instanceof PermissionDenied ||
      error instanceof DomainError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}
