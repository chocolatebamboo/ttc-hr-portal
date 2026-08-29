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
  { label: "Time Off", href: "/time-off", icon: CalendarIcon },
  { label: "Documents", href: "/documents", icon: FolderIcon },
  { label: "Onboarding", href: "/onboarding", icon: ChecklistIcon },
  { label: "Directory", href: "/directory", icon: UsersIcon },
  { label: "Announcements", href: "/announcements", icon: MegaphoneIcon },
  { label: "My Profile", href: "/profile", icon: UserCircleIcon },
];

export const SUPERVISOR_NAV: NavItem[] = [{ label: "My Team", href: "/team", icon: UsersIcon }];

// Documents, Onboarding and Announcements are deliberately NOT repeated here even though
// admins manage all three — each of those pages (DocumentsView/OnboardingView/
// AnnouncementsView) already renders its own admin-only "Manage" tab via a `canManage` prop
// when the signed-in employee is an admin, so the single employee-nav link already goes
// somewhere that offers the admin controls. A second admin-section link pointing at the exact
// same href used to sit here too — same page, same route, just listed twice in the sidebar —
// which is the "why does Announcements show up twice" bug CB flagged; removed rather than
// re-added.
export const ADMIN_NAV: NavItem[] = [
  { label: "Employees", href: "/admin/employees", icon: IdCardIcon },
  { label: "Attendance", href: "/admin/attendance", icon: ClockIcon },
  { label: "PTO Management", href: "/admin/pto", icon: CalendarIcon },
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
