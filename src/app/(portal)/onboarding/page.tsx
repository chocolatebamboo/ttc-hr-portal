import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import OnboardingView from "./OnboardingView";

export default async function OnboardingPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <OnboardingView canManage={isAdmin(employee)} />;
}
