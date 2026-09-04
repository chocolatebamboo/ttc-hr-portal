"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, ClockIcon, FolderIcon, MoreIcon } from "@/components/icons";

const ITEMS = [
  { label: "Home", href: "/dashboard", Icon: HomeIcon },
  { label: "My Time", href: "/time", Icon: ClockIcon },
  { label: "Documents", href: "/documents", Icon: FolderIcon },
  { label: "More", href: "/more", Icon: MoreIcon },
];

/**
 * Mobile-only bottom tab bar — capped at five fixed, thumb-sized targets so nothing
 * requires horizontal scrolling to reach. "More" opens a plain list of everything else
 * (role-aware) rather than a nested menu, keeping every screen a single tap deep.
 *
 * `needsOnboardingAttention` puts a small dot on "More" (not a dedicated Onboarding tab,
 * since Onboarding itself lives one tap deeper on the More screen — see more/page.tsx, which
 * shows its own dot on that row).
 *
 * Floating pill styling (Sept 2026, CB's ask — see reference screenshots she shared): a
 * rounded bar inset from the screen edges with a filled circular highlight behind the
 * active icon, rather than the old flush full-width bar. Deliberately still opaque-ish
 * (bg-surface/90 + blur, not true glass) and keeps the text labels — CB previously rejected
 * a heavier frosted-glass + gradient-glow treatment on the dashboard (see globals.css's Aug
 * 2026 removal note), so this leans on shape and color rather than blur for the "premium"
 * feel, and labels stay for anyone less familiar with icon-only nav.
 */
export default function BottomNav({ needsOnboardingAttention = false }: { needsOnboardingAttention?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      className="animate-in md:hidden fixed bottom-0 inset-x-0 z-20 px-3 pt-2 pointer-events-none"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
    >
      <div className="pointer-events-auto mx-auto max-w-sm flex items-center justify-between gap-1 rounded-full border border-border/70 bg-surface/90 backdrop-blur-md shadow-lg px-2 py-1.5">
        {ITEMS.map(({ label, href, Icon }) => {
          const active = pathname === href || (href === "/more" && pathname.startsWith("/more"));
          return (
            <Link
              key={href}
              href={href}
              className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 min-h-[52px] text-[10px] rounded-full"
            >
              <span
                className={`relative flex items-center justify-center h-9 w-9 rounded-full transition-colors ${
                  active ? "bg-accent-ink text-white" : "text-muted"
                }`}
              >
                <Icon className="h-5 w-5" />
                {href === "/more" && needsOnboardingAttention && (
                  <span
                    aria-label="Needs attention"
                    className="absolute top-0 right-0 h-2 w-2 rounded-full bg-accent ring-2 ring-surface"
                  />
                )}
              </span>
              <span className={active ? "text-accent-ink font-medium" : "text-muted"}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
