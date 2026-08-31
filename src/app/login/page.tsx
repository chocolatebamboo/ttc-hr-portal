"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Google's official four-color "G" mark, per Google's own branding guidelines for sign-in
// buttons — not a decorative icon, so it's reproduced exactly rather than recolored.
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** ?error= values the /api/auth/callback route can redirect back here with, after a Google
 *  sign-in that succeeded with Google but doesn't match an invited TTC account. Read from
 *  window.location on mount (not next/navigation's useSearchParams) so this page can stay a
 *  plain static export with no Suspense boundary to satisfy. */
const OAUTH_ERROR_COPY: Record<string, string> = {
  not_invited:
    "That Google account isn't linked to a TTC HR Portal invite yet. Ask HR to add you as an employee first (using this same email address), then try again.",
  oauth_failed: "Google sign-in didn't complete. Please try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && OAUTH_ERROR_COPY[code]) {
      setStatus("error");
      setErrorMessage(OAUTH_ERROR_COPY[code]);
      // Drop ?error= from the visible URL so refreshing/sharing the link doesn't re-show it.
      window.history.replaceState(null, "", "/login");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      // Deliberately generic — never confirm/deny whether an email exists in the system.
      setErrorMessage("That email and password don't match. Please try again.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  /** Google sign-in relies on Supabase Auth's own automatic identity linking: since HR's
   *  invite already created a confirmed-email account for this person (see
   *  ensureAuthUser/inviteUserByEmail in src/lib/employees-admin.ts), a Google sign-in with
   *  that same email attaches to that SAME account rather than creating a new, unlinked one —
   *  no separate "request access" flow needed. If the email doesn't match any invited
   *  account, Supabase creates a fresh, un-invited auth user; getCurrentEmployee() then finds
   *  no matching Employee row for it, and /api/auth/callback bounces that case back here with
   *  ?error=not_invited rather than landing them on a broken dashboard. */
  async function handleGoogle() {
    setGoogleLoading(true);
    setStatus("idle");
    setErrorMessage("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard` },
    });
    if (error) {
      setGoogleLoading(false);
      setStatus("error");
      setErrorMessage("Unable to start Google sign-in. Please try again, or use your email and password below.");
    }
    // On success the browser navigates away to Google — nothing further to do here.
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image src="/ttc-logo.png" alt="Talented Teen Club" width={64} height={64} className="mx-auto mb-4" priority />
          <h1 className="page-title text-2xl">Staff sign in</h1>
          <p className="text-sm text-muted mt-1">Talented Teen Club HR Portal</p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6 shadow-sm">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || status === "loading"}
            className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-border bg-background py-3 text-sm font-medium hover:bg-black/[0.02] transition-colors disabled:opacity-60"
          >
            <GoogleIcon />
            {googleLoading ? "Redirecting to Google…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5">
                TTC email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
                placeholder="you@talentedteenclub.org"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {status === "error" && (
              <p role="alert" className="text-sm text-accent">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              className="btn-primary w-full py-3 text-base"
            >
              {status === "loading" ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-center text-sm">
              <a href="/forgot-password" className="text-accent-ink font-medium hover:underline">
                Forgot your password?
              </a>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
