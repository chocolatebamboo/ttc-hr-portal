import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { deleteEmployeeTimeEntry } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** DELETE /api/time/entries/[id] — permanently remove one of the signed-in employee's own
 *  zero-recorded-time entries (see deleteEmployeeTimeEntry's doc comment for why it's limited
 *  to that — a real logged day isn't deletable this way). */
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
