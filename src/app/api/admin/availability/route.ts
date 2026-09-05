import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listAdminAvailability } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/availability — HR/Super Admin only. Every team member who's submitted a
 *  weekly availability pattern, org-wide (not just one supervisor's team). */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const rows = await listAdminAvailability(employee);
    return NextResponse.json({ availability: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
