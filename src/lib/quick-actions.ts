import type { Role } from "@/types";
import {
  FolderIcon,
  ChecklistIcon,
  ChatIcon,
  UsersIcon,
  MegaphoneIcon,
  UserCircleIcon,
  ChartIcon,
  IdCardIcon,
  ClockIcon,
  CalendarIcon,
  GearIcon,
  type IconProps,
} from "@/components/icons";

export type QuickActionTone = "blue" | "pink" | "amber" | "emerald" | "violet";

export interface QuickActionDef {
  key: string;
  label: string;
  href: string;
  icon: (props: IconProps) => React.ReactElement;
  tone: QuickActionTone;
}

/**
 * Every quick-action tile a person could choose to keep on their dashboard, keyed by a stable
 * string rather than by href — a route can move without silently orphaning someone's saved
 * picks. CB, round five: "I should be able to customize what quick actions is there... based
 * off of what's available in the more tab" — this is deliberately the exact same set More
 * already lists (EMPLOYEE_NAV minus Home/My Time/Availability, which already live in the
 * bottom nav — see MorePage's own `rest` filter in src/app/(portal)/more/page.tsx) plus each
 * role's own admin/supervisor section from src/lib/nav.ts, so there's nothing pickable here
 * that isn't already a real destination this app has.
 */
const BASE_ACTIONS: QuickActionDef[] = [
  { key: "documents", label: "View Documents", href: "/documents", icon: FolderIcon, tone: "amber" },
  { key: "onboarding", label: "View Onboarding", href: "/onboarding", icon: ChecklistIcon, tone: "emerald" },
  { key: "notes", label: "Notes", href: "/notes", icon: ChatIcon, tone: "violet" },
  { key: "directory", label: "Directory", href: "/directory", icon: UsersIcon, tone: "blue" },
  { key: "announcements", label: "Announcements", href: "/announcements", icon: MegaphoneIcon, tone: "pink" },
  { key: "profile", label: "My Profile", href: "/profile", icon: UserCircleIcon, tone: "blue" },
];

const SUPERVISOR_ACTIONS: QuickActionDef[] = [
  { key: "team", label: "My Team", href: "/team", icon: UsersIcon, tone: "violet" },
];

const ADMIN_ACTIONS: QuickActionDef[] = [
  { key: "employees", label: "Team Members", href: "/admin/employees", icon: IdCardIcon, tone: "blue" },
  { key: "attendance", label: "Attendance", href: "/admin/attendance", icon: ClockIcon, tone: "amber" },
  { key: "pto-admin", label: "PTO Management", href: "/admin/pto", icon: CalendarIcon, tone: "pink" },
  { key: "availability-admin", label: "Team Availability", href: "/admin/availability", icon: CalendarIcon, tone: "violet" },
  { key: "reports", label: "Reports", href: "/admin/reports", icon: ChartIcon, tone: "violet" },
  { key: "administration", label: "Administration", href: "/admin/administration", icon: GearIcon, tone: "emerald" },
];

/** Every tile this role is allowed to pick from — same admin/supervisor/plain-employee split
 *  navForRole (src/lib/nav.ts) already uses, so the picker never offers a destination the
 *  person can't actually reach. */
export function availableQuickActions(role: Role): QuickActionDef[] {
  if (role === "SUPER_ADMIN" || role === "HR_ADMIN") return [...BASE_ACTIONS, ...ADMIN_ACTIONS];
  if (role === "SUPERVISOR") return [...BASE_ACTIONS, ...SUPERVISOR_ACTIONS];
  return BASE_ACTIONS;
}

/** What a person sees before they've ever customized anything — the same defaults the
 *  dashboard always showed (Documents + Onboarding, plus Reports for admins), so shipping this
 *  feature doesn't change anyone's home screen until they actually open the picker themselves. */
export function defaultQuickActionKeys(role: Role): string[] {
  const keys = ["documents", "onboarding"];
  if (role === "SUPER_ADMIN" || role === "HR_ADMIN") keys.push("reports");
  return keys;
}

/** Resolves a person's saved keys into the actual tiles to render, in the order they picked
 *  them. Falls back to the plain defaults when nothing's been saved yet, or when every saved
 *  key turned out stale (e.g. a role change dropped access to all of them) — either way, never
 *  an empty grid. */
export function resolveQuickActions(role: Role, selectedKeys: string[]): QuickActionDef[] {
  const available = availableQuickActions(role);
  const byKey = new Map(available.map((a) => [a.key, a]));

  const fromSelection = selectedKeys.map((k) => byKey.get(k)).filter((a): a is QuickActionDef => !!a);
  if (fromSelection.length > 0) return fromSelection;

  return defaultQuickActionKeys(role)
    .map((k) => byKey.get(k))
    .filter((a): a is QuickActionDef => !!a);
}
