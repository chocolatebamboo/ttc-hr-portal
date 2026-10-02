import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessPtoManagement } from "@/lib/authorization";
import { listAdminPto } from "@/lib/pto-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/pto — HR/Super Admin, org-wide, or (Oct 2026) a Supervisor, narrowed to their
 *  own direct reports — see listAdminPto's own doc comment for the scoping. Pending queue +
 *  everything already decided. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertCanAccessPtoManagement(employee);
    const summary = await listAdminPto(employee);
    return NextResponse.json(summary);
  } catch (err) {
    return toErrorResponse(err);
  }
}
