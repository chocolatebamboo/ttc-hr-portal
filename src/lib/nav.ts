import type { Role } from "@/types";

export interface NavItem {
  label: string;
  href: string;
}

export const EMPLOYEE_NAV: NavItem[] = [
  { label: "Home", href: "/dashboard" },
  { label: "My Time", href: "/time" },
  { label: "Time Off", href: "/time-off" },
  { label: "Documents", href: "/documents" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Directory", href: "/directory" },
  { label: "Announcements", href: "/announcements" },
  { label: "My Profile", href: "/profile" },
];

export const SUPERVISOR_NAV: NavItem[] = [{ label: "My Team", href: "/team" }];

export const ADMIN_NAV: NavItem[] = [
  { label: "Employees", href: "/admin/employees" },
  { label: "Attendance", href: "/admin/attendance" },
  { label: "PTO Management", href: "/admin/pto" },
  { label: "Documents", href: "/documents" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Announcements", href: "/announcements" },
  { label: "Reports", href: "/admin/reports" },
  { label: "Administration", href: "/admin/administration" },
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
