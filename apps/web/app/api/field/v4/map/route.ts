import { loadFieldMap } from "@eia/application";
import { DomainError, FeatureDisabled, NotFound, PermissionDenied } from "@eia/domain";
import { fieldMapRequestSchema } from "@eia/field-sync-contract";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeMobileRequest, DENIED, UNAUTHENTICATED } from "@/lib/field-api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/field/v4/map` — the cartography a technician downloads to find their parcels.
 *
 * A **separate resource**, not a field on the pack. `packParcelContextSchema` is `.strict()` and
 * travels server → device, so a new field in it is a parse error on every installed build; that is
 * the direction where growth costs a version. This has its own endpoint and its own schema, so a
 * build that does not know about it simply never asks and the pack it understands is unchanged.
 *
 * Everything that decides is underneath. `loadFieldMap` requires `gis.maps`, `field.surveys` and
 * `field.assignments.read_own`, and the row-level policy on `app.field_assignment` is what scopes
 * the answer to this technician's own work — nothing is filtered out of a larger result, because
 * the larger result is never assembled. A tenant or project the caller cannot see answers **404**
 * rather than 403, like every other mobile route (ADR-016).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = fieldMapRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const auth = await authorizeMobileRequest(
    request,
    parsed.data.tenantSlug,
    parsed.data.projectSlug,
  );
  if (auth.kind === "unauthenticated") return UNAUTHENTICATED;
  if (auth.kind === "denied") return DENIED;

  try {
    /*
     * The device says what it can parse; the server answers in that version and never newer.
     * A build that predates `parts` sends nothing and is answered in version 1, which is what its
     * own `.strict()` schema is pinned to.
     */
    const result = await loadFieldMap(getDb(), auth.ctx, {
      ...(parsed.data.acceptsSchemaVersion === undefined
        ? {}
        : { acceptsSchemaVersion: parsed.data.acceptsSchemaVersion }),
    });
    /*
     * `no-store`: the device persists this itself, with the moment it was downloaded, and shows
     * that moment. A cached copy in between would be a map of unknown age pretending to be fresh —
     * and the offline guarantee is the local database, never an HTTP cache.
     */
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof FeatureDisabled || error instanceof NotFound) return DENIED;
    if (error instanceof PermissionDenied) return DENIED;
    if (error instanceof DomainError) {
      return NextResponse.json({ error: "refused", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
