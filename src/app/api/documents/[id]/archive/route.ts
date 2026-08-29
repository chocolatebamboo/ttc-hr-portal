import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { archiveDocument } from "@/lib/documents";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/documents/[id]/archive — HR/Super Admin only. Archiving keeps the record (for
 *  the audit trail) but removes it from every employee's visible list. */
export async function POST(_request: Request, ctx: RouteContext<"/api/documents/[id]/archive">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const document = await archiveDocument(employee, id);
    return NextResponse.json({ document });
  } catch (err) {
    return toErrorResponse(err);
  }
}
