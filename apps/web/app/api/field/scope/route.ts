import { resolveFieldScope } from "@eia/application";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getAuth } from "@/lib/identity";
import { UNAUTHENTICATED } from "@/lib/field-api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/scope` — *whose work am I here to do?*
 *
 * The one question the mobile application could not ask. Every other route on this surface names a
 * tenant and a project in its body, because the device already knows them from the pack it holds;
 * a fresh installation holds no pack, so it had no way to name anything and both of its buttons
 * returned early. This route is asked **once**, before the first pack, and never again.
 *
 * It is the only route here that takes no tenant and no project, which is exactly why it is the
 * only one that does not use `authorizeMobileRequest`: there is no slug to resolve a context from.
 * What replaces that is narrower rather than wider — the answer is derived from **the caller's own
 * field assignments**, read under row-level security that already restricts a technician to their
 * own rows (`resolveFieldScope`). A caller with no assignments learns only that they have none,
 * which is true of a VIEWER, a `PROJECT_DATA_MANAGER` and a stranger alike.
 *
 * A POST with no body, for the reason the pack route is a POST: nothing about a technician's work
 * should be cacheable by anything between the device and here.
 */
export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return UNAUTHENTICATED;

  const result = await resolveFieldScope(getDb(), session.user.id);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
