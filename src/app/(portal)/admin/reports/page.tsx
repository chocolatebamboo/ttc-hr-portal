import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin, canAccessReports } from "@/lib/authorization";
import ReportsView from "./ReportsView";

export default async function ReportsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  // Correction brief #8 (Sept 2026), "Administrative access and role audit": a Supervisor now
  // gets this same page too, scoped to their own team (see ReportsView's `scope` prop and
  // getPayrollHoursReport's own scoping) — "accessing reports" is one of the capabilities
  // explicitly named for Daijour Ho-Hing. Still no fallback view for anyone else — Reports has
  // nothing to show someone outside both groups, so this redirects outright rather than
  // rendering a page whose only content would be a permission error.
  if (!canAccessReports(employee)) redirect("/dashboard");

  return <ReportsView scope={isAdmin(employee) ? "all" : "team"} />;
}
