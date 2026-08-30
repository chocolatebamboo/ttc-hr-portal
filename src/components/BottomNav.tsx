"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, ClockIcon, CalendarIcon, FolderIcon, MoreIcon } from "@/components/icons";

const ITEMS = [
  { label: "Home", href: "/dashboard", Icon: HomeIcon },
  { label: "My Time", href: "/time", Icon: ClockIcon },
  { label: "Time Off", href: "/time-off", Icon: CalendarIcon },
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
 */
export default function BottomNav({ needsOnboardingAttention = false }: { needsOnboardingAttention?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="animate-in md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-5">
        {ITEMS.map(({ label, href, Icon }) => {
          const active = pathname === href || (href === "/more" && pathname.startsWith("/more"));
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] text-[11px] ${
                active ? "text-accent-ink font-medium" : "text-muted"
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {href === "/more" && needsOnboardingAttention && (
                  <span
                    aria-label="Needs attention"
                    className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent"
                  />
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
