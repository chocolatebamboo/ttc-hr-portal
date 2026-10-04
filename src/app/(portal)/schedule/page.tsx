import { requireEmployeeOrRedirect } from "@/lib/auth";
import ScheduleView from "./ScheduleView";

export default async function SchedulePage() {
  // Oct 2026: ScheduleView no longer needs the employee id itself (its per-shift "Tasks" link now
  // just points at /tasks?date=<date> rather than rendering a self-scoped task panel) — this call
  // still gates the page on being signed in, its return value just isn't needed anymore.
  await requireEmployeeOrRedirect();

  return <ScheduleView />;
}
