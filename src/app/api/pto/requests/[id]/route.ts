import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { deletePtoRequest } from "@/lib/pto-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** DELETE /api/pto/requests/[id] — permanently remove one of the signed-in employee's own
 *  already-Cancelled PTO requests from their history (see deletePtoRequest's doc comment). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/pto/requests/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    await deletePtoRequest(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
