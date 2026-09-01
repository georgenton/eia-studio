import { FeatureDisabled, isCapabilityKey, requireCapability } from "@eia/domain";
import { NextResponse } from "next/server";

import { getRequestContext } from "@/lib/context";

export const dynamic = "force-dynamic";

/**
 * Foundation probe: the smallest capability-protected server entry point. Proves that a disabled
 * (or ANNOUNCED) capability is not invocable through a URL even for an OWNER.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; project: string; key: string }> },
) {
  const { tenant, project, key } = await params;
  if (!isCapabilityKey(key)) return NextResponse.json({ state: "not found" }, { status: 404 });
  const result = await getRequestContext(tenant, project);
  if (result.kind === "unauthenticated")
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  if (result.kind === "denied") {
    return NextResponse.json(
      { state: "permission denied", role: result.role, restrictedData: result.restrictedData },
      { status: 403 },
    );
  }
  try {
    requireCapability(result.ctx, key);
  } catch (error) {
    if (error instanceof FeatureDisabled) {
      return NextResponse.json(
        {
          state: "feature disabled",
          capability: error.capability,
          whoCanEnable: error.whoCanEnable,
        },
        { status: 403 },
      );
    }
    throw error;
  }
  return NextResponse.json({ state: "ok", capability: key, project: result.ctx.projectId });
}
