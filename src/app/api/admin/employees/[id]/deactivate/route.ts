import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { deactivateEmployee } from "@/lib/employees-admin";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/employees/[id]/deactivate — HR/Super Admin only. Revokes login access
 *  immediately (see getCurrentEmployee's deactivatedAt check) — self-deactivation is blocked. */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/employees/[id]/deactivate">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const updated = await deactivateEmployee(employee, id);
    return NextResponse.json({ employee: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
