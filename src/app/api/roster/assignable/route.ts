import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listAssignmentOptions } from "@/lib/roster";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/roster/assignable — HR/Super Admin only. Departments + active employees, for any
 *  admin form that assigns something to one of them (the announcement audience picker; the
 *  document upload form still calls its own /api/documents/assignable, kept for backward
 *  compatibility, but both now share the same underlying src/lib/roster.ts). */
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
