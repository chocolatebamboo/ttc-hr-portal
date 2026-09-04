"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/types";

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  SUPERVISOR: "Supervisor",
  EMPLOYEE: "Team Member",
};

/**
 * Persistent, impossible-to-miss bar shown across the top of every portal page while a "View
 * as" preview (src/lib/preview.ts) is active — rendered from the portal layout, which is why
 * it always appears regardless of which page is open or what that page's own content is. The
 * app underneath is genuinely rendering as the previewed team member would see it (their nav,
 * their dashboard, their data); this banner is what keeps that from being confusing to the
 * Super Admin actually looking at it, and it's also the ONLY way out once the nav itself has
 * changed to a lower role's — everything below this bar shows exactly what that role sees,
 * which for most roles doesn't include a way back to Team Members or any admin page.
 */
export default function PreviewBanner({
  name,
  role,
}: {
  name: string;
  role: Role;
}) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  async function exitPreview() {
    setExiting(true);
    try {
      await fetch("/api/admin/preview/stop", { method: "POST" });
    } finally {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <span className="text-amber-900">
        Previewing as <span className="font-semibold">{name}</span> — {ROLE_LABEL[role]} ·
        read-only, nothing here can be saved or submitted
      </span>
      <button
        type="button"
        onClick={exitPreview}
        disabled={exiting}
        className="shrink-0 rounded-full bg-amber-900 text-white text-xs font-medium px-3 py-1.5 hover:bg-amber-950 transition-colors disabled:opacity-60"
      >
        {exiting ? "Exiting…" : "Exit preview"}
      </button>
    </div>
  );
}
