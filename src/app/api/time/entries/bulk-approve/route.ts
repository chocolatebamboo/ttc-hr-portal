import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewTimesheet } from "@/lib/authorization";
import { bulkApproveTimeEntries } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/time/entries/bulk-approve — body { employeeId, entryIds: string[] }
 * The "Approve all awaiting" button on a single employee's review page (ReviewTimesheetView) —
 * every id is expected to belong to `employeeId`, whose review page the caller is already on,
 * so authorization is the same single check as the per-day approve route: is this reviewer
 * actually this employee's supervisor, or HR/Super Admin?
 */
export async function POST(request: NextRequest) {
  try {
    const reviewer = await requireEmployee();
    const body = await request.json().catch(() => ({}));

    const employeeId = typeof body.employeeId === "string" ? body.employeeId : null;
    const entryIds = Array.isArray(body.entryIds) ? body.entryIds.filter((id: unknown) => typeof id === "string") : [];

    if (!employeeId || entryIds.length === 0) {
      return NextResponse.json({ error: "employeeId and at least one entryId are required." }, { status: 400 });
    }

    await assertCanReviewTimesheet(reviewer, employeeId);

    const result = await bulkApproveTimeEntries(reviewer, employeeId, entryIds);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
