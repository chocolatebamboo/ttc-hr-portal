import { requireEmployeeOrRedirect } from "@/lib/auth";
import ScheduleView from "./ScheduleView";

export default async function SchedulePage() {
  const employee = await requireEmployeeOrRedirect();

  return <ScheduleView employeeId={employee.id} />;
}
