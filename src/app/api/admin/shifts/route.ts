import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessEmployeeRecords } from "@/lib/authorization";
import { listMyShifts, listShiftsForEmployee } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/shifts?employeeId=... — employeeId defaults to the caller. Same shape as
 * GET /api/availability: self, or a supervisor/admin of that employee — checked here, and
 * again by RLS (shift_select). Returns { shifts: ShiftDTO[] }, soonest first — this is "My
 * Schedule," the confirmed-and-scheduled counterpart to "My Availability."
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);
    const targetEmployeeId = searchParams.get("employeeId") ?? employee.id;

    await assertCanAccessEmployeeRecords(employee, targetEmployeeId);

    const shifts =
      targetEmployeeId === employee.id
        ? await listMyShifts(employee)
        : await listShiftsForEmployee(employee, targetEmployeeId);

    return NextResponse.json({ shifts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
