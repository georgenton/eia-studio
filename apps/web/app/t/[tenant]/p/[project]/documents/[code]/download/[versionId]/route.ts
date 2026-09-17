import { issueDocumentDownload } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { resolveSurfaceAccess } from "@/lib/surface-access";

export const dynamic = "force-dynamic";

/**
 * `GET …/documents/:code/download/:versionId` — the original file.
 *
 * ## Why a route handler and a redirect, rather than a server action returning a URL
 *
 * A download is a navigation. A server action would have to hand the signed URL to the browser so
 * that JavaScript could follow it, which puts the link in the page, in the history, and in
 * whatever copies the page — for a link that is a bearer credential for five minutes. Redirecting
 * means the browser follows it once and the URL never becomes a value the document holds.
 *
 * ## What is checked here, and what is checked underneath
 *
 * This layer resolves the caller's context and nothing else. `issueDocumentDownload` requires
 * `core.documents` and `documents.read`, resolves the version **inside the caller's own RLS
 * transaction**, and audits the issuance. A caller from another tenant or project therefore gets
 * the same 404 as somebody following a link to a version that does not exist — which is the point
 * (ADR-016, ADR-034).
 *
 * `cache-control: no-store` because the response is a redirect to a credential.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string; project: string; versionId: string }> },
) {
  const { tenant, project, versionId } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "documents");
  if (access.kind === "unauthenticated") {
    return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
  }
  if (access.kind !== "ok") return new NextResponse(null, { status: 404 });

  const storage = getStorage();
  // Not configured is not "missing": the file exists and this deployment cannot reach it
  // (ADR-031 §5). 503 says try later; 404 would say the document is not there.
  if (!storage) return new NextResponse(null, { status: 503 });

  try {
    const link = await issueDocumentDownload(getDb(), access.ctx, storage, versionId);
    return NextResponse.redirect(link.url, {
      status: 303,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof NotFound || error instanceof FeatureDisabled) {
      return new NextResponse(null, { status: 404 });
    }
    // A denial is a 404 too. A distinguishable answer would confirm the version exists, which is
    // what somebody editing identifiers wants to learn.
    if (error instanceof PermissionDenied) return new NextResponse(null, { status: 404 });
    if (error instanceof DomainError) return new NextResponse(null, { status: 404 });
    throw error;
  }
}
