import type { Role } from "@/types";
import {
  HomeIcon,
  ClockIcon,
  CalendarIcon,
  FolderIcon,
  ChecklistIcon,
  UsersIcon,
  MegaphoneIcon,
  UserCircleIcon,
  IdCardIcon,
  ChartIcon,
  GearIcon,
  ChatIcon,
  type IconProps,
} from "@/components/icons";

export interface NavItem {
  label: string;
  href: string;
  icon: (props: IconProps) => React.ReactElement;
}

export const EMPLOYEE_NAV: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: HomeIcon },
  { label: "My Time", href: "/time", icon: ClockIcon },
  { label: "Availability", href: "/availability", icon: CalendarIcon },
  // Phase 1 of the scheduling workflow rebuild (client spec, Sept 2026) — the confirmed-Shift
  // counterpart to "Availability" just above: what you've SAID you're free for vs. what a
  // supervisor has actually scheduled you for. Deliberately its own link, not a tab bolted onto
  // Availability — the client's own spec lists them as two separate things in the interface,
  // matching the two separate database records behind them (see Shift in prisma/schema.prisma).
  { label: "My Schedule", href: "/schedule", icon: CalendarIcon },
  { label: "Documents", href: "/documents", icon: FolderIcon },
  { label: "Onboarding", href: "/onboarding", icon: ChecklistIcon },
  // CB, Sept 2026: "instead of notes, I want it to be messages... so its no longer notes its
  // 'My Messages.'" /messages is the unified inbox — the old general employee/supervisor
  // thread, per-date/PTO conversations, and real peer-to-peer DMs, all in one place (see
  // src/app/(portal)/messages/MessagesInboxView.tsx). /notes still exists as a redirect for any
  // stale link.
  { label: "My Messages", href: "/messages", icon: ChatIcon },
  { label: "Directory", href: "/directory", icon: UsersIcon },
  { label: "Announcements", href: "/announcements", icon: MegaphoneIcon },
  { label: "My Profile", href: "/profile", icon: UserCircleIcon },
];

export const SUPERVISOR_NAV: NavItem[] = [
  { label: "My Team", href: "/team", icon: UsersIcon },
  // Phase 1 of the scheduling workflow rebuild — confirmed shifts across a supervisor's own
  // reports. At /team/schedule rather than /admin/schedule: this page is for supervisors too
  // (client spec: "Supervisor: Manage... shifts... for Team Members under their supervision"),
  // not admin-only the way the rest of ADMIN_NAV below is, so it sits alongside /team instead
  // of under the admin-only URL space. Same href in ADMIN_NAV below — one page, gated to
  // whichever of the two roles is actually viewing it, not two competing pages.
  { label: "Team Schedule", href: "/team/schedule", icon: CalendarIcon },
];

// Documents, Onboarding and Announcements are deliberately NOT repeated here even though
// admins manage all three — each of those pages (DocumentsView/OnboardingView/
// AnnouncementsView) already renders its own admin-only "Manage" tab via a `canManage` prop
// when the signed-in employee is an admin, so the single employee-nav link already goes
// somewhere that offers the admin controls. A second admin-section link pointing at the exact
// same href used to sit here too — same page, same route, just listed twice in the sidebar —
// which is the "why does Announcements show up twice" bug CB flagged; removed rather than
// re-added.
export const ADMIN_NAV: NavItem[] = [
  { label: "Team Members", href: "/admin/employees", icon: IdCardIcon },
  { label: "Attendance", href: "/admin/attendance", icon: ClockIcon },
  { label: "PTO Management", href: "/admin/pto", icon: CalendarIcon },
  // Labeled "Team Availability" rather than plain "Availability" — every role already has a
  // personal "Availability" link up in EMPLOYEE_NAV (for submitting your own), so an admin
  // account was seeing the word "Availability" twice in the sidebar with nothing to tell the
  // two apart at a glance (CB, Sept 2026). Same fix in spirit as SUPERVISOR_NAV's "My Team"
  // just above — name the admin-facing link by what it's FOR, not just the resource.
  { label: "Team Availability", href: "/admin/availability", icon: CalendarIcon },
  // Same page SUPERVISOR_NAV links to above, at the same /team/schedule href — an admin needs
  // it too (org-wide rather than just their own reports), not a second competing page.
  { label: "Team Schedule", href: "/team/schedule", icon: CalendarIcon },
  { label: "Reports", href: "/admin/reports", icon: ChartIcon },
  { label: "Administration", href: "/admin/administration", icon: GearIcon },
];

/** Every role sees the employee nav — admins/supervisors get it plus their own section, so
 *  nobody is shown administrative controls they can't use (brief §"Application Structure"). */
export function navForRole(role: Role): { primary: NavItem[]; extra: NavItem[] } {
  if (role === "SUPER_ADMIN" || role === "HR_ADMIN") {
    return { primary: EMPLOYEE_NAV, extra: ADMIN_NAV };
  }
  if (role === "SUPERVISOR") {
    return { primary: EMPLOYEE_NAV, extra: SUPERVISOR_NAV };
  }
  return { primary: EMPLOYEE_NAV, extra: [] };
}
