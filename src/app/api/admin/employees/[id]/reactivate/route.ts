import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { reactivateEmployee } from "@/lib/employees-admin";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/employees/[id]/reactivate — HR/Super Admin only. Restores login access. */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/employees/[id]/reactivate">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const updated = await reactivateEmployee(employee, id);
    return NextResponse.json({ employee: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
