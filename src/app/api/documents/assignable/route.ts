import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listAssignmentOptions } from "@/lib/roster";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/documents/assignable — HR/Super Admin only. Departments + active employees, for
 *  the upload form's assignee picker. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const options = await listAssignmentOptions(employee);
    return NextResponse.json(options);
  } catch (err) {
    return toErrorResponse(err);
  }
}
