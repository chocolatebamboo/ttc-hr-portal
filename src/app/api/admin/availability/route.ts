import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listAdminAvailability } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/availability — HR/Super Admin only. Every submitted-availability record
 *  org-wide (not just one supervisor's team), split into { pending, decided }. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { pending, decided } = await listAdminAvailability(employee);
    return NextResponse.json({ pending, decided });
  } catch (err) {
    return toErrorResponse(err);
  }
}
