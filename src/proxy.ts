import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the middleware.ts convention to proxy.ts (same mechanism, new name —
// see node_modules/next/dist/docs/.../proxy.md). This still only refreshes the session
// cookie and bounces signed-out visitors; every page and API route re-checks auth itself
// (getCurrentEmployee / requireEmployee) rather than trusting this ran, per Next's own
// guidance that a routing change could silently remove Proxy coverage from a route.
export async function proxy(request: NextRequest) {
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
