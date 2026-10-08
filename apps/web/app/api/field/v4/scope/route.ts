import { resolveFieldWorkScope } from "@eia/application";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { UNAUTHENTICATED } from "@/lib/field-api";
import { getAuth } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/v4/scope` — *in which projects do I have work?*
 *
 * v3's `/api/field/scope` is untouched and still answers its three outcomes, one of which is the
 * terminal `multiple_field_projects`. That state existed because the application held one pack
 * by database constraint, so "several" was genuinely a dead end for it. v4 returns the list and
 * lets the technician choose, because which study their morning belongs to is their decision.
 *
 * The same narrowness as v3: no tenant and no project in the request, because there is none to
 * name yet, and the answer is derived from **the caller's own work** under row-level security.
 * Somebody with none learns only that they have none.
 */
export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return UNAUTHENTICATED;

  const result = await resolveFieldWorkScope(getDb(), session.user.id);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
