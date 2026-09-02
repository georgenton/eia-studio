import { getAuthHandler } from "@/lib/identity";

export const dynamic = "force-dynamic";

// Better Auth endpoints (identity/session only, ADR-010). Handler is created lazily so builds
// without runtime secrets still succeed.
export async function GET(request: Request) {
  return getAuthHandler().GET(request);
}

export async function POST(request: Request) {
  return getAuthHandler().POST(request);
}
