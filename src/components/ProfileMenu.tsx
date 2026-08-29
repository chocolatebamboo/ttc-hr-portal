"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { UserCircleIcon, LogOutIcon, ChevronDownIcon } from "@/components/icons";

/**
 * Header profile menu — click the avatar/name to open a small panel with exactly two
 * things: a link to the profile page, and sign out. Modeled on the "click your name in the
 * corner" pattern from a reference product the client liked, but trimmed to only what this
 * app actually has today — no status/presence, commands palette, billing, or workspace
 * settings, since none of that is built (or in scope) here. Add to this menu only as real
 * features land, not to mirror the reference more completely.
 */
export default function ProfileMenu({
  displayName,
  jobTitle,
  initials,
}: {
  displayName: string;
  jobTitle: string;
  initials: string;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-black/[0.03] transition-colors"
      >
        <span className="h-7 w-7 rounded-full bg-accent-ink text-white text-xs font-semibold flex items-center justify-center shrink-0">
          {initials}
        </span>
        <span className="text-sm text-foreground hidden sm:inline">{displayName}</span>
        <ChevronDownIcon className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-border bg-surface shadow-lg py-1.5 z-30"
        >
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="h-9 w-9 rounded-full bg-accent-ink text-white text-sm font-semibold flex items-center justify-center shrink-0">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{displayName}</p>
              <p className="text-xs text-muted truncate">{jobTitle}</p>
            </div>
          </div>

          <div className="my-1 border-t border-border" />

          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-black/[0.03]"
          >
            <UserCircleIcon className="h-[18px] w-[18px] text-muted" />
            My Profile
          </Link>

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left hover:bg-black/[0.03] disabled:opacity-60"
          >
            <LogOutIcon className="h-[18px] w-[18px] text-muted" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
