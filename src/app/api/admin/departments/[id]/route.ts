import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { renameDepartment, deleteDepartment, InvalidDepartmentError } from "@/lib/departments-admin";
import { toErrorResponse } from "@/lib/api-errors";

/** PATCH /api/admin/departments/[id] — HR/Super Admin only. Renames a department; every
 *  employee already assigned to it keeps pointing at the same row, so nothing else needs to
 *  change (see renameDepartment's doc comment in src/lib/departments-admin.ts). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/departments/[id]">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.name !== "string") throw new InvalidDepartmentError("A department name is required.");

    const updated = await renameDepartment(employee, id, body.name);
    return NextResponse.json({ department: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/admin/departments/[id] — HR/Super Admin only. Refuses (400, not 500) if
 *  anything still references the department — see deleteDepartment's doc comment. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/departments/[id]">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    await deleteDepartment(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
