import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import TimesheetView from "./TimesheetView";

export default async function TimePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <TimesheetView />;
}
