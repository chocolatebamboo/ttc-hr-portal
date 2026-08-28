"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = pathname === item.href;
  return (
    <Link
      href={item.href}
      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-brand/10 text-brand-ink font-medium"
          : "text-muted hover:bg-black/[0.03] hover:text-foreground"
      }`}
    >
      {item.label}
    </Link>
  );
}

/** Desktop-only left sidebar. Hidden on small screens — see BottomNav for mobile. */
export default function RoleNav({ primary, extra }: { primary: NavItem[]; extra: NavItem[] }) {
  return (
    <nav className="hidden md:flex md:w-56 md:flex-col md:shrink-0 md:border-r md:border-border md:py-6 md:px-3 md:gap-6">
      <div className="flex flex-col gap-0.5">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </div>
      {extra.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted/70">
            Administration
          </div>
          {extra.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      )}
    </nav>
  );
}
