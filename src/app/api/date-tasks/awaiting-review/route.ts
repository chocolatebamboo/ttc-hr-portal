import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listAllAwaitingReviewDateTasks } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/awaiting-review — every task the signed-in reviewer can act on that's
 *  currently AWAITING_REVIEW, org-wide for an admin or narrowed to their own reports for a
 *  SUPERVISOR (listAllAwaitingReviewDateTasks itself enforces/narrows this). Backs the My Tasks
 *  page's "Awaiting review" tab (Oct 2026, CB: "I should be able to approve as well on the tasks
 *  page as well") — a static sibling of the [id] routes in this folder, not a taskId or
 *  employeeId, so it doesn't collide with either. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const tasks = await listAllAwaitingReviewDateTasks(employee);
    return NextResponse.json({ tasks });
  } catch (err) {
    return toErrorResponse(err);
  }
}
