import { isCapabilityKey, requireCapability, FeatureDisabled } from "@eia/domain";
import { NextResponse } from "next/server";

import { getRequestContext } from "@/lib/context";

export const dynamic = "force-dynamic";

/**
 * Capability probe: the smallest capability-protected server entry point, kept from Slice 0 so
 * the enforcement contract has a test target that is not a page.
 *
 * It follows the same policy as the routes (ADR-016): an ineffective capability answers 404, the
 * same as an unknown key, so neither a page nor an API can be used to discover which modules a
 * project has.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; project: string; key: string }> },
) {
  const { tenant, project, key } = await params;
  const notFound = NextResponse.json({ state: "not found" }, { status: 404 });
  if (!isCapabilityKey(key)) return notFound;

  const result = await getRequestContext(tenant, project);
  if (result.kind === "unauthenticated") {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  }
  if (result.kind === "denied") {
    return NextResponse.json(
      { state: "permission denied", role: result.role, restrictedData: result.restrictedData },
      { status: 403 },
    );
  }
  try {
    requireCapability(result.ctx, key);
  } catch (error) {
    if (error instanceof FeatureDisabled) return notFound;
    throw error;
  }
  return NextResponse.json({ state: "ok", capability: key, project: result.ctx.projectId });
}
