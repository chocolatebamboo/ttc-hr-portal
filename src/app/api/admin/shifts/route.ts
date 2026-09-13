import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listAdminShifts, createShiftManually, InvalidShiftError } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";
import type { ShiftStatus } from "@/types";

const VALID_STATUSES: ShiftStatus[] = [
  "UPCOMING",
  "IN_PROGRESS",
  "COMPLETED",
  "CHANGE_REQUESTED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
  "REASSIGNED",
  "MISSED",
];

/**
 * GET /api/admin/shifts?employeeId=&departmentId=&status=&dateFrom=&dateTo= — the Team Schedule
 * page's own data source. Admin sees the whole org; a supervisor sees only their own reports'
 * shifts (see listAdminShifts's own scoping). `status` here filters on the STORED status, not
 * the derived displayStatus every row also carries — filtering by "Missed" or "In Progress"
 * would need to compare displayStatus client-side instead, since those two are never stored.
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const status = statusParam && VALID_STATUSES.includes(statusParam as ShiftStatus) ? (statusParam as ShiftStatus) : undefined;

    const shifts = await listAdminShifts(employee, {
      employeeId: searchParams.get("employeeId") ?? undefined,
      departmentId: searchParams.get("departmentId") ?? undefined,
      status,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
    });

    return NextResponse.json({ shifts });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/admin/shifts — "Create a shift manually when needed." Body: { employeeId, date,
 *  startTime, endTime, note? }. Authorization (is the caller this employee's supervisor, or
 *  admin?) is assertCanManageShifts, checked inside createShiftManually itself. */
export async function POST(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));

    if (typeof body.employeeId !== "string" || !body.employeeId) {
      throw new InvalidShiftError("Choose a team member for this shift.");
    }
    if (typeof body.date !== "string" || typeof body.startTime !== "string" || typeof body.endTime !== "string") {
      throw new InvalidShiftError("A shift needs a date, start time, and end time.");
    }

    const dto = await createShiftManually(employee, {
      employeeId: body.employeeId,
      date: body.date,
      startTime: body.startTime,
      endTime: body.endTime,
      note: typeof body.note === "string" ? body.note : undefined,
    });

    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
