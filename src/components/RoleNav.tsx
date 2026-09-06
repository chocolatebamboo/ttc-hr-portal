"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navForRole, type NavItem } from "@/lib/nav";
import type { Role } from "@/types";

function NavLink({ item, showDot }: { item: NavItem; showDot: boolean }) {
  const pathname = usePathname();
  const active = pathname === item.href;
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-accent-ink text-white font-semibold shadow-sm"
          : "text-muted hover:bg-black/[0.03] hover:text-foreground"
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="flex-1">{item.label}</span>
      {showDot && <span aria-label="Needs attention" className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />}
    </Link>
  );
}

/**
 * Desktop-only left sidebar. Hidden on small screens — see BottomNav for mobile.
 * Takes `role` plus a live `needsOnboardingAttention` flag and resolves the nav list itself
 * (rather than receiving pre-built {primary, extra} arrays as props) because nav items carry
 * icon component references, and a Server Component can't pass functions across the RSC
 * boundary into a Client Component prop — only plain values like the parent server layout's
 * already-verified `role` string and this boolean can.
 *
 * md:sticky md:top-0 md:self-start md:h-screen (CB, Sept 2026: "I should always kinda see that
 * side navigation" — the first attempt at this relied entirely on the parent layout
 * ((portal)/layout.tsx's md:h-screen + nested md:overflow-hidden/md:overflow-y-auto) boxing
 * this nav into exactly one viewport's height so it would never need to move. In practice that
 * still left this nav stretching to match its sibling's full (much taller, unbounded) content
 * height, with the actual nav items sitting in only the top slice of it — everything below
 * read as a blank column once a long page like Availability was scrolled. `self-start` opts
 * this element out of that stretch instead of depending on it, `h-screen` gives it its own
 * fixed height regardless of what the rest of the row does, and `sticky top-0` pins it to
 * whichever ancestor actually ends up scrolling — so this nav stays correctly sized and in
 * place even if the parent's own scroll-containment ever regresses again. */
export default function RoleNav({ role, needsOnboardingAttention = false }: { role: Role; needsOnboardingAttention?: boolean }) {
  const { primary, extra } = navForRole(role);
  return (
    <nav className="hidden md:flex md:sticky md:top-0 md:self-start md:h-screen md:w-56 md:flex-col md:shrink-0 md:overflow-y-auto md:border-r md:border-border md:py-6 md:px-3 md:gap-6">
      <div className="animate-in flex flex-col gap-0.5">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} showDot={needsOnboardingAttention && item.href === "/onboarding"} />
        ))}
      </div>
      {extra.length > 0 && (
        <div className="animate-in animate-in-2 flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted/70">
            Administration
          </div>
          {extra.map((item) => (
            <NavLink key={item.href} item={item} showDot={false} />
          ))}
        </div>
      )}
    </nav>
  );
}
