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
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

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
