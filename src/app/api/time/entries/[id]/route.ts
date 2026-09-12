import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { deleteEmployeeTimeEntry } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** DELETE /api/time/entries/[id] — permanently remove one of the signed-in employee's own time
 *  entries, while it's still Awaiting Approval (or has no recorded time at all) — see
 *  deleteEmployeeTimeEntry's doc comment for the full rule and why an Approved day is locked. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/time/entries/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    await deleteEmployeeTimeEntry(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
