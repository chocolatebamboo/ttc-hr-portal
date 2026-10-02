import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessAttendance } from "@/lib/authorization";
import { listAdminAttendance } from "@/lib/attendance-admin";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/attendance?start=&end=&departmentId= — HR/Super Admin, org-wide, or (Oct 2026)
 *  a Supervisor, narrowed to their own direct reports — see listAdminAttendance's own doc
 *  comment for the scoping. */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    assertCanAccessAttendance(employee);

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
