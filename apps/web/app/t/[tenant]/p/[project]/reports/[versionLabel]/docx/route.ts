import { loadReportVersion, renderChapterDocx } from "@eia/application";
import { can, DomainError } from "@eia/domain";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { resolveSurfaceAccess } from "@/lib/surface-access";

export const dynamic = "force-dynamic";

/**
 * The chapter as a .docx.
 *
 * A route handler rather than a client-side render, for the reason every download in this product
 * is: the file is produced from the stored snapshot on the server, after the same capability and
 * permission checks the page took. A browser that could assemble it would need the snapshot, and a
 * snapshot in a browser is a snapshot that can be edited before it is saved.
 *
 * The rendered document is not stored. It is a deterministic function of the version, so keeping a
 * copy would only create a second artefact that could drift from the one that is versioned.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; project: string; versionLabel: string }> },
) {
  const { tenant, project, versionLabel } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "reports");
  // 404 rather than a denial, like every other unreachable resource: a distinguishable error would
  // confirm the version exists, which is what somebody editing a URL wants to learn.
  if (access.kind !== "ok") return new NextResponse("Not found", { status: 404 });
  if (!can(access.ctx, "reports.write") || !can(access.ctx, "field.responses.read")) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const version = await loadReportVersion(getDb(), access.ctx, versionLabel);
    const rendered = await renderChapterDocx({
      snapshot: version.snapshot,
      versionLabel: version.versionLabel,
      narratives: version.narratives,
      generatedAt: new Date(version.generatedAt),
    });
    return new NextResponse(new Uint8Array(rendered.buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${rendered.fileName}"`,
        // A draft regenerated from changed data must not be served from a cache.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
