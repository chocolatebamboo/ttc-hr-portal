import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessEmployeeRecords } from "@/lib/authorization";
import { listMyAvailability, listAvailabilityForEmployee, submitAvailability, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/availability?employeeId=... — employeeId defaults to the caller. Same
 * authorization shape as GET /api/pto/requests: self, or a supervisor/admin of that employee
 * — checked here, and again by RLS. Returns { submissions: AvailabilityDTO[] }, newest first —
 * every submission that employee has ever made, not just the latest one.
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);
    const targetEmployeeId = searchParams.get("employeeId") ?? employee.id;

    await assertCanAccessEmployeeRecords(employee, targetEmployeeId);

    const submissions =
      targetEmployeeId === employee.id
        ? await listMyAvailability(employee)
        : await listAvailabilityForEmployee(employee, targetEmployeeId);

    return NextResponse.json({ submissions });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/availability — an employee submitting a new set of available dates always
 *  submits for themselves, same as POST /api/pto/requests. Body: { slots: AvailabilitySlot[],
 *  note? }. Always creates a new submission — never edits a past one, so approving/denying one
 *  never rewrites another. */
export async function POST(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));

    if (!Array.isArray(body.slots)) {
      throw new InvalidAvailabilityError("Choose which dates and times you're available.");
    }

    const dto = await submitAvailability(employee, {
      slots: body.slots,
      note: typeof body.note === "string" ? body.note : undefined,
    });

    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
