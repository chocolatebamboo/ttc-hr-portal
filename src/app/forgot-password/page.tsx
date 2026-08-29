"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/api/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    // Always show the same confirmation, whether or not the email is registered — this is
    // deliberate: it never reveals which TTC email addresses do or don't have accounts.
    setSent(true);
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="page-title text-2xl mb-1.5">Reset your password</h1>
        <p className="text-sm text-muted mb-6">
          We&apos;ll email you a link to choose a new one.
        </p>

        {sent ? (
          <div className="bg-surface border border-border rounded-xl p-6 text-sm">
            If that email has a TTC account, a reset link is on its way. Check your inbox
            (and spam folder) — the link expires after a short time.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-surface border border-border rounded-xl p-6 space-y-4 shadow-sm"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@talentedteenclub.org"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
            />
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="text-center text-sm mt-4">
          <a href="/login" className="text-accent-ink font-medium hover:underline">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
