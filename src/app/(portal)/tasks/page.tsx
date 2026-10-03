import { requireEmployeeOrRedirect } from "@/lib/auth";
import MyTasksView from "./MyTasksView";

export default async function MyTasksPage() {
  const employee = await requireEmployeeOrRedirect();

  return <MyTasksView employeeId={employee.id} />;
}
