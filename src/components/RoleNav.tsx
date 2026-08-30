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
 */
export default function RoleNav({ role, needsOnboardingAttention = false }: { role: Role; needsOnboardingAttention?: boolean }) {
  const { primary, extra } = navForRole(role);
  return (
    <nav className="hidden md:flex md:w-56 md:flex-col md:shrink-0 md:border-r md:border-border md:py-6 md:px-3 md:gap-6">
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
