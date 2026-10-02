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
  MoreIcon,
  type IconProps,
} from "@/components/icons";

export interface NavItem {
  label: string;
  href: string;
  icon: (props: IconProps) => React.ReactElement;
  // Oct 2026 (CB, on the Team Availability admin nav item: "team availability need to be the
  // main page and the remaining pages under it... need to be like subpages... so it reads
  // cleanly"): optional nested items a NavItem can carry, rendered indented beneath their
  // parent by RoleNav. Only ADMIN_NAV's Team Availability entry uses this today — everything
  // else stays a flat, childless item, same as before.
  children?: NavItem[];
}

export const EMPLOYEE_NAV: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: HomeIcon },
  // "My Time" was its own link here until correction brief #6 (Sept 2026), "Consolidate
  // Availability and My Time" — its useful functionality (Logged Hours; Time Off was already
  // shared) moved into Availability below, so a separate "My Time" link would now just be a
  // second nav item pointing at the exact same destination (/time redirects to /availability) —
  // the same "why does Announcements show up twice" duplicate-link bug CB flagged once already
  // (see the ADMIN_NAV comment below), not something to reintroduce here.
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
  // Added Oct 2026 (CB, after flagging that Daijour's sidebar was missing Attendance and PTO
  // Management: "give him Attendance + PTO Management for his own team"): same hrefs ADMIN_NAV
  // nests under "Team Availability" below, flat here instead — SUPERVISOR_NAV has never had a
  // nested group, and there's no supervisor-facing "Team Availability" landing page the way
  // ADMIN_NAV's parent links to /admin/availability. Each page itself narrows to the caller's
  // own direct reports (see canAccessAttendance/canAccessPtoManagement in
  // src/lib/authorization.ts and the scoping in listAdminAttendance/listAdminPto) — this is a
  // path to data Daijour already has real authority over elsewhere (his own reports' timesheets
  // and PTO via /team/[employeeId]), not new access.
  { label: "Attendance", href: "/admin/attendance", icon: ClockIcon },
  { label: "PTO Management", href: "/admin/pto", icon: CalendarIcon },
  // Found missing Oct 2026 (CB: "did you make sure that Daijour's role... is looking like the
  // admin"): /admin/reports/page.tsx has granted a Supervisor this page, scoped to their own team
  // (canAccessReports), ever since Correction brief #8 — but this sidebar list was never updated
  // to match, so Daijour had a fully working Reports page with no link anywhere in his nav to
  // actually reach it. Same href ADMIN_NAV uses below — one page, gated by scope inside
  // ReportsView, not two competing routes.
  { label: "Reports", href: "/admin/reports", icon: ChartIcon },
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
  // Restructured (CB, Oct 2026, on the mockup's Availability board: "team availability need to
  // be the main page and the remaining pages under it like attendance, pto management and team
  // schedule needs to be like subpages in a way so it reads cleanly"): Attendance, PTO
  // Management and Team Schedule are now nested under Team Availability as its children,
  // instead of six flat, same-weight items in a row. Hrefs are unchanged — this only changes
  // how the sidebar groups and indents them, not where any of them live or what gates them.
  //
  // Labeled "Team Availability" rather than plain "Availability" — every role already has a
  // personal "Availability" link up in EMPLOYEE_NAV (for submitting your own), so an admin
  // account was seeing the word "Availability" twice in the sidebar with nothing to tell the
  // two apart at a glance (CB, Sept 2026). Same fix in spirit as SUPERVISOR_NAV's "My Team"
  // just above — name the admin-facing link by what it's FOR, not just the resource.
  {
    label: "Team Availability",
    href: "/admin/availability",
    icon: CalendarIcon,
    children: [
      { label: "Attendance", href: "/admin/attendance", icon: ClockIcon },
      { label: "PTO Management", href: "/admin/pto", icon: CalendarIcon },
      // Same page SUPERVISOR_NAV links to above, at the same /team/schedule href — an admin
      // needs it too (org-wide rather than just their own reports), not a second competing page.
      { label: "Team Schedule", href: "/team/schedule", icon: CalendarIcon },
    ],
  },
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

/**
 * The mobile bottom tab bar's four fixed slots — one set per permission level (correction
 * brief #7, "Mobile navigation by permission level"): regular team members get
 * Home / Availability / My Messages / More; staff (SUPER_ADMIN/HR_ADMIN/SUPERVISOR) get
 * Home / Availability / Reports / More instead — "Administrative users can still reach Messages
 * through the appropriate interface/More area/chat entry points even if Messages is not one of
 * their four primary navigation items" (My Messages still appears in their own More list; see
 * src/app/(portal)/more/page.tsx).
 *
 * Used to be SUPER_ADMIN/HR_ADMIN only: this doc comment originally explained that on the
 * grounds that /admin/reports itself was "still gated to isAdmin() only today," so pointing a
 * Supervisor's bottom nav at Reports would have redirected them straight back to /dashboard.
 * That premise is stale — /admin/reports/page.tsx has granted a Supervisor this page (scoped to
 * their own team) since Correction brief #8, same as SUPERVISOR_NAV above already assumed; this
 * function was just never updated to match when that landed. Found and fixed Oct 2026 (CB: "did
 * you make sure that Daijour's role... is looking like the admin").
 */
export function bottomNavForRole(role: Role): NavItem[] {
  const isStaffRole = role === "SUPER_ADMIN" || role === "HR_ADMIN" || role === "SUPERVISOR";
  return [
    { label: "Home", href: "/dashboard", icon: HomeIcon },
    { label: "Availability", href: "/availability", icon: CalendarIcon },
    isStaffRole
      ? { label: "Reports", href: "/admin/reports", icon: ChartIcon }
      : { label: "My Messages", href: "/messages", icon: ChatIcon },
    { label: "More", href: "/more", icon: MoreIcon },
  ];
}
