import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessEmployeeRecords } from "@/lib/authorization";
import { getMyAvailability, submitAvailability, InvalidAvailabilityError } from "@/lib/availability";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";
import type { AvailabilityDTO } from "@/types";

/**
 * GET /api/availability?employeeId=... — employeeId defaults to the caller. Same
 * authorization shape as GET /api/pto/requests: self, or a supervisor/admin of that employee
 * — checked here, and again by RLS.
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);
    const targetEmployeeId = searchParams.get("employeeId") ?? employee.id;

    await assertCanAccessEmployeeRecords(employee, targetEmployeeId);

    if (targetEmployeeId === employee.id) {
      return NextResponse.json(await getMyAvailability(employee));
    }

    // Viewing someone else's (a supervisor/admin looking at one report) — same shape as
    // getMyAvailability, just under the caller's own RLS identity rather than assuming self.
    const dto: AvailabilityDTO = await withRlsContext({ employeeId: employee.id, role: employee.role }, async (tx) => {
      const row = await tx.employeeAvailability.findUnique({ where: { employeeId: targetEmployeeId } });
      if (!row) {
        return { exists: false, slots: [], note: null, status: "PENDING", submittedAt: null, reviewComment: null, reviewedAt: null };
      }
      return {
        exists: true,
        slots: row.slots as unknown as AvailabilityDTO["slots"],
        note: row.note,
        status: row.status,
        submittedAt: row.submittedAt.toISOString(),
        reviewComment: row.reviewComment,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      };
    });
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/availability — an employee submitting/editing their pattern always submits for
 *  themselves, same as POST /api/pto/requests. Body: { slots: AvailabilitySlot[], note? }. */
export async function POST(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));

    if (!Array.isArray(body.slots)) {
      throw new InvalidAvailabilityError("Choose which days and times you're available.");
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
