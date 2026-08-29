import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import ReportsView from "./ReportsView";

export default async function ReportsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  // Unlike Documents/Onboarding/Announcements, Reports has no employee-facing view to fall
  // back to — there's nothing here for a non-admin to see, so this redirects outright rather
  // than rendering a page whose only content is a permission error.
  if (!isAdmin(employee)) redirect("/dashboard");

  return <ReportsView />;
}
