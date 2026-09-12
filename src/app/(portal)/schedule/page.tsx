import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import ScheduleView from "./ScheduleView";

export default async function SchedulePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <ScheduleView />;
}
