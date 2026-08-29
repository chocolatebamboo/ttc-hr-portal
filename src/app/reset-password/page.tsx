"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    const supabase = createSupabaseBrowserClient();
    // The user arrives here already in a temporary session established by the emailed
    // reset link (Supabase Auth handles that exchange) — this just sets the new password.
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus("error");
      return;
    }
    setStatus("done");
    setTimeout(() => router.push("/dashboard"), 1200);
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="page-title text-2xl mb-6">Choose a new password</h1>
        {status === "done" ? (
          <div className="bg-surface border border-border rounded-xl p-6 text-sm">
            Password updated. Taking you to your dashboard…
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-surface border border-border rounded-xl p-6 space-y-4 shadow-sm"
          >
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (8+ characters)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
            />
            {status === "error" && (
              <p role="alert" className="text-sm text-accent">
                Couldn&apos;t update your password. Request a fresh reset link and try again.
              </p>
            )}
            <button type="submit" disabled={status === "loading"} className="btn-primary w-full py-3 text-base">
              {status === "loading" ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
