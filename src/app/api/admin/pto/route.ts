import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listAdminPto } from "@/lib/pto-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/pto — HR/Super Admin only. Pending queue + upcoming approved leave. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const summary = await listAdminPto(employee);
    return NextResponse.json(summary);
  } catch (err) {
    return toErrorResponse(err);
  }
}
