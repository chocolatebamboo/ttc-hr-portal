import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import AvailabilityView from "./AvailabilityView";

export default async function AvailabilityPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <AvailabilityView />;
}
