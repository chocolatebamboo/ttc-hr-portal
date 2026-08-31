import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the middleware.ts convention to proxy.ts (same mechanism, new name —
// see node_modules/next/dist/docs/.../proxy.md). This still only refreshes the session
// cookie and bounces signed-out visitors; every page and API route re-checks auth itself
// (getCurrentEmployee / requireEmployee) rather than trusting this ran, per Next's own
// guidance that a routing change could silently remove Proxy coverage from a route.
//
// The one thing this file DOES enforce on its own, rather than leaving to every individual
// route: while a "View as" preview is active (src/lib/preview.ts), every non-GET/HEAD
// request to /api/* is refused outright, except the stop-preview route itself. This is
// intentionally centralized here instead of duplicated across 40+ mutating routes — a single
// choke point that can't be forgotten on some future route, for a check that's purely about
// HTTP method + a cookie's presence and needs no database access to make. It's a coarse,
// blanket rule on purpose: "View as" is meant to be a read-only sanity check of another
// role's screens, never a way to actually act as them (see preview.ts's doc comment for the
// full reasoning, including why the cookie itself doesn't need to be cryptographically
// signed to make this safe).
const PREVIEW_COOKIE = "ttc_preview_employee_id";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    request.nextUrl.pathname !== "/api/admin/preview/stop" &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.cookies.has(PREVIEW_COOKIE)
  ) {
    return NextResponse.json(
      { error: "Actions are disabled while previewing another role. Exit preview to make changes." },
      { status: 403 }
    );
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets, so the session cookie stays fresh and
     * unauthenticated users are bounced to /login before any portal page renders.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
