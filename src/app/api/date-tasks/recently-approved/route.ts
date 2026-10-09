import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listRecentlyApprovedDateTasks } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/recently-approved — the reviewer's own "Completed" history, backing the
 *  Home dashboard's Team tasks widget and the My Tasks page's Awaiting review tab (see
 *  listRecentlyApprovedDateTasks's own doc comment in src/lib/date-tasks.ts). Same actor-scoped
 *  visibility that function itself enforces (ForbiddenError for anyone who isn't an
 *  admin/supervisor) — nothing additional to check here. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const tasks = await listRecentlyApprovedDateTasks(employee);
    return NextResponse.json({ tasks });
  } catch (err) {
    return toErrorResponse(err);
  }
}
