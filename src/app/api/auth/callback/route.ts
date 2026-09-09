import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/auth";

/**
 * Exchanges the one-time code Supabase Auth puts on password-reset, magic-link, and (as of
 * the Google sign-in button on /login) OAuth emails/redirects for a real session, then
 * continues on to `next`. Required by the PKCE flow @supabase/ssr uses — without this hop,
 * /reset-password would have no session to act on.
 *
 * Only the sign-in path (`next` targets /dashboard) gets the extra "does this session
 * actually belong to an invited employee" check below — /reset-password deliberately skips
 * it and handles a no-match itself further downstream (the portal layout already redirects
 * to /login if getCurrentEmployee() comes back null), since a password reset only ever
 * happens for someone who already has — or once had — a real account, so "not invited" would
 * be the wrong message for them even if they're now deactivated.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin: requestOrigin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // On Render, `new URL(request.url).origin` has been observed to resolve to the container's
  // internal bind address (http://localhost:10000) instead of the public domain the browser
  // actually used — password-reset links that verified and exchanged a session successfully
  // server-side, then bounced the browser to a dead localhost:10000 redirect right here.
  // SITE_URL is already the trusted source of truth for this exact problem elsewhere (see
  // inviteRedirectUrl in employees-admin.ts) — prefer it, and only fall back to the
  // request-derived origin for local dev, where SITE_URL is typically unset.
  const origin = process.env.SITE_URL?.replace(/\/$/, "") || requestOrigin;

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
    }

    if (next.startsWith("/dashboard")) {
      // Google sign-in relies on Supabase Auth's own automatic identity linking by verified
      // email (see the doc comment on handleGoogle in src/app/login/page.tsx) — someone HR
      // never invited lands here with a brand-new, real Supabase session but no matching
      // Employee row. Signing them back out immediately (rather than letting them sit on a
      // broken /dashboard, or worse, an unlinked auth account that lingers around) is what
      // makes Google sign-in stay exactly as invite-gated as email/password already is.
      const employee = await getCurrentEmployee();
      if (!employee) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=not_invited`);
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
