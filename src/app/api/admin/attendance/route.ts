import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listAdminAttendance } from "@/lib/attendance-admin";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/attendance?start=&end=&departmentId= — HR/Super Admin only. */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const departmentId = searchParams.get("departmentId") ?? undefined;

    if (!start || !end) {
      return NextResponse.json({ error: "start and end are required." }, { status: 400 });
    }

    const rows = await listAdminAttendance(employee, start, end, departmentId);
    return NextResponse.json({ rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
