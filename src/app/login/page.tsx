"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

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

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image src="/ttc-logo.png" alt="Talented Teen Club" width={64} height={64} className="mx-auto mb-4" priority />
          <h1 className="page-title text-2xl">Staff sign in</h1>
          <p className="text-sm text-muted mt-1">Talented Teen Club HR Portal</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-xl p-6 space-y-4 shadow-sm"
        >
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
    </main>
  );
}
