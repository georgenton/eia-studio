import { NextResponse } from "next/server";

import { APP_VERSION, GIT_SHA } from "@/lib/version";

export const dynamic = "force-dynamic";

/** Liveness for the web app. No environment values, no database access. */
export function GET() {
  return NextResponse.json(
    { status: "ok", service: "web", version: APP_VERSION, gitSha: GIT_SHA },
    { headers: { "cache-control": "no-store" } },
  );
}
