import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessEmployeeRecords } from "@/lib/authorization";
import { submitPtoRequest, InvalidPtoRequestError } from "@/lib/pto-actions";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";
import type { PtoStatus, PtoType } from "@/types";

const VALID_TYPES: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];
const VALID_STATUSES: PtoStatus[] = ["PENDING", "APPROVED", "DENIED", "CANCELLED"];

/**
 * GET /api/pto/requests?employeeId=...&status=...
 * employeeId defaults to the caller. Same authorization shape as the timesheet endpoints:
 * self, or a supervisor/admin of that employee — checked here, and again by RLS.
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);
    const targetEmployeeId = searchParams.get("employeeId") ?? employee.id;
    const statusParam = searchParams.get("status");
    const status = VALID_STATUSES.includes(statusParam as PtoStatus) ? (statusParam as PtoStatus) : undefined;

    await assertCanAccessEmployeeRecords(employee, targetEmployeeId);

    const requests = await withRlsContext({ employeeId: employee.id, role: employee.role }, (tx) =>
      tx.ptoRequest.findMany({
        where: {
          employeeId: targetEmployeeId,
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
      })
    );

    return NextResponse.json({ requests });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/pto/requests — an employee submitting a request always submits for themselves. */
export async function POST(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const body = await request.json();

    if (!VALID_TYPES.includes(body.type)) {
      throw new InvalidPtoRequestError("Choose a valid leave type.");
    }
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    const hours = Number(body.hours);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new InvalidPtoRequestError("Choose valid start and end dates.");
    }

    const created = await submitPtoRequest(employee, {
      type: body.type,
      startDate,
      endDate,
      hours,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
