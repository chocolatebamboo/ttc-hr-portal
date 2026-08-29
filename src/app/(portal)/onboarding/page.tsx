import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import OnboardingView from "./OnboardingView";

export default async function OnboardingPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const admin = isAdmin(employee);
  // A supervisor gets the Manage tab too — scoped to their own direct reports, for approving
  // or returning a step (see listOnboardingForManager/assertCanReviewOnboarding) — but only
  // HR/Super Admin may start a brand-new checklist (canStart).
  return <OnboardingView canManage={admin || employee.role === "SUPERVISOR"} canStart={admin} />;
}
